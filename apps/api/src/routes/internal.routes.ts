import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { request as httpRequest } from 'undici';
import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { safeCompare } from '../lib/crypto.js';
import { purgeExpiredData, runExclusive } from '../jobs/scheduler.js';
import { prisma } from '../lib/prisma.js';
import { resolveCredentials } from '../services/social/index.js';
import { syncAllAccounts } from '../services/sync.js';

/**
 * Disparadores para un programador externo (Vercel Cron u otro).
 *
 * Existen porque en un despliegue serverless no hay proceso que se quede
 * vivo entre peticiones: el setInterval de jobs/scheduler.ts (ENABLE_JOBS=true,
 * pensado para un servidor persistente como un VPS) no tiene donde correr.
 * Aqui la misma logica se dispara por HTTP en su lugar.
 *
 * Quien llama no es una persona con sesion, asi que no hay cookie ni CSRF que
 * verificar: la autorizacion es un secreto compartido en el encabezado
 * Authorization, comparado en tiempo constante.
 */

function requireCronSecret(request: FastifyRequest, reply: FastifyReply): boolean {
  const config = getConfig();

  if (!config.CRON_SECRET) {
    reply.status(503).send({
      error: { code: 'CRON_NOT_CONFIGURED', message: 'CRON_SECRET no esta configurado' },
    });
    return false;
  }

  const header = request.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !safeCompare(provided, config.CRON_SECRET)) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Secreto invalido' } });
    return false;
  }

  return true;
}

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // GET, no POST: asi es como Vercel Cron invoca la ruta. Cuando el proyecto
  // tiene definida la variable CRON_SECRET, Vercel agrega automaticamente el
  // encabezado Authorization: Bearer <CRON_SECRET> a esa peticion, que es
  // exactamente lo que requireCronSecret verifica.
  app.get('/sync', async (request, reply) => {
    if (!requireCronSecret(request, reply)) return;

    let summary: Awaited<ReturnType<typeof syncAllAccounts>> | null = null;
    await runExclusive('sync', async () => {
      summary = await syncAllAccounts();
    });

    return reply.send({ ok: true, summary });
  });

  app.get('/retention', async (request, reply) => {
    if (!requireCronSecret(request, reply)) return;

    await runExclusive('retention', purgeExpiredData);

    return reply.send({ ok: true });
  });

  /**
   * Diagnostico temporal: busca la respuesta PUBLISHED mas reciente cuyo
   * texto contenga `text` y consulta directamente en la Graph API si ese
   * comentario sigue existiendo y si Meta lo marco oculto (is_hidden). Solo
   * para depurar el caso de respuestas que la bandeja marca publicadas pero
   * no aparecen en Facebook/Instagram. Quitar despues de usarlo.
   */
  app.get('/diagnose-reply', async (request, reply) => {
    if (!requireCronSecret(request, reply)) return;

    const query = z.object({ text: z.string().min(3) }).parse(request.query);
    const config = getConfig();

    const candidate = await prisma.reply.findFirst({
      where: {
        status: 'PUBLISHED',
        externalId: { not: null },
        OR: [
          { draftText: { contains: query.text, mode: 'insensitive' } },
          { finalText: { contains: query.text, mode: 'insensitive' } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      include: { interaction: { include: { account: true } } },
    });

    if (!candidate) return reply.send({ found: false });

    const account = candidate.interaction.account;
    const credentials = resolveCredentials(account);

    const url = new URL(
      `${config.META_GRAPH_BASE_URL}/${config.META_GRAPH_VERSION}/${candidate.externalId}`,
    );
    url.searchParams.set('fields', 'id,message,is_hidden,created_time,parent,can_comment');
    url.searchParams.set('access_token', credentials.accessToken);

    const graphResponse = await httpRequest(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });
    const graphBody = await graphResponse.body.json();

    return reply.send({
      found: true,
      replyId: candidate.id,
      interactionId: candidate.interactionId,
      externalId: candidate.externalId,
      autoPublished: candidate.autoPublished,
      createdAt: candidate.createdAt,
      approvedAt: candidate.approvedAt,
      publishedAt: candidate.publishedAt,
      account: { provider: account.provider, name: account.name },
      graphStatus: graphResponse.statusCode,
      graph: graphBody,
    });
  });
}
