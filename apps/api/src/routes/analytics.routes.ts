import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { estimateCost } from '../services/ai/model-capabilities.js';

/**
 * El tablero.
 *
 * La propuesta lo dice sin rodeos: lo primero que entrega la herramienta no es
 * una respuesta automatica, es el numero. Cuantos llegaron, cuantos quedaron
 * sin responder y en cuanto tiempo se respondio.
 */

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  accountId: z.string().cuid().optional(),
});

function resolveRange(query: z.infer<typeof rangeSchema>) {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Consumo de IA del periodo.
 *
 * Sirve para responder dos preguntas concretas: cuanto esta costando operar
 * la bandeja, y cuantas llamadas se estan evitando con las reglas locales y
 * la reutilizacion de clasificaciones. El costo es una estimacion con los
 * precios publicados y el modelo configurado hoy; la factura la emite
 * Anthropic.
 */
async function aiConsumption(
  where: Prisma.InteractionWhereInput,
  from: Date,
  to: Date,
): Promise<{
  classified: number;
  bySource: Record<string, number>;
  avoidedCalls: number;
  avoidedRate: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  models: { classify: string; draft: string };
}> {
  const config = getConfig();

  const [sources, classifyTokens, draftTokens] = await Promise.all([
    prisma.interaction.groupBy({
      by: ['classifierSource'],
      where: { ...where, classifierSource: { not: null } },
      _count: { _all: true },
    }),
    prisma.interaction.aggregate({
      where,
      _sum: { aiInputTokens: true, aiOutputTokens: true },
    }),
    prisma.reply.aggregate({
      where: { createdAt: { gte: from, lte: to }, origin: 'AI_DRAFT' },
      _sum: { aiInputTokens: true, aiOutputTokens: true },
    }),
  ]);

  const bySource: Record<string, number> = { rule: 0, reused: 0, model: 0, fallback: 0 };
  for (const row of sources) {
    if (row.classifierSource) bySource[row.classifierSource] = row._count._all;
  }

  const classified = Object.values(bySource).reduce((sum, count) => sum + count, 0);
  const avoidedCalls = (bySource.rule ?? 0) + (bySource.reused ?? 0);

  const classifyIn = classifyTokens._sum.aiInputTokens ?? 0;
  const classifyOut = classifyTokens._sum.aiOutputTokens ?? 0;
  const draftIn = draftTokens._sum.aiInputTokens ?? 0;
  const draftOut = draftTokens._sum.aiOutputTokens ?? 0;

  const estimatedCostUsd =
    estimateCost(config.AI_MODEL_CLASSIFY, classifyIn, classifyOut) +
    estimateCost(config.AI_MODEL_DRAFT, draftIn, draftOut);

  return {
    classified,
    bySource,
    avoidedCalls,
    avoidedRate: classified > 0 ? Number(((avoidedCalls / classified) * 100).toFixed(1)) : 0,
    inputTokens: classifyIn + draftIn,
    outputTokens: classifyOut + draftOut,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
    models: { classify: config.AI_MODEL_CLASSIFY, draft: config.AI_MODEL_DRAFT },
  };
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/summary', { onRequest: [app.requirePermission('analytics:read')] }, async (request) => {
    const query = rangeSchema.parse(request.query);
    const { from, to } = resolveRange(query);

    const where: Prisma.InteractionWhereInput = {
      remoteCreatedAt: { gte: from, lte: to },
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };

    const [total, pending, urgent, answered, hidden, requiresHuman, responseTimes] =
      await Promise.all([
        prisma.interaction.count({ where }),
        prisma.interaction.count({ where: { ...where, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
        prisma.interaction.count({
          where: { ...where, urgency: { in: ['HIGH', 'CRITICAL'] }, status: { not: 'ARCHIVED' } },
        }),
        prisma.interaction.count({ where: { ...where, status: 'ANSWERED' } }),
        prisma.interaction.count({ where: { ...where, isHidden: true } }),
        prisma.interaction.count({ where: { ...where, requiresHuman: true } }),
        prisma.interaction.aggregate({
          where: { ...where, firstResponseSeconds: { not: null } },
          _avg: { firstResponseSeconds: true },
          _count: { firstResponseSeconds: true },
        }),
      ]);

    return {
      range: { from, to },
      totals: {
        total,
        pending,
        urgent,
        answered,
        hidden,
        requiresHuman,
        // La cifra que hoy no existe: cuantos quedaron sin responder.
        unanswered: pending,
        responseRate: total > 0 ? Number(((answered / total) * 100).toFixed(1)) : 0,
      },
      responseTime: {
        averageSeconds: Math.round(responseTimes._avg.firstResponseSeconds ?? 0),
        measured: responseTimes._count.firstResponseSeconds,
      },
      ai: await aiConsumption(where, from, to),
    };
  });

  /** Distribucion por sentimiento, tema, urgencia y cuenta. */
  app.get(
    '/breakdown',
    { onRequest: [app.requirePermission('analytics:read')] },
    async (request) => {
      const query = rangeSchema.parse(request.query);
      const { from, to } = resolveRange(query);

      const where: Prisma.InteractionWhereInput = {
        remoteCreatedAt: { gte: from, lte: to },
        ...(query.accountId ? { accountId: query.accountId } : {}),
      };

      const [bySentiment, byTopic, byUrgency, byAccount, byStatus] = await Promise.all([
        prisma.interaction.groupBy({ by: ['sentiment'], where, _count: { _all: true } }),
        prisma.interaction.groupBy({ by: ['topic'], where, _count: { _all: true } }),
        prisma.interaction.groupBy({ by: ['urgency'], where, _count: { _all: true } }),
        prisma.interaction.groupBy({ by: ['accountId'], where, _count: { _all: true } }),
        prisma.interaction.groupBy({ by: ['status'], where, _count: { _all: true } }),
      ]);

      const accounts = await prisma.socialAccount.findMany({
        select: { id: true, name: true, provider: true, campus: true },
      });
      const accountById = new Map(accounts.map((account) => [account.id, account]));

      return {
        range: { from, to },
        bySentiment: bySentiment.map((row) => ({
          key: row.sentiment ?? 'SIN_CLASIFICAR',
          count: row._count._all,
        })),
        byTopic: byTopic.map((row) => ({
          key: row.topic ?? 'SIN_CLASIFICAR',
          count: row._count._all,
        })),
        byUrgency: byUrgency.map((row) => ({ key: row.urgency, count: row._count._all })),
        byStatus: byStatus.map((row) => ({ key: row.status, count: row._count._all })),
        byAccount: byAccount.map((row) => ({
          key: accountById.get(row.accountId)?.name ?? row.accountId,
          campus: accountById.get(row.accountId)?.campus ?? null,
          provider: accountById.get(row.accountId)?.provider ?? null,
          count: row._count._all,
        })),
      };
    },
  );

  /** Rendimiento por persona: respondidos y tiempo promedio. */
  app.get(
    '/by-agent',
    { onRequest: [app.requirePermission('analytics:read')] },
    async (request) => {
      const query = rangeSchema.parse(request.query);
      const { from, to } = resolveRange(query);

      const published = await prisma.reply.groupBy({
        by: ['approvedById'],
        where: { status: 'PUBLISHED', publishedAt: { gte: from, lte: to } },
        _count: { _all: true },
      });

      const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } });
      const userById = new Map(users.map((user) => [user.id, user]));

      const assigned = await prisma.interaction.groupBy({
        by: ['assignedToId'],
        where: { assignedAt: { gte: from, lte: to }, assignedToId: { not: null } },
        _count: { _all: true },
        _avg: { firstResponseSeconds: true },
      });

      const assignedById = new Map(assigned.map((row) => [row.assignedToId, row]));

      return {
        range: { from, to },
        agents: published
          .filter((row) => row.approvedById)
          .map((row) => {
            const stats = assignedById.get(row.approvedById);
            return {
              userId: row.approvedById,
              name: userById.get(row.approvedById!)?.name ?? 'Desconocido',
              role: userById.get(row.approvedById!)?.role ?? null,
              publishedReplies: row._count._all,
              assignedInteractions: stats?._count._all ?? 0,
              averageResponseSeconds: Math.round(stats?._avg.firstResponseSeconds ?? 0),
            };
          })
          .sort((a, b) => b.publishedReplies - a.publishedReplies),
      };
    },
  );

  /** Serie diaria de volumen, para ver el pico de convocatoria. */
  app.get(
    '/timeseries',
    { onRequest: [app.requirePermission('analytics:read')] },
    async (request) => {
      const query = rangeSchema.parse(request.query);
      const { from, to } = resolveRange(query);

      const interactions = await prisma.interaction.findMany({
        where: {
          remoteCreatedAt: { gte: from, lte: to },
          ...(query.accountId ? { accountId: query.accountId } : {}),
        },
        select: { remoteCreatedAt: true, sentiment: true },
        orderBy: { remoteCreatedAt: 'asc' },
      });

      const buckets = new Map<
        string,
        { date: string; total: number; positive: number; neutral: number; negative: number }
      >();

      for (const item of interactions) {
        const date = item.remoteCreatedAt.toISOString().slice(0, 10);
        const bucket = buckets.get(date) ?? {
          date,
          total: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
        };

        bucket.total += 1;
        if (item.sentiment === 'POSITIVE') bucket.positive += 1;
        else if (item.sentiment === 'NEGATIVE') bucket.negative += 1;
        else bucket.neutral += 1;

        buckets.set(date, bucket);
      }

      return { range: { from, to }, series: [...buckets.values()] };
    },
  );
}
