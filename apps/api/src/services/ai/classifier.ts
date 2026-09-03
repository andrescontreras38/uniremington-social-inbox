import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// El ayudante de salida estructurada del SDK usa la interfaz de Zod v4, que
// viene incluida en el paquete zod instalado. Los valores se toman de
// domain/enums.ts para que no existan dos listas que puedan divergir.
import * as z4 from 'zod/v4';
import { getConfig } from '../../config/env.js';
import {
  SENTIMENTS,
  TOPICS,
  URGENCIES,
  type PiiFlag,
  type Sentiment,
  type Topic,
  type Urgency,
} from '../../domain/enums.js';
import { evaluatePolicy, type PolicyDecision } from '../../domain/policy.js';
import { logger } from '../../lib/logger.js';
import { scanPii } from '../../lib/pii.js';
import { prisma } from '../../lib/prisma.js';
import {
  clamp,
  isMentionOnly,
  isPositiveReaction,
  letterCount,
  textFingerprint,
} from '../../lib/text.js';
import { AiRefusalError, getAnthropic, type AiUsage } from './client.js';
import { supportsEffort } from './model-capabilities.js';
import { CLASSIFIER_SYSTEM } from './prompts.js';

/**
 * Clasificacion de comentarios y mensajes.
 *
 * El modelo asigna sentimiento, tema y urgencia; la deteccion de datos
 * personales corre siempre en local (determinista, sin costo y sin enviar el
 * texto a ningun lado para decidirlo). La politica final combina ambas.
 *
 * Antes de gastar una llamada se intentan, en este orden:
 *   1. Reglas locales, para lo que no necesita criterio (un corazon, una
 *      mencion suelta, un comentario sin letras).
 *   2. Reutilizar la clasificacion de un comentario identico ya visto.
 *   3. Solo entonces, el modelo.
 *
 * En convocatoria la misma pregunta llega decenas de veces; los dos primeros
 * pasos evitan pagarla cada vez.
 */

const ClassificationSchema = z4.object({
  sentiment: z4.enum(SENTIMENTS),
  topic: z4.enum(TOPICS),
  urgency: z4.enum(URGENCIES),
  summary: z4.string(),
  confidence: z4.number(),
});

/** Limites de recorte. Un comentario tipico no llega ni a 300 caracteres. */
const MAX_TEXT_CHARS = 1200;
const MAX_CAPTION_CHARS = 400;
/** La respuesta es un JSON de cinco campos; no necesita mas. */
const MAX_OUTPUT_TOKENS = 200;

export interface ClassificationResult {
  sentiment: Sentiment;
  topic: Topic;
  urgency: Urgency;
  summary: string;
  confidence: number;
  piiFlags: PiiFlag[];
  policy: PolicyDecision;
  usage?: AiUsage;
  /** Como se resolvio: por regla local, reutilizada o consultada al modelo. */
  source: 'rule' | 'reused' | 'model' | 'fallback';
  /** Nota para la bandeja cuando la clasificacion no vino del modelo. */
  note?: string;
}

export interface ClassificationInput {
  text: string;
  postCaption?: string | null;
  kind: 'COMMENT' | 'DIRECT_MESSAGE';
  accountName?: string;
}

/** Arma el resultado aplicando siempre la politica sobre el texto real. */
function withPolicy(
  input: ClassificationInput,
  piiFlags: PiiFlag[],
  base: {
    sentiment: Sentiment;
    topic: Topic;
    urgency: Urgency;
    summary: string;
    confidence: number;
    source: ClassificationResult['source'];
    note?: string;
    usage?: AiUsage;
    forceHuman?: boolean;
  },
): ClassificationResult {
  const policy = evaluatePolicy({
    topic: base.topic,
    sentiment: base.sentiment,
    urgency: base.urgency,
    piiFlags,
    text: input.text,
  });

  return {
    sentiment: base.sentiment,
    topic: base.topic,
    urgency: base.urgency,
    summary: base.summary,
    confidence: base.confidence,
    piiFlags,
    policy: base.forceHuman
      ? { ...policy, requiresHuman: true, allowAssistedDraft: false }
      : policy,
    source: base.source,
    note: base.note,
    usage: base.usage,
  };
}

/**
 * Reglas locales para lo que no necesita criterio.
 *
 * Devuelve null cuando el comentario si requiere al modelo.
 */
function triage(input: ClassificationInput, piiFlags: PiiFlag[]): ClassificationResult | null {
  const trimmed = input.text.trim();

  if (trimmed.length === 0) {
    return withPolicy(input, piiFlags, {
      sentiment: 'NEUTRAL',
      topic: 'OTHER',
      urgency: 'LOW',
      summary: 'Comentario sin texto',
      confidence: 1,
      source: 'rule',
    });
  }

  if (isPositiveReaction(trimmed)) {
    return withPolicy(input, piiFlags, {
      sentiment: 'POSITIVE',
      topic: 'PRAISE',
      urgency: 'LOW',
      summary: 'Reaccion positiva sin texto',
      confidence: 0.9,
      source: 'rule',
    });
  }

  if (isMentionOnly(trimmed)) {
    return withPolicy(input, piiFlags, {
      sentiment: 'NEUTRAL',
      topic: 'OTHER',
      urgency: 'LOW',
      summary: 'Mencion a otra persona',
      confidence: 0.9,
      source: 'rule',
    });
  }

  // Sin letras y sin emoji reconocible: signos sueltos, numeros aislados.
  if (letterCount(trimmed) === 0) {
    return withPolicy(input, piiFlags, {
      sentiment: 'NEUTRAL',
      topic: 'OTHER',
      urgency: 'LOW',
      summary: 'Comentario sin contenido legible',
      confidence: 0.8,
      source: 'rule',
    });
  }

  return null;
}

