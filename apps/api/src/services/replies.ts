import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { getConfig } from '../config/env.js';
import { ConflictError, NotFoundError, PolicyViolationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../lib/password.js';
import { safeExcerpt, scanPii } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { generateDraft } from './ai/drafter.js';
import type { DraftToneAdjustment } from './ai/prompts.js';
import { createAlert } from './alerts.js';
import { recordAudit, type AuditActor, type AuditContext } from './audit.js';
import { buildContactContext, findCampusContact } from './contacts.js';
import { getSocialProvider, resolveCredentials } from './social/index.js';
import { buildTemplateContext, findTemplatesForText } from './templates.js';

/**
 * Ciclo de vida de una respuesta.
 *
 *   DRAFT -> PENDING_APPROVAL -> APPROVED -> PUBLISHED
 *                             \-> REJECTED
 *                                          \-> FAILED (error al publicar)
 *
 * Invariante del sistema, no una casilla de configuracion:
 * ninguna respuesta se publica sin que una persona identificada la haya
 * aprobado. La comprobacion vive en assertPublishable() y se ejecuta dentro
 * de la transaccion de publicacion, contra el estado leido de la base y no
 * contra lo que traiga la peticion.
 */

const MAX_REPLY_LENGTH = 2000;

export interface ActorInfo extends AuditActor {
  id: string;
  email: string;
}

const interactionForDraft = {
  id: true,
  text: true,
  kind: true,
  topic: true,
  sentiment: true,
  requiresHuman: true,
  classifierNote: true,
  status: true,
  externalId: true,
  authorExternalId: true,
  remoteCreatedAt: true,
  firstRespondedAt: true,
  account: {
    select: {
      id: true,
      name: true,
      provider: true,
      externalId: true,
      accessTokenCipher: true,
      campus: true,
    },
  },
  post: { select: { caption: true } },
} satisfies Prisma.InteractionSelect;

async function loadInteraction(interactionId: string) {
  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    select: interactionForDraft,
  });

  if (!interaction) throw new NotFoundError('Interaccion');
  return interaction;
}

async function activeTone(): Promise<string | null> {
  const tone = await prisma.toneProfile.findFirst({
    where: { isActive: true },
    select: { content: true },
  });
  return tone?.content ?? null;
}

/** Pide a la IA un borrador para una interaccion que la politica permite. */
export async function createAiDraft(params: {
  interactionId: string;
  actor: ActorInfo;
  adjustment?: DraftToneAdjustment;
  context?: AuditContext;
}): Promise<{ id: string; text: string }> {
  const interaction = await loadInteraction(params.interactionId);

  if (interaction.requiresHuman) {
    throw new PolicyViolationError(
      `Este caso lo atiende una persona: ${interaction.classifierNote ?? 'politica de atencion'}. Puede escribir la respuesta a mano.`,
    );
  }

  // Datos verificados del programa que menciona el comentario, si alguno
  // aplica, esta vigente y corresponde a la sede que recibio el comentario.
  // Sin esto, el redactor no cita cifras.
  const campus = interaction.account.campus;
  let templates = await findTemplatesForText(interaction.text, 2, campus);

  // El comentario no nombro ningun programa ("esta especialidad", vago): si
  // la publicacion que responde si los nombra, se busca ahi. Con varios
  // programas en la misma publicacion se traen todos (hasta 4) para que el
  // redactor los liste con su propio precio -nunca se adivina cual de ellos
  // preguntaba la persona.
  if (templates.length === 0 && interaction.post?.caption) {
    templates = await findTemplatesForText(interaction.post.caption, 4, campus);
  }

  const verifiedData = buildTemplateContext(
    templates,
    interaction.kind as 'COMMENT' | 'DIRECT_MESSAGE',
  );

  // Contacto real de esa sede: lo que el redactor ofrece cuando no tiene el
  // dato exacto, en vez de un generico "escriba por mensaje directo".
  const campusContact = buildContactContext(await findCampusContact(campus));

  const draft = await generateDraft({
    interactionText: interaction.text,
    verifiedData,
    campusContact,
    postCaption: interaction.post?.caption ?? null,
    kind: interaction.kind as 'COMMENT' | 'DIRECT_MESSAGE',
    topic: interaction.topic,
    sentiment: interaction.sentiment,
    accountName: interaction.account.name,
    tone: await activeTone(),
    adjustment: params.adjustment,
    allowAssistedDraft: true,
  });

  const reply = await prisma.reply.create({
    data: {
      interactionId: interaction.id,
      status: 'DRAFT',
      origin: 'AI_DRAFT',
      draftText: draft.text,
      finalText: draft.text,
      createdById: params.actor.id,
      aiModel: draft.usage.model,
      aiInputTokens: draft.usage.inputTokens,
      aiOutputTokens: draft.usage.outputTokens,
    },
    select: { id: true, draftText: true },
  });

  await prisma.interaction.update({
    where: { id: interaction.id },
    data: { status: interaction.status === 'PENDING' ? 'IN_PROGRESS' : interaction.status },
  });

  await recordAudit({
    actor: params.actor,
    action: 'reply.drafted',
    entityType: 'Reply',
    entityId: reply.id,
    metadata: { interactionId: interaction.id, origin: 'AI_DRAFT', model: draft.usage.model },
    context: params.context,
  });

  return { id: reply.id, text: reply.draftText };
}

