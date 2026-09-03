import { logger } from '../lib/logger.js';
import { safeExcerpt } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { textFingerprint } from '../lib/text.js';
import { classifyInteraction } from './ai/classifier.js';
import { checkNegativeSpike, createAlert } from './alerts.js';
import type { NormalizedInteraction } from './social/types.js';

/**
 * Ingesta de comentarios y mensajes.
 *
 * Propiedades que importan:
 *  - Idempotente: la clave (cuenta, id externo) impide duplicar un comentario
 *    que llegue dos veces por webhook y por sincronizacion.
 *  - Un fallo en una interaccion no detiene el lote.
 *  - Todo lo nuevo entra como PENDING y con requiresHuman en verdadero hasta
 *    que la clasificacion diga lo contrario.
 */

export interface IngestionSummary {
  received: number;
  created: number;
  duplicates: number;
  failed: number;
  externalAnswers: number;
}

export async function ingestInteractions(
  items: NormalizedInteraction[],
): Promise<IngestionSummary> {
  const summary: IngestionSummary = {
    received: items.length,
    created: 0,
    duplicates: 0,
    failed: 0,
    externalAnswers: 0,
  };

  for (const item of items) {
    try {
      const result = await ingestOne(item);
      if (result === 'created') summary.created += 1;
      else if (result === 'duplicate') summary.duplicates += 1;
      else summary.externalAnswers += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          externalId: item.externalId,
        },
        'No se pudo ingerir una interaccion',
      );
    }
  }

  return summary;
}

type IngestOutcome = 'created' | 'duplicate' | 'external_answer';

async function ingestOne(item: NormalizedInteraction): Promise<IngestOutcome> {
  const account = await prisma.socialAccount.findUnique({
    where: {
      provider_externalId: { provider: item.provider, externalId: item.accountExternalId },
    },
    select: { id: true, name: true, isActive: true },
  });

  if (!account) {
    // Llega un evento de una cuenta que no esta conectada en el sistema. No es
    // un error del remitente: puede ser una sede que aun no entra al piloto.
    logger.warn(
      { provider: item.provider, accountExternalId: item.accountExternalId },
      'Evento de una cuenta no registrada; se descarta',
    );
    return 'duplicate';
  }

  if (!account.isActive) return 'duplicate';

  // La institucion respondio desde Meta: se marca el comentario padre como ya
  // atendido en lugar de crear una interaccion nueva.
  if (item.fromInstitution) {
    if (item.parentExternalId) {
      const updated = await prisma.interaction.updateMany({
        where: { accountId: account.id, externalId: item.parentExternalId },
        data: {
          answeredExternally: true,
          status: 'ANSWERED',
          firstRespondedAt: item.remoteCreatedAt,
        },
      });
      if (updated.count > 0) return 'external_answer';
    }
    return 'duplicate';
  }

  const existing = await prisma.interaction.findUnique({
    where: { accountId_externalId: { accountId: account.id, externalId: item.externalId } },
    select: { id: true },
  });

  if (existing) return 'duplicate';

  const post = item.post
    ? await prisma.post.upsert({
        where: {
          accountId_externalId: { accountId: account.id, externalId: item.post.externalId },
        },
        create: {
          accountId: account.id,
          externalId: item.post.externalId,
          permalink: item.post.permalink ?? null,
          caption: item.post.caption ?? null,
          mediaType: item.post.mediaType ?? null,
          thumbnailUrl: item.post.thumbnailUrl ?? null,
          publishedAt: item.post.publishedAt ?? null,
        },
        // Solo se completan campos que llegaron ahora y faltaban antes.
        update: {
          permalink: item.post.permalink ?? undefined,
          caption: item.post.caption ?? undefined,
          thumbnailUrl: item.post.thumbnailUrl ?? undefined,
        },
        select: { id: true, caption: true },
      })
    : null;

  const created = await prisma.interaction.create({
    data: {
      accountId: account.id,
      postId: post?.id ?? null,
      kind: item.kind,
      externalId: item.externalId,
      parentExternalId: item.parentExternalId ?? null,
      permalink: item.permalink ?? null,
      authorExternalId: item.authorExternalId ?? null,
      authorName: item.authorName ?? null,
      text: item.text,
      textHash: textFingerprint(item.text),
      remoteCreatedAt: item.remoteCreatedAt,
      status: 'PENDING',
      requiresHuman: true,
    },
    select: { id: true },
  });

  await classifyAndStore(created.id, {
    text: item.text,
    postCaption: post?.caption ?? null,
    kind: item.kind,
    accountName: account.name,
    accountId: account.id,
  });

  return 'created';
}

/**
 * Clasifica una interaccion y guarda el resultado.
 *
 * Se ejecuta tambien desde la ruta de reclasificacion manual, por eso vive
 * separada de la ingesta.
 */
export async function classifyAndStore(
  interactionId: string,
  input: {
    text: string;
    postCaption?: string | null;
    kind: 'COMMENT' | 'DIRECT_MESSAGE';
    accountName?: string;
    accountId: string;
  },
): Promise<void> {
  const result = await classifyInteraction({
    text: input.text,
    postCaption: input.postCaption,
    kind: input.kind,
    accountName: input.accountName,
  });

  await prisma.interaction.update({
    where: { id: interactionId },
    data: {
      sentiment: result.sentiment,
      topic: result.topic,
      urgency: result.urgency,
      summary: result.summary,
      confidence: result.confidence,
      piiFlags: result.piiFlags.length > 0 ? result.piiFlags.join(',') : null,
      requiresHuman: result.policy.requiresHuman,
      classifiedAt: new Date(),
      classifierNote:
        [result.note, ...result.policy.reasons].filter(Boolean).join(' | ').slice(0, 500) || null,
      // Se guarda la huella tambien al reclasificar, por si la interaccion
      // venia de una version anterior sin ella.
      textHash: textFingerprint(input.text),
      // Queda registrado si esta clasificacion costo una llamada o se resolvio
      // sin ella; es lo que alimenta el consumo del tablero.
      classifierSource: result.source,
      aiInputTokens: result.usage?.inputTokens ?? null,
      aiOutputTokens: result.usage?.outputTokens ?? null,
    },
  });

  if (result.urgency === 'CRITICAL' || (result.urgency === 'HIGH' && result.sentiment === 'NEGATIVE')) {
    await createAlert({
      type: 'URGENT_INTERACTION',
      severity: result.urgency === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
      title: `Caso ${result.urgency === 'CRITICAL' ? 'critico' : 'urgente'}: ${result.topic}`,
      message: `${result.summary}\n\nComentario: ${safeExcerpt(input.text, 300)}`,
      interactionId,
      accountId: input.accountId,
    });
  }

  if (result.piiFlags.some((flag) => flag === 'DOCUMENT_ID' || flag === 'HEALTH' || flag === 'FINANCIAL')) {
    await createAlert({
      type: 'PII_DETECTED',
      severity: 'WARNING',
      title: 'Dato personal en un comentario publico',
      message: `Se detecto ${result.piiFlags.join(', ')} en una interaccion. Considere ocultar el comentario y continuar por mensaje directo.`,
      interactionId,
      accountId: input.accountId,
      // Sin correo: la bandeja lo marca y el equipo lo ve al abrirlo.
      notify: false,
    });
  }

  if (result.sentiment === 'NEGATIVE') {
    await checkNegativeSpike(input.accountId);
  }
}
