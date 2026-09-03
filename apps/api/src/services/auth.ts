import { getConfig } from '../config/env.js';
import type { Role } from '../domain/enums.js';
import { permissionsOf, type Permission } from '../domain/permissions.js';
import { generateToken, hashToken } from '../lib/crypto.js';
import { UnauthorizedError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';

/**
 * Autenticacion por sesion.
 *
 * Se usan sesiones opacas en cookie httpOnly en lugar de un JWT en
 * localStorage: la cookie no es legible por JavaScript (mitiga XSS), la sesion
 * se puede revocar al instante desde el servidor, y no hay token de larga vida
 * circulando por el navegador. El costo es una consulta por peticion, que en
 * una bandeja de trabajo interna no es un problema.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
}

export interface LoginContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  user: AuthUser;
  token: string;
  expiresAt: Date;
}

function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
}): AuthUser {
  const role = user.role as Role;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    permissions: permissionsOf(role),
    mustChangePassword: user.mustChangePassword,
  };
}

export async function login(
  email: string,
  password: string,
  context: LoginContext = {},
): Promise<LoginResult> {
  const config = getConfig();
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Se verifica una contrasena ficticia cuando el usuario no existe para que
  // el tiempo de respuesta no revele si el correo esta registrado.
  if (!user) {
    await verifyPassword(password, await hashPassword('inexistente'));
    throw new UnauthorizedError();
  }

  if (!user.isActive) {
    throw new UnauthorizedError('La cuenta esta desactivada');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedError(
      'La cuenta esta bloqueada temporalmente por intentos fallidos. Intente mas tarde.',
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= config.LOGIN_MAX_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + config.LOGIN_LOCKOUT_MINUTES * 60 * 1000)
          : null,
      },
    });

    throw new UnauthorizedError();
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 300) ?? null,
        expiresAt,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    }),
  ]);

  return { user: toAuthUser(user), token, expiresAt };
}

/**
 * Resuelve la sesion de una peticion.
 *
 * Ademas de la expiracion absoluta se aplica una de inactividad: una pestana
 * abierta y olvidada en un equipo compartido deja de servir.
 */
export async function resolveSession(token: string): Promise<AuthUser | null> {
  const config = getConfig();
  const now = new Date();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          mustChangePassword: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (!session.user.isActive) return null;

  const idleLimit = config.SESSION_IDLE_MINUTES * 60 * 1000;
  if (now.getTime() - session.lastSeenAt.getTime() > idleLimit) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return null;
  }

  // Se actualiza como maximo una vez por minuto para no escribir en cada peticion.
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  return toAuthUser(session.user);
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Cierra todas las sesiones de un usuario (cambio de contrasena, baja). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) throw new UnauthorizedError();

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new UnauthorizedError('La contrasena actual no es correcta');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    },
  });

  // Cambiar la contrasena cierra las demas sesiones abiertas.
  await revokeAllSessions(user.id);
}

/** Limpia sesiones vencidas. Lo invoca el trabajo programado de mantenimiento. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return result.count;
}
