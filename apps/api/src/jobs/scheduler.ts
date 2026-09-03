import { getConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { purgeExpiredSessions } from '../services/auth.js';
import { syncAllAccounts } from '../services/sync.js';

/**
 * Trabajos programados.
 *
 * Se ejecutan dentro del proceso de la API porque el volumen lo permite: una
 * universidad con 122.000 seguidores genera comentarios en cientos por dia, no
 * en millones. Si eso cambia, ENABLE_JOBS=false en la API y este mismo modulo
 * se levanta en un proceso aparte sin tocar nada mas.
 */

const timers: NodeJS.Timeout[] = [];
let running = false;

/** Evita que dos pasadas se solapen si una tarda mas que el intervalo. */
export async function runExclusive(name: string, task: () => Promise<void>): Promise<void> {
  if (running) {
    logger.debug({ job: name }, 'Trabajo omitido: hay otra pasada en curso');
    return;
  }

  running = true;
  const startedAt = Date.now();

  try {
    await task();
    logger.info({ job: name, ms: Date.now() - startedAt }, 'Trabajo completado');
  } catch (error) {
    logger.error(
      { job: name, err: error instanceof Error ? error.message : String(error) },
      'Fallo un trabajo programado',
    );
  } finally {
    running = false;
  }
}

/**
 * Purga de datos vencidos (Ley 1581 de 2012, principio de temporalidad).
 *
 * Los comentarios de aspirantes y estudiantes no se conservan indefinidamente.
 * Se borran los cerrados que superan la retencion configurada; el registro de
 * auditoria y las metricas agregadas sobreviven porque no contienen el texto.
 */
export async function purgeExpiredData(): Promise<void> {
  const config = getConfig();
  if (config.DATA_RETENTION_DAYS === 0) return;

  const cutoff = new Date(Date.now() - config.DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.interaction.deleteMany({
    where: {
      remoteCreatedAt: { lt: cutoff },
      status: { in: ['ANSWERED', 'ARCHIVED', 'HIDDEN'] },
    },
  });

  const sessions = await purgeExpiredSessions();

  const webhooks = await prisma.webhookEvent.deleteMany({
    where: { receivedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
  });

  if (result.count > 0 || sessions > 0 || webhooks.count > 0) {
    logger.info(
      { interactions: result.count, sessions, webhookEvents: webhooks.count },
      'Purga de retencion ejecutada',
    );
  }
}

export function startScheduledJobs(): void {
  const config = getConfig();
  if (!config.ENABLE_JOBS) {
    logger.info('Trabajos programados deshabilitados (ENABLE_JOBS=false)');
    return;
  }

  const syncInterval = config.SYNC_INTERVAL_MINUTES * 60 * 1000;

  timers.push(
    setInterval(() => {
      void runExclusive('sync', async () => {
        const summary = await syncAllAccounts();
        if (summary.created > 0) {
          logger.info({ ...summary }, 'Sincronizacion periodica con novedades');
        }
      });
    }, syncInterval),
  );

  // La purga corre una vez al dia; no hace falta mas.
  timers.push(
    setInterval(
      () => {
        void runExclusive('retention', purgeExpiredData);
      },
      24 * 60 * 60 * 1000,
    ),
  );

  // Los temporizadores no deben impedir que el proceso termine.
  for (const timer of timers) timer.unref();

  logger.info(
    { syncMinutes: config.SYNC_INTERVAL_MINUTES, retentionDays: config.DATA_RETENTION_DAYS },
    'Trabajos programados iniciados',
  );
}

export function stopScheduledJobs(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
