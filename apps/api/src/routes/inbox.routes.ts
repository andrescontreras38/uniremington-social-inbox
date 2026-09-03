import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  InteractionKind,
  InteractionStatus,
  Sentiment,
  Topic,
  Urgency,
} from '../domain/enums.js';
import { NotFoundError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { auditContextOf, requireUser } from '../plugins/auth.js';
import { recordAudit } from '../services/audit.js';
import { classifyAndStore } from '../services/ingestion.js';
import { getSocialProvider, resolveCredentials } from '../services/social/index.js';

/**
 * La bandeja: una sola cola para la cuenta nacional y las de sede.
 *
 * Los filtros son los que el equipo usa de verdad: pendientes, urgentes, los
 * mios, por cuenta y por tema.
 */

const listQuerySchema = z.object({
  status: InteractionStatus.optional(),
  sentiment: Sentiment.optional(),
  topic: Topic.optional(),
  urgency: Urgency.optional(),
  kind: InteractionKind.optional(),
  accountId: z.string().cuid().optional(),
  /** "me" filtra por el usuario autenticado; un cuid, por esa persona. */
  assignedTo: z.union([z.literal('me'), z.literal('unassigned'), z.string().cuid()]).optional(),
  requiresHuman: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['newest', 'oldest', 'urgency']).default('newest'),
});

const assignSchema = z.object({ userId: z.string().cuid().nullable() });
const statusSchema = z.object({ status: InteractionStatus });
const hideSchema = z.object({ hidden: z.boolean() });
const bulkSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(200),
  action: z.enum(['archive', 'assign', 'status']),
  userId: z.string().cuid().nullable().optional(),
  status: InteractionStatus.optional(),
});