/**
 * Busca un comentario identico ya clasificado por el modelo.
 *
 * Solo reutiliza las etiquetas; la politica y la deteccion de datos
 * personales se recalculan sobre el texto actual, de modo que un cambio en
 * las reglas se aplica de inmediato aunque la clasificacion venga de antes.
 */
async function findReusable(
  input: ClassificationInput,
  fingerprint: string,
  piiFlags: PiiFlag[],
): Promise<ClassificationResult | null> {
  const config = getConfig();
  if (config.AI_CLASSIFY_REUSE_DAYS === 0) return null;

  const since = new Date(Date.now() - config.AI_CLASSIFY_REUSE_DAYS * 24 * 60 * 60 * 1000);

  const previous = await prisma.interaction.findFirst({
    where: {
      textHash: fingerprint,
      kind: input.kind,
      classifiedAt: { gte: since },
      sentiment: { not: null },
      topic: { not: null },
    },
    select: { sentiment: true, topic: true, urgency: true, summary: true, confidence: true },
    orderBy: { classifiedAt: 'desc' },
  });

  if (!previous?.sentiment || !previous.topic) return null;

  return withPolicy(input, piiFlags, {
    sentiment: previous.sentiment as Sentiment,
    topic: previous.topic as Topic,
    urgency: previous.urgency as Urgency,
    summary: previous.summary ?? '',
    confidence: previous.confidence ?? 0.7,
    source: 'reused',
  });
}

/**
 * Clasificacion conservadora usada cuando la IA esta apagada, falla o declina.
 * Nunca deja pasar un caso como automatizable.
 */
function fallbackClassification(
  input: ClassificationInput,
  piiFlags: PiiFlag[],
  note: string,
): ClassificationResult {
  return withPolicy(input, piiFlags, {
    sentiment: 'NEUTRAL',
    topic: 'OTHER',
    urgency: 'MEDIUM',
    summary: 'Sin clasificar automaticamente',
    confidence: 0,
    source: 'fallback',
    note,
    forceHuman: true,
  });
}

export async function classifyInteraction(
  input: ClassificationInput,
): Promise<ClassificationResult> {
  const config = getConfig();
  const { flags: piiFlags } = scanPii(input.text);

  // 1. Reglas locales: gratis e instantaneas.
  const triaged = triage(input, piiFlags);
  if (triaged) return triaged;

  if (!config.AI_ENABLED) {
    return fallbackClassification(input, piiFlags, 'IA deshabilitada');
  }

  // 2. Un comentario identico ya clasificado: tambien gratis.
  const fingerprint = textFingerprint(input.text);
  try {
    const reused = await findReusable(input, fingerprint, piiFlags);
    if (reused) return reused;
  } catch (error) {
    // Un fallo de la reutilizacion no debe impedir clasificar.
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'No se pudo consultar la clasificacion previa',
    );
  }

  // 3. Solo ahora se paga una llamada al modelo.
  const context = [
    `Canal: ${input.kind === 'COMMENT' ? 'comentario publico' : 'mensaje directo'}`,
    input.postCaption
      ? `Publicacion: """${clamp(input.postCaption, MAX_CAPTION_CHARS)}"""`
      : 'Publicacion: no disponible',
    `Texto: """${clamp(input.text, MAX_TEXT_CHARS)}"""`,
  ].join('\n');

  const model = config.AI_MODEL_CLASSIFY;

  try {
    const response = await getAnthropic().messages.parse({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // El bloque de sistema es estable, asi que se cachea entre comentarios
      // en los modelos cuyo prefijo minimo lo permita.
      system: [{ type: 'text', text: CLASSIFIER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: context }],
      output_config: {
        format: zodOutputFormat(ClassificationSchema),
        // Enviar effort a un modelo que no lo admite devuelve error 400.
        ...(supportsEffort(model) ? { effort: config.AI_CLASSIFY_EFFORT } : {}),
      },
    });

    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.category ?? null;
      logger.warn({ category }, 'El modelo declino clasificar; se escala a una persona');
      return fallbackClassification(input, piiFlags, 'El modelo declino clasificar');
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      return fallbackClassification(input, piiFlags, 'Respuesta del modelo no interpretable');
    }

    return withPolicy(input, piiFlags, {
      sentiment: parsed.sentiment,
      topic: parsed.topic,
      urgency: parsed.urgency,
      summary: parsed.summary,
      confidence: Math.min(Math.max(parsed.confidence, 0), 1),
      source: 'model',
      usage: {
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (error) {
    if (error instanceof AiRefusalError) {
      return fallbackClassification(input, piiFlags, 'El modelo declino clasificar');
    }

    logger.error(
      { err: error instanceof Error ? error.message : String(error), model },
      'Fallo la clasificacion con IA',
    );
    return fallbackClassification(input, piiFlags, 'Fallo temporal de la clasificacion');
  }
}
