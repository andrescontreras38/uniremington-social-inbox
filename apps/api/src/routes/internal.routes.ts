import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config/env.js';
import { safeCompare } from '../lib/crypto.js';
import { purgeExpiredData, runExclusive } from '../jobs/scheduler.js';
import { retryStuckAutoResponses } from '../services/replies.js';
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
   * Reintenta auto-respuestas que quedaron redactadas/aprobadas pero nunca
   * se publicaron porque la peticion original se corto por el limite de
   * 60s de la funcion serverless (vease retryStuckAutoResponses). Pensada
   * para un disparador externo cada 1-2 minutos (p. ej. cron-job.org): el
   * plan Hobby de Vercel solo permite cron nativo una vez al dia, muy poco
   * para esto. Secreto propio (RETRY_SECRET) en vez de CRON_SECRET porque
   * quien llama no es Vercel Cron.
   */
  app.get('/retry-stuck', async (request, reply) => {
    const retrySecret = process.env.RETRY_SECRET ?? '';
    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!retrySecret || !provided || !safeCompare(provided, retrySecret)) {
      reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Secreto invalido' } });
      return;
    }

    const result = await retryStuckAutoResponses();
    return reply.send({ ok: true, ...result });
  });
}