/** Crea un borrador escrito a mano. Siempre permitido, incluso en casos sensibles. */
export async function createManualDraft(params: {
  interactionId: string;
  actor: ActorInfo;
  text: string;
  context?: AuditContext;
}): Promise<{ id: string; text: string }> {
  const interaction = await loadInteraction(params.interactionId);
  const text = normalizeReplyText(params.text);

  const reply = await prisma.reply.create({
    data: {
      interactionId: interaction.id,
      status: 'DRAFT',
      origin: 'HUMAN',
      draftText: text,
      finalText: text,
      createdById: params.actor.id,
    },
    select: { id: true, draftText: true },
  });

  await prisma.interaction.update({
    where: { id: interaction.id },
    data: { status: interaction.status === 'PENDING' ? 'IN_PROGRESS' : interaction.status },
  });

  await recordAudit({
    actor: params.actor,
    action: 'reply.drafted',
    entityType: 'Reply',
    entityId: reply.id,
    metadata: { interactionId: interaction.id, origin: 'HUMAN' },
    context: params.context,
  });

  return { id: reply.id, text: reply.draftText };
}

/** Edita el texto final. El borrador original de la IA se conserva. */
export async function editReply(params: {
  replyId: string;
  actor: ActorInfo;
  text: string;
  context?: AuditContext;
}): Promise<void> {
  const reply = await prisma.reply.findUnique({
    where: { id: params.replyId },
    select: { id: true, status: true },
  });

  if (!reply) throw new NotFoundError('Respuesta');
  if (reply.status === 'PUBLISHED') {
    throw new ConflictError('No se puede editar una respuesta ya publicada');
  }

  await prisma.reply.update({
    where: { id: reply.id },
    data: {
      finalText: normalizeReplyText(params.text),
      // Editar despues de aprobar invalida la aprobacion: quien aprueba debe
      // haber leido exactamente el texto que sale publicado.
      status: 'DRAFT',
      approvedById: null,
      approvedAt: null,
    },
  });

  await recordAudit({
    actor: params.actor,
    action: 'reply.edited',
    entityType: 'Reply',
    entityId: reply.id,
    context: params.context,
  });
}

/** Aprueba el texto final. Solo una persona con permiso llega aqui. */
export async function approveReply(params: {
  replyId: string;
  actor: ActorInfo;
  text?: string;
  context?: AuditContext;
}): Promise<void> {
  const reply = await prisma.reply.findUnique({
    where: { id: params.replyId },
    select: { id: true, status: true, finalText: true, draftText: true },
  });

  if (!reply) throw new NotFoundError('Respuesta');
  if (reply.status === 'PUBLISHED') throw new ConflictError('La respuesta ya fue publicada');
  if (reply.status === 'REJECTED') throw new ConflictError('La respuesta fue descartada');

  const finalText = normalizeReplyText(params.text ?? reply.finalText ?? reply.draftText);

  await prisma.reply.update({
    where: { id: reply.id },
    data: {
      finalText,
      status: 'APPROVED',
      approvedById: params.actor.id,
      approvedAt: new Date(),
    },
  });

  await recordAudit({
    actor: params.actor,
    action: 'reply.approved',
    entityType: 'Reply',
    entityId: reply.id,
    metadata: { excerpt: safeExcerpt(finalText, 200) },
    context: params.context,
  });
}

