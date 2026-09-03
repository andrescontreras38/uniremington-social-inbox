import { pino, type LoggerOptions } from 'pino';
import { getConfig } from '../config/env.js';

/**
 * Logger de la aplicacion.
 *
 * Dos cuidados especificos:
 *  - Los secretos (tokens de Meta, cookies, cabeceras de autorizacion,
 *    claves) se redactan antes de escribirse.
 *  - El texto de comentarios y mensajes directos NO se registra en claro;
 *    quien necesite registrarlo debe pasarlo por maskPii() primero.
 */

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hub-signature-256"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'accessToken',
  'accessTokenCipher',
  'apiKey',
  'ANTHROPIC_API_KEY',
  'META_APP_SECRET',
  'ENCRYPTION_KEY',
  '*.password',
  '*.accessToken',
];

export function buildLoggerOptions(): LoggerOptions {
  const config = getConfig();

  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redactado]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    // En desarrollo se imprime legible; en produccion, JSON para el agregador.
    ...(config.isProduction
      ? {}
      : {
          transport: {
            target: 'pino/file',
            options: { destination: 1 },
          },
        }),
    serializers: {
      req(request: { method: string; url: string; id: string; ip: string }) {
        return {
          id: request.id,
          method: request.method,
          url: request.url,
          ip: request.ip,
        };
      },
    },
  };
}

export const logger = pino(buildLoggerOptions());
