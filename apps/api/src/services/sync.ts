import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { ingestInteractions, type IngestionSummary } from './ingestion.js';
import { getSocialProvider, resolveCredentials } from './social/index.js';

/**
 * Sincronizacion periodica.
 *
 * El webhook cubre lo que llega en tiempo real; esta pasada cubre lo que el
 * webhook pudo perder (caida de la API, evento no entregado) y detecta lo que
 * el equipo respondio directamente desde Meta, para dejar de mostrarlo como
 * pendiente.
 */

/** Cuanto historico se pide cuando la cuenta nunca se ha sincronizado. */
const FIRST_SYNC_DAYS = 30;
/** Solape para no perder comentarios que llegaron durante la pasada anterior. */
const OVERLAP_MINUTES = 10;

export async function syncAccount(accountId: string): Promise<IngestionSummary> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      provider: true,
      externalId: true,
      accessTokenCipher: true,
      isActive: true,
      lastSyncAt: true,
    },
  });

  if (!account || !account.isActive) {
    return { received: 0, created: 0, duplicates: 0, failed: 0, externalAnswers: 0 };
  }

  const since = account.lastSyncAt
    ? new Date(account.lastSyncAt.getTime() - OVERLAP_MINUTES * 60 * 1000)
    : new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);

  const provider = getSocialProvider();
  const interactions = await provider.fetchRecentInteractions(
    resolveCredentials(account),
    since,
  );

  const summary = await ingestInteractions(interactions);

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: { lastSyncAt: new Date() },
  });

  logger.info({ account: account.name, ...summary }, 'Cuenta sincronizada');
  return summary;
}

export async function syncAllAccounts(): Promise<IngestionSummary> {
  const accounts = await prisma.socialAccount.findMany({
    where: { isActive: true, accessTokenCipher: { not: null } },
    select: { id: true, name: true },
  });

  const total: IngestionSummary = {
    received: 0,
    created: 0,
    duplicates: 0,
    failed: 0,
    externalAnswers: 0,
  };

  for (const account of accounts) {
    try {
      const summary = await syncAccount(account.id);
      total.received += summary.received;
      total.created += summary.created;
      total.duplicates += summary.duplicates;
      total.failed += summary.failed;
      total.externalAnswers += summary.externalAnswers;
    } catch (error) {
      // Un token vencido en una sede no puede detener la sincronizacion de las
      // demas cuentas.
      logger.error(
        { account: account.name, err: error instanceof Error ? error.message : String(error) },
        'Fallo la sincronizacion de una cuenta',
      );
    }
  }

  return total;
}