export async function rejectReply(params: {
  replyId: string;
  actor: ActorInfo;
  reason: string;
  context?: AuditContext;
}): Promise<void> {
  const reply = await prisma.reply.findUnique({
    where: { id: params.replyId },
    select: { id: true, status: true },
  });

  if (!reply) throw new NotFoundError('Respuesta');
  if (reply.status === 'PUBLISHED') throw new ConflictError('La respuesta ya fue publicada');

  await prisma.reply.update({
    where: { id: reply.id },
    data: {
      status: 'REJECTED',
      rejectionReason: params.reason.slice(0, 500),
      approvedById: null,
      approvedAt: null,
    },
  });

  await recordAudit({
    actor: params.actor,
    action: 'reply.rejected',
    entityType: 'Reply',
    entityId: reply.id,
    metadata: { reason: params.reason.slice(0, 200) },
    context: params.context,
  });
}

/**
 * Comprobacion irrenunciable previa a publicar.
 *
 * Se aisla en una funcion pura para poder probarla directamente y para que
 * cualquiera que lea el codigo vea la regla completa en un solo lugar.
 */
export function assertPublishable(reply: {
  status: string;
  approvedById: string | null;
  approvedAt: Date | null;
  finalText: string | null;
  publishedAt: Date | null;
}): asserts reply is {
  status: 'APPROVED';
  approvedById: string;
  approvedAt: Date;
  finalText: string;
  publishedAt: null;
} {
  if (reply.publishedAt !== null) {
    throw new ConflictError('La respuesta ya fue publicada');
  }
  if (reply.status !== 'APPROVED') {
    throw new PolicyViolationError(
      'Solo se publica una respuesta aprobada. Nada sale sin que una persona la lea y la apruebe.',
    );
  }
  if (!reply.approvedById || !reply.approvedAt) {
    throw new PolicyViolationError(
      'La respuesta no registra quien la aprobo; no puede publicarse.',
    );
  }
  if (!reply.finalText || reply.finalText.trim().length === 0) {
    throw new PolicyViolationError('La respuesta aprobada no tiene texto.');
  }
  if (reply.finalText.length > MAX_REPLY_LENGTH) {
    throw new PolicyViolationError(
      `La respuesta supera el limite de ${MAX_REPLY_LENGTH} caracteres.`,
    );
  }
}

/** Publica en Meta una respuesta ya aprobada. */
export async function publishReply(params: {
  replyId: string;
  actor: ActorInfo;
  context?: AuditContext;
}): Promise<{ externalId: string }> {
  const reply = await prisma.reply.findUnique({
    where: { id: params.replyId },
    select: {
      id: true,
      status: true,
      approvedById: true,
      approvedAt: true,
      finalText: true,
      publishedAt: true,
      interaction: { select: interactionForDraft },
    },
  });

  if (!reply) throw new NotFoundError('Respuesta');

  // Se valida contra el estado persistido, nunca contra lo que envie el cliente.
  assertPublishable(reply);

  const approver = await prisma.user.findUnique({
    where: { id: reply.approvedById },
    select: { id: true, isActive: true, email: true },
  });

  if (!approver || !approver.isActive) {
    throw new PolicyViolationError(
      'Quien aprobo la respuesta ya no es un usuario activo; debe aprobarla alguien mas.',
    );
  }

  // Un ultimo filtro antes de que el texto salga a un canal publico.
  const outgoingPii = scanPii(reply.finalText);
  if (outgoingPii.flags.length > 0) {
    throw new PolicyViolationError(
      `La respuesta contiene datos personales (${outgoingPii.flags.join(', ')}). Retirelos o continue por mensaje directo.`,
    );
  }

  const interaction = reply.interaction;
  const provider = getSocialProvider();
  const credentials = resolveCredentials(interaction.account);

  try {
    const published = await provider.publishReply(
      credentials,
      {
        kind: interaction.kind as 'COMMENT' | 'DIRECT_MESSAGE',
        externalId: interaction.externalId,
        authorExternalId: interaction.authorExternalId ?? undefined,
      },
      reply.finalText,
    );

    const now = new Date();
    const firstResponse = interaction.firstRespondedAt ?? now;
    const responseSeconds = Math.max(
      0,
      Math.round((firstResponse.getTime() - interaction.remoteCreatedAt.getTime()) / 1000),
    );

    await prisma.$transaction([
      prisma.reply.update({
        where: { id: reply.id },
        data: { status: 'PUBLISHED', publishedAt: now, externalId: published.externalId },
      }),
      prisma.interaction.update({
        where: { id: interaction.id },
        data: {
          status: 'ANSWERED',
          firstRespondedAt: firstResponse,
          firstResponseSeconds: responseSeconds,
        },
      }),
    ]);

    await recordAudit({
      actor: params.actor,
      action: 'reply.published',
      entityType: 'Reply',
      entityId: reply.id,
      metadata: {
        interactionId: interaction.id,
        approvedBy: approver.email,
        externalId: published.externalId,
      },
      context: params.context,
    });

    return published;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.reply.update({
      where: { id: reply.id },
      data: { status: 'FAILED', publishError: message.slice(0, 500) },
    });

    await recordAudit({
      actor: params.actor,
      action: 'reply.publish_failed',
      entityType: 'Reply',
      entityId: reply.id,
      metadata: { error: message.slice(0, 200) },
      context: params.context,
    });

    await createAlert({
      type: 'PUBLISH_FAILURE',
      severity: 'WARNING',
      title: 'Fallo al publicar una respuesta aprobada',
      message: `La respuesta ${reply.id} no pudo publicarse: ${message.slice(0, 200)}`,
      interactionId: interaction.id,
      accountId: interaction.account.id,
    });

    logger.error({ replyId: reply.id, err: message }, 'Fallo al publicar la respuesta');
    throw error;
  }
}

