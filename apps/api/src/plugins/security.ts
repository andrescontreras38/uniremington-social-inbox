import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config/env.js';

/**
 * Endurecimiento de la capa HTTP.
 *
 *  - Helmet: CSP restrictiva, sin marcos, sin referrer, HSTS en produccion.
 *  - CORS: un unico origen explicito. Sin comodin, porque se envian cookies.
 *  - Rate limit: global, y mas estricto en el inicio de sesion (ver auth).
 *  - Cookies firmadas con la clave maestra.
 */

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // La API no sirve HTML propio; el frontend es una aplicacion aparte.
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  });

  await app.register(cors, {
    origin: [config.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token'],
    maxAge: 600,
  });

  await app.register(cookie, {
    secret: config.ENCRYPTION_KEY,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/',
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    // El webhook de Meta puede llegar en rafagas legitimas y ya viene
    // autenticado por firma HMAC; se excluye del limite general.
    allowList: (request) => request.url.startsWith('/api/webhooks/'),
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMITED',
        message: 'Demasiadas peticiones. Espere un momento e intente de nuevo.',
      },
    }),
  });
}
