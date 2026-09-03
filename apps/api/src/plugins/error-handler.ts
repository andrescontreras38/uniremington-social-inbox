import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { getConfig } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/**
 * Manejo centralizado de errores.
 *
 * Regla: al cliente se le dice que salio mal solo cuando eso no revela nada
 * del interior del sistema. Los errores de la base, de la Graph API o del
 * modelo se registran completos con el id de la peticion y se responden con un
 * mensaje generico.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

export function registerErrorHandler(app: FastifyInstance): void {
  const config = getConfig();

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'La ruta solicitada no existe',
        requestId: request.id,
      },
    } satisfies ErrorBody);
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ZodError) {
      request.log.info({ issues: error.issues }, 'Peticion invalida');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son validos',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
          requestId,
        },
      } satisfies ErrorBody);
    }

    if (error instanceof AppError) {
      const level = error.statusCode >= 500 ? 'error' : 'info';
      request.log[level]({ err: error, code: error.code }, error.message);

      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : 'No se pudo completar la operacion',
          details: error.expose ? error.details : undefined,
          requestId,
        },
      } satisfies ErrorBody);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      request.log.error({ err: error, prismaCode: error.code }, 'Error de base de datos');

      if (error.code === 'P2002') {
        return reply.status(409).send({
          error: {
            code: 'CONFLICT',
            message: 'Ya existe un registro con esos datos',
            requestId,
          },
        } satisfies ErrorBody);
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Recurso no encontrado', requestId },
        } satisfies ErrorBody);
      }
    }

    // Errores propios de Fastify (esquema de ruta, tamano de cuerpo) y todo lo
    // demas. El tipo se ensancha tras las comprobaciones anteriores, asi que se
    // lee de forma defensiva.
    const fallback = error as { statusCode?: number; code?: string; message?: string };
    const statusCode = typeof fallback.statusCode === 'number' ? fallback.statusCode : 500;
    const message = fallback.message ?? 'Error desconocido';

    if (statusCode < 500) {
      request.log.info({ err: error }, 'Peticion rechazada');
      return reply.status(statusCode).send({
        error: {
          code: fallback.code ?? 'BAD_REQUEST',
          message,
          requestId,
        },
      } satisfies ErrorBody);
    }

    request.log.error({ err: error }, 'Error no controlado');

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: config.isProduction
          ? 'Ocurrio un error interno. El equipo tecnico puede rastrearlo con el identificador de la peticion.'
          : message,
        requestId,
      },
    } satisfies ErrorBody);
  });
}
