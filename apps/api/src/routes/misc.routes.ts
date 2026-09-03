import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AlertStatus, AlertType } from '../domain/enums.js';
import { NotFoundError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { auditContextOf, requireUser } from '../plugins/auth.js';
import { recordAudit } from '../services/audit.js';

/**
 * Rutas de apoyo: alertas, tono institucional, auditoria y estado del servicio.
 */

const idParams = z.object({ id: z.string().cuid() });

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

const alertQuerySchema = z.object({
  status: AlertStatus.optional(),
  type: AlertType.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { onRequest: [app.requirePermission('alerts:read')] }, async (request) => {
    const query = alertQuerySchema.parse(request.query);

    const where: Prisma.AlertWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          message: true,
          status: true,
          createdAt: true,
          notifiedAt: true,
          interactionId: true,
          account: { select: { id: true, name: true } },
        },
      }),
      prisma.alert.count({ where }),
    ]);

    return { items, pagination: { page: query.page, pageSize: query.pageSize, total } };
  });

  app.post(
    '/:id/acknowledge',
    { onRequest: [app.requirePermission('alerts:write')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const user = requireUser(request);

      const alert = await prisma.alert.update({
        where: { id },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
        select: { id: true, status: true },
      });

      await recordAudit({
        actor: { id: user.id, email: user.email },
        action: 'alert.acknowledged',
        entityType: 'Alert',
        entityId: id,
        context: auditContextOf(request),
      });

      return { alert };
    },
  );
}

// ---------------------------------------------------------------------------
// Tono institucional
// ---------------------------------------------------------------------------

const toneSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  content: z.string().min(50).max(8000),
  isActive: z.boolean().default(false),
});

export async function toneRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { onRequest: [app.requirePermission('tone:read')] }, async () => {
    const profiles = await prisma.toneProfile.findMany({ orderBy: { updatedAt: 'desc' } });
    return { profiles };
  });

  app.post('/', { onRequest: [app.requirePermission('tone:write')] }, async (request) => {
    const body = toneSchema.parse(request.body);
    const user = requireUser(request);

    // Solo un perfil activo a la vez: la voz institucional es una.
    const profile = await prisma.$transaction(async (tx) => {
      if (body.isActive) {
        await tx.toneProfile.updateMany({ where: { isActive: true }, data: { isActive: false } });
      }
      return tx.toneProfile.create({ data: body });
    });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'tone.updated',
      entityType: 'ToneProfile',
      entityId: profile.id,
      metadata: { name: body.name, isActive: body.isActive },
      context: auditContextOf(request),
    });

    return { profile };
  });

  app.post(
    '/:id/activate',
    { onRequest: [app.requirePermission('tone:write')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const user = requireUser(request);

      const exists = await prisma.toneProfile.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundError('Perfil de tono');

      await prisma.$transaction([
        prisma.toneProfile.updateMany({ where: { isActive: true }, data: { isActive: false } }),
        prisma.toneProfile.update({ where: { id }, data: { isActive: true } }),
      ]);

      await recordAudit({
        actor: { id: user.id, email: user.email },
        action: 'tone.updated',
        entityType: 'ToneProfile',
        entityId: id,
        metadata: { activated: true },
        context: auditContextOf(request),
      });

      return { ok: true };
    },
  );
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

const auditQuerySchema = z.object({
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  actorId: z.string().cuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { onRequest: [app.requirePermission('audit:read')] }, async (request) => {
    const query = auditQuerySchema.parse(request.query);

    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, pagination: { page: query.page, pageSize: query.pageSize, total } };
  });
}

// ---------------------------------------------------------------------------
// Estado del servicio
// ---------------------------------------------------------------------------

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Sonda superficial: responde si el proceso esta vivo. */
  app.get('/live', async () => ({ status: 'ok' }));

  /** Sonda profunda: comprueba la base de datos. No expone detalles internos. */
  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'degraded', database: 'error' });
    }
  });
}
