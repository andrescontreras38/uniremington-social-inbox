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

export async function syncAccount(
  accountId: string,
  options?: { sinceDays?: number },
): Promise<IngestionSummary> {
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

  // sinceDays fuerza una ventana explicita (para traer historico viejo),
  // ignorando lastSyncAt: sin esto, una cuenta ya sincronizada nunca vuelve a
  // pedir nada anterior a su ultima pasada.
  const since = options?.sinceDays
    ? new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
    : account.lastSyncAt
      ? new Date(account.lastSyncAt.getTime() - OVERLAP_MINUTES * 60 * 1000)
      : new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);

  const provider = getSocialProvider();
  const interactions = await provider.fetchRecentInteractions(
    resolveCredentials(account),
    since,
  );

  // Solo se responde solo en una pasada normal sobre una cuenta que ya tenia
  // una sincronizacion previa: ni en la primera carga de una cuenta nueva (30
  // dias de historico) ni en un pedido explicito de historico (sinceDays),
  // para no publicar respuestas de la IA a comentarios viejos sin que nadie
  // lo pidiera.
  const autoRespond = Boolean(account.lastSyncAt) && !options?.sinceDays;
  const summary = await ingestInteractions(interactions, { autoRespond });

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: { lastSyncAt: new Date() },
  });

  logger.info({ account: account.name, ...summary }, 'Cuenta sincronizada');
  return summary;
}

export interface HistoricalBatchResult extends IngestionSummary {
  done: boolean;
}

/**
 * Importa un lote de TODO el historico, sin limite de fecha (a diferencia de
 * syncAccount, que solo mira los ultimos meses). Pensado para llamarse varias
 * veces seguidas -cada llamada procesa una pagina de publicaciones y avanza
 * el cursor guardado en la cuenta- hasta que `done` sea verdadero: ahi ya no
 * quedan publicaciones mas viejas por revisar. Nunca dispara respuesta
 * automatica: es historico, no algo que nadie esta esperando ahora mismo.
 */
export async function importHistoricalBatch(accountId: string): Promise<HistoricalBatchResult> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      provider: true,
      externalId: true,
      accessTokenCipher: true,
      isActive: true,
      historicalCursor: true,
    },
  });

  if (!account || !account.isActive) {
    return { received: 0, created: 0, duplicates: 0, failed: 0, externalAnswers: 0, done: true };
  }

  const provider = getSocialProvider();
  const { interactions, nextCursor } = await provider.fetchHistoricalBatch(
    resolveCredentials(account),
    account.historicalCursor,
  );

  const summary = await ingestInteractions(interactions);

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      historicalCursor: nextCursor,
      historicalImportedAt: nextCursor ? undefined : new Date(),
    },
  });

  logger.info(
    { account: account.name, ...summary, done: !nextCursor },
    'Lote de importacion historica',
  );

  return { ...summary, done: !nextCursor };
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
