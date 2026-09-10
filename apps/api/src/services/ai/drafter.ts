import { getConfig } from '../../config/env.js';
import { PolicyViolationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { clamp } from '../../lib/text.js';
import { AiRefusalError, getAnthropic, type AiUsage } from './client.js';
import { supportsEffort } from './model-capabilities.js';
import {
  buildDraftInstruction,
  DEFAULT_TONE,
  DRAFTER_SYSTEM_BASE,
  type DraftToneAdjustment,
} from './prompts.js';

/**
 * Redaccion de borradores.
 *
 * Dos garantias del modulo:
 *  - No redacta cuando la politica marco el caso como de atencion humana.
 *  - Lo que devuelve es un borrador. Publicarlo exige aprobacion de una
 *    persona; esa comprobacion vive en el servicio de respuestas.
 */

/** Limites de recorte y de salida, para acotar el costo por borrador. */
const MAX_TEXT_CHARS = 1200;
const MAX_CAPTION_CHARS = 400;
// 400 alcanza de sobra para un solo texto; con seguimiento privado el
// modelo devuelve dos bloques, asi que el techo sube. Es un limite, no un
// costo: solo se paga lo que el modelo realmente produce.
const MAX_OUTPUT_TOKENS = 600;

export interface DraftInput {
  interactionText: string;
  postCaption?: string | null;
  kind: 'COMMENT' | 'DIRECT_MESSAGE';
  /** Nombre publico de quien escribio, cuando Meta lo entrega (a veces no). */
  authorName?: string | null;
  topic?: string | null;
  sentiment?: string | null;
  accountName?: string;
  tone?: string | null;
  adjustment?: DraftToneAdjustment;
  /** Bloque de datos verificados armado por services/templates.ts. */
  verifiedData?: string | null;
  /** Bloque de contacto de sede armado por services/contacts.ts. */
  campusContact?: string | null;
  /**
   * Verdadero cuando hay un dato (enlace, precio no publico o contacto de
   * sede) que la regla 9 le prohibe dar en un comentario publico, y por lo
   * tanto vale la pena un seguimiento automatico por Private Reply. Se
   * decide en replies.ts a partir de los mismos datos verificados, no lo
   * infiere el modelo.
   */
  allowPrivateFollowUp?: boolean;
  /** Resultado de evaluatePolicy para esta interaccion. */
  allowAssistedDraft: boolean;
  policyReasons?: string[];
}

export interface DraftResult {
  text: string;
  /** Presente solo cuando el modelo devolvio tambien un bloque RESPUESTA_PRIVADA. */
  privateText?: string;
  usage: AiUsage;
}

const PUBLIC_MARKER = 'RESPUESTA_PUBLICA:';
const PRIVATE_MARKER = 'RESPUESTA_PRIVADA:';

/**
 * Separa el texto del modelo en publico/privado cuando sigue el formato de
 * la regla 10. Si no lo sigue al pie de la letra (el modelo lo omitio o lo
 * deformo), se trata todo como un unico texto publico: es el comportamiento
 * seguro, igual que si nunca se hubiera pedido el seguimiento privado.
 */
function splitDualResponse(text: string): { text: string; privateText?: string } {
  const publicIndex = text.indexOf(PUBLIC_MARKER);
  const privateIndex = text.indexOf(PRIVATE_MARKER);
  if (publicIndex === -1 || privateIndex === -1 || privateIndex < publicIndex) {
    return { text };
  }

  const publicText = text.slice(publicIndex + PUBLIC_MARKER.length, privateIndex).trim();
  const privateText = text.slice(privateIndex + PRIVATE_MARKER.length).trim();
  if (!publicText || !privateText) return { text };

  return { text: publicText, privateText };
}

export async function generateDraft(input: DraftInput): Promise<DraftResult> {
  if (!input.allowAssistedDraft) {
    throw new PolicyViolationError(
      `Este caso debe atenderlo una persona y no admite borrador asistido. Motivo: ${
        input.policyReasons?.join('; ') ?? 'politica de atencion'
      }`,
    );
  }

  const config = getConfig();

  // El prefijo estable (reglas + tono institucional) se cachea; solo cambia el
  // bloque del usuario con el comentario concreto.
  const system = [
    {
      type: 'text' as const,
      text: DRAFTER_SYSTEM_BASE,
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text: `Tono institucional de Uniremington:\n\n${input.tone?.trim() || DEFAULT_TONE}`,
      cache_control: { type: 'ephemeral' as const },
    },
  ];

  const userContent = [
    `Canal: ${input.kind === 'COMMENT' ? 'comentario publico bajo una publicacion' : 'mensaje directo'}`,
    input.postCaption
      ? `Publicacion:\n"""${clamp(input.postCaption, MAX_CAPTION_CHARS)}"""`
      : 'Publicacion: no disponible. No supongas de que trataba.',
    input.authorName?.trim() ? `Nombre de quien escribe: ${input.authorName.trim()}` : null,
    input.topic ? `Clasificacion: ${input.topic} / ${input.sentiment}` : null,
    // Los datos verificados van antes del mensaje: el modelo los lee como
    // material de referencia, no como parte de lo que escribio la persona.
    input.verifiedData ?? null,
    input.campusContact ?? null,
    input.allowPrivateFollowUp ? 'SEGUIMIENTO_PRIVADO_DISPONIBLE' : null,
    `Mensaje de la persona:\n"""${clamp(input.interactionText, MAX_TEXT_CHARS)}"""`,
    buildDraftInstruction(input.adjustment),
  ]
    .filter(Boolean)
    .join('\n\n');

  const model = config.AI_MODEL_DRAFT;

  const response = await getAnthropic().messages.create({
    model,
    // De dos a cuatro frases caben de sobra aqui. Un techo bajo evita que una
    // respuesta se desborde y encarezca la peticion.
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: userContent }],
    // Enviar effort a un modelo que no lo admite devuelve error 400.
    ...(supportsEffort(model) ? { output_config: { effort: config.AI_DRAFT_EFFORT } } : {}),
  });

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? null;
    logger.warn({ category }, 'El modelo declino redactar; el caso pasa a una persona');
    throw new AiRefusalError(category);
  }

  const text = response.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new PolicyViolationError('El modelo no devolvio texto utilizable para el borrador');
  }

  const { text: publicText, privateText } = input.allowPrivateFollowUp
    ? splitDualResponse(text)
    : { text, privateText: undefined };

  return {
    text: publicText,
    privateText,
    usage: {
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