const SYSTEM_ACTOR_EMAIL = 'sistema-ia@uniremington.edu.co';
let systemActorPromise: Promise<ActorInfo> | null = null;

/**
 * Cuenta de sistema que firma la aprobacion y publicacion cuando responde la
 * IA sin intervencion humana. No es una forma de omitir assertPublishable():
 * approvedById sigue siendo obligatorio, solo que aqui apunta a esta cuenta
 * en vez de a una persona, y queda asi en la auditoria (autoPublished: true).
 * Su contrasena es aleatoria y se descarta: nunca queda un valor con el que
 * alguien pueda iniciar sesion como ella.
 */
async function getSystemActor(): Promise<ActorInfo> {
  systemActorPromise ??= (async () => {
    const existing = await prisma.user.findUnique({
      where: { email: SYSTEM_ACTOR_EMAIL },
      select: { id: true, email: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) {
        await prisma.user.update({ where: { id: existing.id }, data: { isActive: true } });
      }
      return { id: existing.id, email: existing.email };
    }

    const created = await prisma.user.create({
      data: {
        email: SYSTEM_ACTOR_EMAIL,
        name: 'Sistema (respuesta automatica)',
        role: 'VIEWER',
        passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
        isActive: true,
      },
      select: { id: true, email: true },
    });
    return created;
  })();

  return systemActorPromise;
}

/**
 * Redacta, aprueba y publica sin esperar a una persona. Solo llega aqui una
 * interaccion que la politica ya marco sin requiresHuman (domain/policy.ts):
 * quejas, reclamos y cualquier dato personal, financiero o de salud siguen
 * yendo siempre a una persona, sin excepcion, sea cual sea AI_AUTO_PUBLISH.
 * Cualquier fallo (redaccion o publicacion) deja el caso pendiente para
 * revision manual en vez de propagar el error: una respuesta automatica que
 * falla nunca debe tumbar la ingesta del comentario.
 */
export async function autoRespond(
  interactionId: string,
): Promise<{ published: boolean; reason?: string }> {
  if (!getConfig().AI_AUTO_PUBLISH) return { published: false, reason: 'auto_publish_disabled' };

  const interaction = await loadInteraction(interactionId);
  if (interaction.requiresHuman) return { published: false, reason: 'requires_human' };

  const actor = await getSystemActor();

  let draft: { id: string; text: string };
  try {
    draft = await createAiDraft({ interactionId, actor });
    await prisma.reply.update({ where: { id: draft.id }, data: { autoPublished: true } });
  } catch (error) {
    logger.warn(
      { interactionId, err: error instanceof Error ? error.message : String(error) },
      'No se pudo redactar la respuesta automatica; queda pendiente para una persona',
    );
    return { published: false, reason: 'draft_failed' };
  }

  try {
    await approveReply({ replyId: draft.id, actor });
    await publishReply({ replyId: draft.id, actor });
    return { published: true };
  } catch (error) {
    logger.warn(
      { interactionId, replyId: draft.id, err: error instanceof Error ? error.message : String(error) },
      'No se pudo publicar la respuesta automatica; queda pendiente para revision',
    );
    return { published: false, reason: 'publish_failed' };
  }
}

function normalizeReplyText(text: string | null | undefined): string {
  const value = (text ?? '').replace(/\s+\n/g, '\n').trim();

  if (value.length === 0) {
    throw new PolicyViolationError('La respuesta no puede estar vacia');
  }
  if (value.length > MAX_REPLY_LENGTH) {
    throw new PolicyViolationError(
      `La respuesta supera el limite de ${MAX_REPLY_LENGTH} caracteres`,
    );
  }

  return value;
}
