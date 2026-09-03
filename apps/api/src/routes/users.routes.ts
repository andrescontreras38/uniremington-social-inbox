import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role } from '../domain/enums.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { hashPassword, passwordSchema } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { auditContextOf, requireUser } from '../plugins/auth.js';
import { recordAudit } from '../services/audit.js';
import { revokeAllSessions } from '../services/auth.js';

/**
 * Gestion de usuarios.
 *
 * La propuesta ofrece usuarios ilimitados sin costo por persona, asi que la
 * institucion crea los que necesite. Aqui importa el rol: define quien puede
 * aprobar y publicar en nombre de Uniremington.
 */

const idParams = z.object({ id: z.string().cuid() });

const createSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(2).max(120),
  role: Role,
  password: passwordSchema,
  mustChangePassword: z.boolean().default(true),
});

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: Role.optional(),
  isActive: z.boolean().optional(),
});

const resetSchema = z.object({ password: passwordSchema });

const publicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  mustChangePassword: true,
  createdAt: true,
};

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { onRequest: [app.requirePermission('users:read')] }, async () => {
    const users = await prisma.user.findMany({
      select: publicSelect,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return { users };
  });

  app.post('/', { onRequest: [app.requirePermission('users:write')] }, async (request) => {
    const body = createSchema.parse(request.body);
    const actor = requireUser(request);
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictError('Ya existe un usuario con ese correo');

    const user = await prisma.user.create({
      data: {
        email,
        name: body.name,
        role: body.role,
        passwordHash: await hashPassword(body.password),
        mustChangePassword: body.mustChangePassword,
      },
      select: publicSelect,
    });

    await recordAudit({
      actor: { id: actor.id, email: actor.email },
      action: 'user.created',
      entityType: 'User',
      entityId: user.id,
      metadata: { email, role: body.role },
      context: auditContextOf(request),
    });

    return { user };
  });

  app.patch('/:id', { onRequest: [app.requirePermission('users:write')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateSchema.parse(request.body);
    const actor = requireUser(request);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new NotFoundError('Usuario');

    // Nadie puede quitarse a si mismo el rol ni desactivarse: evita quedarse
    // sin ningun administrador por accidente.
    if (id === actor.id && (body.role !== undefined || body.isActive === false)) {
      throw new ConflictError('No puede cambiar su propio rol ni desactivar su cuenta');
    }

    if (target.role === 'ADMIN' && (body.role !== undefined || body.isActive === false)) {
      const remainingAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: id } },
      });
      if (remainingAdmins === 0) {
        throw new ConflictError('Debe quedar al menos un administrador activo');
      }
    }

    const user = await prisma.user.update({ where: { id }, data: body, select: publicSelect });

    // Cambiar el rol o desactivar cierra las sesiones abiertas: los permisos
    // se resuelven por sesion y no deben quedar obsoletos.
    if (body.role !== undefined || body.isActive === false) {
      await revokeAllSessions(id);
    }

    await recordAudit({
      actor: { id: actor.id, email: actor.email },
      action: body.isActive === false ? 'user.deactivated' : 'user.updated',
      entityType: 'User',
      entityId: id,
      metadata: body,
      context: auditContextOf(request),
    });

    return { user };
  });

  /** Restablece la contrasena de otra persona; obliga a cambiarla al entrar. */
  app.post(
    '/:id/reset-password',
    { onRequest: [app.requirePermission('users:write')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = resetSchema.parse(request.body);
      const actor = requireUser(request);

      await prisma.user.update({
        where: { id },
        data: {
          passwordHash: await hashPassword(body.password),
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      await revokeAllSessions(id);

      await recordAudit({
        actor: { id: actor.id, email: actor.email },
        action: 'user.updated',
        entityType: 'User',
        entityId: id,
        metadata: { passwordReset: true },
        context: auditContextOf(request),
      });

      return { ok: true };
    },
  );
}
