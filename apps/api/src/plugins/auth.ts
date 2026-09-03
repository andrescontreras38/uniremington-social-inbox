import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config/env.js';
import type { Permission } from '../domain/permissions.js';
import { can } from '../domain/permissions.js';
import { safeCompare } from '../lib/crypto.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { resolveSession, type AuthUser } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthUser;
  }

  interface FastifyInstance {
    /** Exige sesion valida. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Exige sesion valida y un permiso concreto. */
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Autenticacion, CSRF y autorizacion.
 *
 * Defensa CSRF en dos capas, porque la sesion viaja en cookie:
 *  1. Verificacion del encabezado Origin contra el origen permitido.
 *  2. Doble envio de token: una cookie legible por el frontend cuyo valor debe
 *     repetirse en el encabezado x-csrf-token. Un sitio de terceros puede
 *     provocar la peticion, pero no leer la cookie para copiar el token.
 *
 * El webhook de Meta queda fuera: no usa cookies y se autentica por firma HMAC.
 */
export function registerAuth(app: FastifyInstance): void {
  const config = getConfig();

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[config.SESSION_COOKIE_NAME];
    if (!token) return;

    const user = await resolveSession(token);
    if (user) {
      request.currentUser = user;
    } else {
      // Sesion invalida o expirada: se limpia la cookie para no reintentar.
      request.cookies[config.SESSION_COOKIE_NAME] = undefined;
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    if (request.url.startsWith('/api/webhooks/')) return;
    // Los disparadores del programador (Vercel Cron) no son un navegador con
    // cookies: se autorizan por secreto compartido en internal.routes.ts.
    if (request.url.startsWith('/api/internal/')) return;
    // El inicio de sesion aun no tiene cookie de sesion, pero si valida Origin.
    const isLogin = request.url === '/api/auth/login';

    const origin = request.headers.origin;
    if (origin && origin !== config.WEB_ORIGIN) {
      return reply.status(403).send({
        error: { code: 'CSRF_ORIGIN_MISMATCH', message: 'Origen no autorizado' },
      });
    }

    if (isLogin) return;

    const cookieToken = request.cookies[config.CSRF_COOKIE_NAME];
    const headerToken = request.headers['x-csrf-token'];

    if (
      !cookieToken ||
      typeof headerToken !== 'string' ||
      !safeCompare(cookieToken, headerToken)
    ) {
      return reply.status(403).send({
        error: {
          code: 'CSRF_TOKEN_INVALID',
          message: 'Token de verificacion ausente o invalido. Recargue la pagina.',
        },
      });
    }
  });

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    if (!request.currentUser) throw new UnauthorizedError();
  });

  app.decorate('requirePermission', (permission: Permission) => {
    return async (request: FastifyRequest) => {
      const user = request.currentUser;
      if (!user) throw new UnauthorizedError();

      if (!can(user.role, permission)) {
        request.log.warn(
          { userId: user.id, role: user.role, permission },
          'Acceso denegado por permisos',
        );
        throw new ForbiddenError(`Su rol (${user.role}) no permite esta accion`);
      }
    };
  });
}

/** Datos del usuario autenticado; lanza si la ruta no exigio sesion. */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.currentUser) throw new UnauthorizedError();
  return request.currentUser;
}

/** Actor y contexto para el registro de auditoria. */
export function auditContextOf(request: FastifyRequest) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
