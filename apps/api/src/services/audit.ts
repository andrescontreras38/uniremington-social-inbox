import { logger } from '../lib/logger.js';
import { maskPii } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';

/**
 * Registro de auditoria.
 *
 * Queda constancia de quien aprobo, publico, oculto o asigno cada cosa. Es el
 * respaldo de la regla "nada se publica sin que alguien lo lea y apruebe": si
 * una respuesta salio, el registro dice quien la aprobo y cuando.
 *
 * Nunca falla la operacion principal: un error al auditar se registra pero no
 * revierte la accion del usuario.
 */

export interface AuditActor {
  id: string | null;
  email: string | null;
}

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.password_changed'
  | 'user.created'
  | 'user.updated'
  | 'user.deactivated'
  | 'account.created'
  | 'account.updated'
  | 'account.token_rotated'
  | 'account.deleted'
  | 'interaction.assigned'
  | 'interaction.status_changed'
  | 'interaction.hidden'
  | 'interaction.unhidden'
  | 'interaction.bulk_action'
  | 'interaction.purged'
  | 'reply.drafted'
  | 'reply.edited'
  | 'reply.approved'
  | 'reply.rejected'
  | 'reply.published'
  | 'reply.publish_failed'
  | 'tone.updated'
  | 'template.created'
  | 'template.updated'
  | 'template.deleted'
  | 'alert.acknowledged'
  | 'data.exported';

export async function recordAudit(params: {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  context?: AuditContext;
}): Promise<void> {
  try {
    // Los metadatos pasan por el enmascarador: en auditoria interesa el hecho
    // y su alcance, no el dato personal del aspirante.
    const metadata = params.metadata
      ? maskPii(JSON.stringify(params.metadata)).slice(0, 4000)
      : null;

    await prisma.auditLog.create({
      data: {
        actorId: params.actor.id,
        actorEmail: params.actor.email,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        metadata,
        ipAddress: params.context?.ipAddress ?? null,
        userAgent: params.context?.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), action: params.action },
      'No se pudo escribir el registro de auditoria',
    );
  }
}
