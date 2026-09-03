import { PrismaClient } from '@prisma/client';
import { getConfig } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Cliente de base de datos, unico por proceso.
 *
 * En desarrollo se reutiliza la instancia entre recargas de tsx watch para no
 * agotar el pool de conexiones.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: getConfig().isProduction
      ? [{ emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
  });

prisma.$on('error' as never, (event: unknown) => {
  logger.error({ event }, 'Error de base de datos');
});

if (!getConfig().isProduction) {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
