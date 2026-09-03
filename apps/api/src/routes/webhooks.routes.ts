import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sha256Hex } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { ingestInteractions } from '../services/ingestion.js';
import { getSocialProvider } from '../services/social/index.js';

/**
 * Recepcion de eventos de Meta.
 *
 * Cuatro cuidados:
 *  1. La firma se verifica sobre el cuerpo CRUDO. Por eso este plugin
 *     registra su propio analizador de contenido que conserva el buffer:
 *     reserializar el JSON cambia bytes y la firma dejaria de coincidir.
 *  2. Se responde 200 de inmediato y se procesa despues. Meta reintenta si la
 *     respuesta tarda, y un reintento con la ingesta a medias duplicaria.
 *  3. La ingesta es idempotente por (cuenta, id externo), asi que un reintento
 *     de Meta no crea comentarios repetidos.
 *  4. Un evento con firma invalida se descarta antes de tocar la base.
 */

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const challengeSchema = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Analizador propio de este ambito: conserva el cuerpo crudo y ademas lo
  // interpreta como JSON.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      try {
        done(null, body.length === 0 ? {} : JSON.parse(body.toString('utf8')));
      } catch {
        done(new Error('Cuerpo JSON invalido'), undefined);
      }
    },
  );

  /** Verificacion de la suscripcion (Meta hace un GET con un reto). */
  app.get('/meta', async (request, reply) => {
    const query = challengeSchema.parse(request.query);
    const provider = getSocialProvider();

    const challenge = provider.verifyWebhookChallenge({
      mode: query['hub.mode'],
      token: query['hub.verify_token'],
      challenge: query['hub.challenge'],
    });

    if (!challenge) {
      request.log.warn('Reto de webhook rechazado: token de verificacion invalido');
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Token invalido' } });
    }

    return reply.type('text/plain').send(challenge);
  });

  /** Entrega de eventos. */
  app.post('/meta', async (request, reply) => {
    const provider = getSocialProvider();
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const signature = request.headers['x-hub-signature-256'];

    const validSignature = provider.verifyWebhookSignature(
      rawBody,
      typeof signature === 'string' ? signature : undefined,
    );

    if (!validSignature) {
      request.log.warn({ ip: request.ip }, 'Webhook con firma invalida; se descarta');
      return reply
        .status(401)
        .send({ error: { code: 'INVALID_SIGNATURE', message: 'Firma invalida' } });
    }

    // Se responde ya. Meta reintenta si la respuesta tarda mas de 20 segundos.
    reply.status(200).send({ received: true });

    const payloadHash = sha256Hex(rawBody);

    // Registro idempotente del evento: si el mismo cuerpo llega de nuevo, no
    // se vuelve a procesar.
    try {
      await prisma.webhookEvent.create({
        data: { provider: 'meta', externalId: payloadHash, payloadHash },
      });
    } catch {
      request.log.info({ payloadHash }, 'Evento de webhook ya recibido; se ignora');
      return;
    }

    try {
      const interactions = provider.parseWebhook(request.body);
      const summary = await ingestInteractions(interactions);

      await prisma.webhookEvent.update({
        where: { provider_externalId: { provider: 'meta', externalId: payloadHash } },
        data: { processedAt: new Date() },
      });

      request.log.info({ ...summary }, 'Webhook procesado');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await prisma.webhookEvent.update({
        where: { provider_externalId: { provider: 'meta', externalId: payloadHash } },
        data: { error: message.slice(0, 500) },
      });

      request.log.error({ err: message }, 'Fallo al procesar el webhook');
    }
  });
}
