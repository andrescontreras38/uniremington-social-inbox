import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { safeCompare } from '../lib/crypto.js';
import { purgeExpiredData, runExclusive } from '../jobs/scheduler.js';
import { prisma } from '../lib/prisma.js';
import { autoRespond } from '../services/replies.js';
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
   * Diagnostico temporal: estado completo de una interaccion (clasificacion,
   * politica y sus respuestas), sin pasar por sesion de admin. Solo para
   * depurar por que una interaccion concreta no recibio respuesta automatica.
   * Quitar despues de usarlo.
   */
  app.get('/diagnose-interaction', async (request, reply) => {
    const diagSecret = process.env.DIAG_SECRET ?? '';
    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!diagSecret || !provided || !safeCompare(provided, diagSecret)) {
      reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Secreto invalido' } });
      return;
    }

    const query = z.object({ id: z.string().cuid() }).parse(request.query);

    const interaction = await prisma.interaction.findUnique({
      where: { id: query.id },
      include: { replies: true, account: { select: { name: true, provider: true } } },
    });

    return reply.send({ interaction });
  });

  /**
   * Diagnostico temporal: reintenta la respuesta automatica de una
   * interaccion puntual que quedo clasificada pero sin borrador (la
   * ingesta normal nunca la reintenta sola porque ya la ve como conocida).
   * Quitar despues de usarlo.
   */
  app.post('/retry-autorespond', async (request, reply) => {
    const diagSecret = process.env.DIAG_SECRET ?? '';
    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!diagSecret || !provided || !safeCompare(provided, diagSecret)) {
      reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Secreto invalido' } });
      return;
    }

    const query = z.object({ id: z.string().cuid() }).parse(request.query);
    const result = await autoRespond(query.id);
    return reply.send(result);
  });
}
