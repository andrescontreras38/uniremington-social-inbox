import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Provider } from '../domain/enums.js';
import { encryptSecret } from '../lib/crypto.js';
import { NotFoundError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { auditContextOf, requireUser } from '../plugins/auth.js';
import { recordAudit } from '../services/audit.js';
import { importHistoricalBatch, syncAccount } from '../services/sync.js';

/**
 * Cuentas conectadas.
 *
 * El token de pagina entra una vez, se cifra con AES-256-GCM y no vuelve a
 * salir por ninguna ruta: la API solo informa si la cuenta esta conectada y
 * cuando vence el token.
 */

const idParams = z.object({ id: z.string().cuid() });

const createSchema = z.object({
  provider: Provider,
  externalId: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  campus: z.string().min(1).max(60).default('NACIONAL'),
  accessToken: z.string().min(10).max(500).optional(),
  tokenExpiresAt: z.coerce.date().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  campus: z.string().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});

const tokenSchema = z.object({
  accessToken: z.string().min(10).max(500),
  tokenExpiresAt: z.coerce.date().optional(),
});

const syncSchema = z.object({
  /** Ventana explicita en dias hacia atras; ignora la ultima sincronizacion. */
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
});

/** Proyeccion publica: nunca incluye el token, ni cifrado. */
const publicSelect = {
  id: true,
  provider: true,
  externalId: true,
  name: true,
  campus: true,
  isActive: true,
  lastSyncAt: true,
  tokenExpiresAt: true,
  createdAt: true,
  historicalCursor: true,
  historicalImportedAt: true,
  _count: { select: { interactions: true } },
};

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { onRequest: [app.requirePermission('accounts:read')] }, async () => {
    const accounts = await prisma.socialAccount.findMany({
      select: { ...publicSelect, accessTokenCipher: true },
      orderBy: [{ campus: 'asc' }, { name: 'asc' }],
    });

    return {
      accounts: accounts.map(({ accessTokenCipher, ...account }) => ({
        ...account,
        isConnected: Boolean(accessTokenCipher),
      })),
    };
  });

  app.post('/', { onRequest: [app.requirePermission('accounts:write')] }, async (request) => {
    const body = createSchema.parse(request.body);
    const user = requireUser(request);

    const account = await prisma.socialAccount.create({
      data: {
        provider: body.provider,
        externalId: body.externalId,
        name: body.name,
        campus: body.campus,
        accessTokenCipher: body.accessToken ? encryptSecret(body.accessToken) : null,
        tokenExpiresAt: body.tokenExpiresAt ?? null,
      },
      select: publicSelect,
    });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'account.created',
      entityType: 'SocialAccount',
      entityId: account.id,
      metadata: { provider: body.provider, name: body.name, campus: body.campus },
      context: auditContextOf(request),
    });

    return { account };
  });

  app.patch('/:id', { onRequest: [app.requirePermission('accounts:write')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateSchema.parse(request.body);
    const user = requireUser(request);

    const account = await prisma.socialAccount.update({
      where: { id },
      data: body,
      select: publicSelect,
    });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'account.updated',
      entityType: 'SocialAccount',
      entityId: id,
      metadata: body,
      context: auditContextOf(request),
    });

    return { account };
  });

  /** Rota el token de pagina. El anterior queda sobrescrito, no archivado. */
  app.post(
    '/:id/token',
    { onRequest: [app.requirePermission('accounts:write')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = tokenSchema.parse(request.body);
      const user = requireUser(request);

      await prisma.socialAccount.update({
        where: { id },
        data: {
          accessTokenCipher: encryptSecret(body.accessToken),
          tokenExpiresAt: body.tokenExpiresAt ?? null,
          // Rotar el token es la forma de reconectar una cuenta desactivada:
          // no tiene sentido pedir un token nuevo para dejarla inactiva.
          isActive: true,
        },
      });

      await recordAudit({
        actor: { id: user.id, email: user.email },
        action: 'account.token_rotated',
        entityType: 'SocialAccount',
        entityId: id,
        // Nunca se registra el token, ni su prefijo.
        metadata: { expiresAt: body.tokenExpiresAt?.toISOString() ?? null },
        context: auditContextOf(request),
      });

      return { ok: true };
    },
  );

  /** Sincroniza el historico reciente de una cuenta bajo demanda. */
  app.post(
    '/:id/sync',
    {
      onRequest: [app.requirePermission('accounts:write')],
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const { sinceDays } = syncSchema.parse(request.body ?? {});

      const account = await prisma.socialAccount.findUnique({ where: { id }, select: { id: true } });
      if (!account) throw new NotFoundError('Cuenta');

      const summary = await syncAccount(id, sinceDays ? { sinceDays } : undefined);
      return { summary };
    },
  );

  /**
   * Un lote de la importacion de todo el historico (sin limite de fecha).
   * El cliente llama esta ruta repetidas veces hasta que `done` sea
   * verdadero: cada llamada avanza el cursor guardado en la cuenta.
   */
  app.post(
    '/:id/import-historical',
    {
      onRequest: [app.requirePermission('accounts:write')],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => {
      const { id } = idParams.parse(request.params);

      const account = await prisma.socialAccount.findUnique({ where: { id }, select: { id: true } });
      if (!account) throw new NotFoundError('Cuenta');

      const summary = await importHistoricalBatch(id);
      return { summary };
    },
  );

  app.delete('/:id', { onRequest: [app.requirePermission('accounts:write')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const user = requireUser(request);

    // Se desactiva en lugar de borrar: eliminar la cuenta arrastraria el
    // historico de interacciones y con el la trazabilidad.
    await prisma.socialAccount.update({
      where: { id },
      data: { isActive: false, accessTokenCipher: null },
    });

    await recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'account.deleted',
      entityType: 'SocialAccount',
      entityId: id,
      context: auditContextOf(request),
    });

    return { ok: true };
  });
}