const listSelect = {
  id: true,
  kind: true,
  text: true,
  authorName: true,
  permalink: true,
  remoteCreatedAt: true,
  sentiment: true,
  topic: true,
  urgency: true,
  summary: true,
  piiFlags: true,
  requiresHuman: true,
  status: true,
  isHidden: true,
  answeredExternally: true,
  assignedAt: true,
  firstResponseSeconds: true,
  account: { select: { id: true, name: true, provider: true, campus: true } },
  assignedTo: { select: { id: true, name: true } },
  post: { select: { id: true, permalink: true, caption: true, thumbnailUrl: true } },
  _count: { select: { replies: true } },
} satisfies Prisma.InteractionSelect;

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { onRequest: [app.requirePermission('inbox:read')] }, async (request) => {
    const user = requireUser(request);
    const query = listQuerySchema.parse(request.query);

    const where: Prisma.InteractionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sentiment ? { sentiment: query.sentiment } : {}),
      ...(query.topic ? { topic: query.topic } : {}),
      ...(query.urgency ? { urgency: query.urgency } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.requiresHuman ? { requiresHuman: query.requiresHuman === 'true' } : {}),
      ...(query.assignedTo === 'me'
        ? { assignedToId: user.id }
        : query.assignedTo === 'unassigned'
          ? { assignedToId: null }
          : query.assignedTo
            ? { assignedToId: query.assignedTo }
            : {}),
      ...(query.from || query.to
        ? {
            remoteCreatedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      // Prisma parametriza la consulta: no hay concatenacion de SQL.
      ...(query.search ? { text: { contains: query.search } } : {}),
    };

    const orderBy: Prisma.InteractionOrderByWithRelationInput[] =
      query.sort === 'urgency'
        ? [{ urgency: 'desc' }, { remoteCreatedAt: 'desc' }]
        : query.sort === 'oldest'
          ? [{ remoteCreatedAt: 'asc' }]
          : [{ remoteCreatedAt: 'desc' }];

    const [items, total] = await Promise.all([
      prisma.interaction.findMany({
        where,
        select: listSelect,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.interaction.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  });

  app.get('/:id', { onRequest: [app.requirePermission('inbox:read')] }, async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);

    const interaction = await prisma.interaction.findUnique({
      where: { id },
      select: {
        ...listSelect,
        classifierNote: true,
        confidence: true,
        externalId: true,
        replies: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            origin: true,
            draftText: true,
            finalText: true,
            rejectionReason: true,
            publishError: true,
            publishedAt: true,
            approvedAt: true,
            createdAt: true,
            aiModel: true,
            createdBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!interaction) throw new NotFoundError('Interaccion');
    return { interaction };
  });

  app.post('/:id/assign', { onRequest: [app.requirePermission('inbox:assign')] }, async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = assignSchema.parse(request.body);
    const user = requireUser(request);

    const updated = await prisma.interaction.update({
      where: { id },
      data: {
        assignedToId: body.userId,
        assignedAt: body.userId ? new Date() : null,
        status: body.userId ? 'IN_PROGRESS' : 'PENDING',
      },
      select: { id: true, assignedToId: true, status: true },
    });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'interaction.assigned',
      entityType: 'Interaction',
      entityId: id,
      metadata: { assignedTo: body.userId },
      context: auditContextOf(request),
    });

    return { interaction: updated };
  });

  app.post('/:id/status', { onRequest: [app.requirePermission('inbox:archive')] }, async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = statusSchema.parse(request.body);
    const user = requireUser(request);

    const updated = await prisma.interaction.update({
      where: { id },
      data: { status: body.status },
      select: { id: true, status: true },
    });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'interaction.status_changed',
      entityType: 'Interaction',
      entityId: id,
      metadata: { status: body.status },
      context: auditContextOf(request),
    });

    return { interaction: updated };
  });

  /**
   * Ocultar un comentario desde la bandeja, sin abrir Meta.
   * Es la accion prevista para una cedula o un dato de salud que quedo
   * publico en un comentario abierto.
   */
  app.post('/:id/hide', { onRequest: [app.requirePermission('inbox:moderate')] }, async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = hideSchema.parse(request.body);
    const user = requireUser(request);

    const interaction = await prisma.interaction.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        externalId: true,
        account: {
          select: { id: true, provider: true, externalId: true, accessTokenCipher: true },
        },
      },
    });

    if (!interaction) throw new NotFoundError('Interaccion');

    const provider = getSocialProvider();
    await provider.setCommentHidden(
      resolveCredentials(interaction.account),
      interaction.externalId,
      body.hidden,
    );

    const updated = await prisma.interaction.update({
      where: { id },
      data: {
        isHidden: body.hidden,
        hiddenAt: body.hidden ? new Date() : null,
        status: body.hidden ? 'HIDDEN' : 'PENDING',
      },
      select: { id: true, isHidden: true, status: true },
    });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: body.hidden ? 'interaction.hidden' : 'interaction.unhidden',
      entityType: 'Interaction',
      entityId: id,
      context: auditContextOf(request),
    });

    return { interaction: updated };
  });

  /** Acciones en lote: archivar o asignar varios de una vez. */
  app.post('/bulk', { onRequest: [app.requirePermission('inbox:archive')] }, async (request) => {
    const body = bulkSchema.parse(request.body);
    const user = requireUser(request);

    // Se usa la variante "unchecked" porque la asignacion escribe la clave
    // foranea directamente en lugar de conectar la relacion.
    const data: Prisma.InteractionUncheckedUpdateManyInput =
      body.action === 'archive'
        ? { status: 'ARCHIVED' }
        : body.action === 'assign'
          ? { assignedToId: body.userId ?? null, assignedAt: body.userId ? new Date() : null }
          : { status: body.status ?? 'PENDING' };

    const result = await prisma.interaction.updateMany({ where: { id: { in: body.ids } }, data });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'interaction.bulk_action',
      entityType: 'Interaction',
      metadata: { action: body.action, count: result.count },
      context: auditContextOf(request),
    });

    return { updated: result.count };
  });

  /** Vuelve a clasificar una interaccion, util tras ajustar la politica. */
  app.post(
    '/:id/reclassify',
    { onRequest: [app.requirePermission('inbox:assign')] },
    async (request) => {
      const { id } = z.object({ id: z.string().cuid() }).parse(request.params);

      const interaction = await prisma.interaction.findUnique({
        where: { id },
        select: {
          id: true,
          text: true,
          kind: true,
          post: { select: { caption: true } },
          account: { select: { id: true, name: true } },
        },
      });

      if (!interaction) throw new NotFoundError('Interaccion');

      await classifyAndStore(interaction.id, {
        text: interaction.text,
        postCaption: interaction.post?.caption ?? null,
        kind: interaction.kind as 'COMMENT' | 'DIRECT_MESSAGE',
        accountName: interaction.account.name,
        accountId: interaction.account.id,
      });

      const updated = await prisma.interaction.findUnique({
        where: { id },
        select: listSelect,
      });

      return { interaction: updated };
    },
  );
}
