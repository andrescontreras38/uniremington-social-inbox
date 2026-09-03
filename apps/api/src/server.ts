import { buildApp } from './app.js';
import { getConfig } from './config/env.js';
import { startScheduledJobs, stopScheduledJobs } from './jobs/scheduler.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';

/**
 * Punto de entrada.
 *
 * Apagado ordenado: se deja de aceptar conexiones, se espera a que terminen
 * las peticiones en curso y se cierra la base. Publicar una respuesta a medias
 * porque el proceso murio seria peor que no publicarla.
 */

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Apagando el servicio');
    stopScheduledJobs();

    const forceExit = setTimeout(() => {
      logger.error('El apagado ordenado excedio el tiempo limite; se fuerza la salida');
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    try {
      await app.close();
      await disconnectPrisma();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error durante el apagado');
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Promesa rechazada sin manejar');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Excepcion no capturada');
    void shutdown('uncaughtException');
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  startScheduledJobs();

  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      provider: config.SOCIAL_PROVIDER,
      ai: config.AI_ENABLED
        ? `clasifica:${config.AI_MODEL_CLASSIFY} redacta:${config.AI_MODEL_DRAFT}`
        : 'deshabilitada',
    },
    'Bandeja Uniremington en funcionamiento',
  );
}

main().catch((error: unknown) => {
  // Un fallo de configuracion se ve aqui, antes de que nada quede a medias.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`No se pudo iniciar el servicio:\n${message}\n`);
  process.exit(1);
});
