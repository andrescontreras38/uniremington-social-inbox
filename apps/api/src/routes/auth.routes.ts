import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { generateToken } from '../lib/crypto.js';
import { passwordSchema } from '../lib/password.js';
import { auditContextOf, requireUser } from '../plugins/auth.js';
import {
  changePassword,
  login,
  revokeSession,
  type AuthUser,
} from '../services/auth.js';
import { recordAudit } from '../services/audit.js';

const loginSchema = z.object({
  email: z.string().email('Correo invalido').max(200),
  password: z.string().min(1, 'La contrasena es obligatoria').max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

/** Escribe las cookies de sesion y de verificacion CSRF. */
function setAuthCookies(reply: FastifyReply, token: string, expiresAt: Date): void {
  const config = getConfig();
  const csrfToken = generateToken(24);

  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    expires: expiresAt,
  });

  // Esta cookie SI la lee el frontend: su valor debe repetirse en el
  // encabezado x-csrf-token. No contiene informacion sensible.
  reply.setCookie(config.CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    expires: expiresAt,
  });
}

function clearAuthCookies(reply: FastifyReply): void {
  const config = getConfig();
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(config.CSRF_COOKIE_NAME, { path: '/' });
}

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/login',
    {
      // Limite estricto y separado del general: el inicio de sesion es el
      // objetivo natural de un ataque de fuerza bruta.
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const context = auditContextOf(request);

      try {
        const result = await login(body.email, body.password, context);
        setAuthCookies(reply, result.token, result.expiresAt);

        await recordAudit({
          actor: { id: result.user.id, email: result.user.email },
          action: 'auth.login',
          entityType: 'User',
          entityId: result.user.id,
          context,
        });

        return { user: publicUser(result.user) };
      } catch (error) {
        await recordAudit({
          actor: { id: null, email: body.email.toLowerCase() },
          action: 'auth.login_failed',
          entityType: 'User',
          context,
        });
        throw error;
      }
    },
  );

  app.post('/logout', { onRequest: [app.requireAuth] }, async (request, reply) => {
    const config = getConfig();
    const user = requireUser(request);
    const token = request.cookies[config.SESSION_COOKIE_NAME];

    if (token) await revokeSession(token);
    clearAuthCookies(reply);

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'auth.logout',
      entityType: 'User',
      entityId: user.id,
      context: auditContextOf(request),
    });

    return { ok: true };
  });

  app.get('/me', { onRequest: [app.requireAuth] }, async (request) => {
    return { user: publicUser(requireUser(request)) };
  });

  app.post(
    '/change-password',
    {
      onRequest: [app.requireAuth],
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const body = changePasswordSchema.parse(request.body);

      await changePassword(user.id, body.currentPassword, body.newPassword);
      clearAuthCookies(reply);

      await recordAudit({
        actor: { id: user.id, email: user.email },
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: user.id,
        context: auditContextOf(request),
      });

      // Cambiar la contrasena cierra todas las sesiones: hay que volver a entrar.
      return { ok: true, message: 'Contrasena actualizada. Inicie sesion nuevamente.' };
    },
  );
}
