import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getConfig } from './config/env.js';
import { buildLoggerOptions } from './lib/logger.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { accountRoutes } from './routes/accounts.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { inboxRoutes } from './routes/inbox.routes.js';
import { internalRoutes } from './routes/internal.routes.js';
import { alertRoutes, auditRoutes, healthRoutes, toneRoutes } from './routes/misc.routes.js';
import { templateRoutes } from './routes/templates.routes.js';
import { replyRoutes } from './routes/replies.routes.js';
import { userRoutes } from './routes/users.routes.js';
import { webhookRoutes } from './routes/webhooks.routes.js';

/**
 * Construccion de la aplicacion.
 *
 * Se separa de server.ts para poder levantarla en memoria durante las pruebas
 * sin abrir un puerto.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const config = getConfig();

  const app = Fastify({
    logger: buildLoggerOptions(),
    // Identificador propio por peticion: es lo que se le da al usuario cuando
    // algo falla, y lo que permite encontrar el error en los logs.
    genReqId: () => randomUUID(),
    trustProxy: config.isProduction,
    // Un comentario no ocupa mas que esto; el limite corta cargas absurdas.
    bodyLimit: 1_048_576,
    ajv: { customOptions: { removeAdditional: 'all' } },
  });

  await app.register(sensible);
  await registerSecurity(app);
  registerAuth(app);
  registerErrorHandler(app);

  await app.register(healthRoutes, { prefix: '/api/health' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(inboxRoutes, { prefix: '/api/inbox' });
  await app.register(replyRoutes, { prefix: '/api/replies' });
  await app.register(accountRoutes, { prefix: '/api/accounts' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.register(alertRoutes, { prefix: '/api/alerts' });
  await app.register(toneRoutes, { prefix: '/api/tone' });
  await app.register(templateRoutes, { prefix: '/api/templates' });
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(internalRoutes, { prefix: '/api/internal' });

  return app;
}
