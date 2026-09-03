import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildApp } from '../apps/api/src/app.js';

/**
 * Punto de entrada serverless (Vercel).
 *
 * Reutiliza exactamente la misma app que corre en un servidor persistente
 * (apps/api/src/server.ts): buildApp() no abre un puerto, asi que sirve igual
 * en los dos entornos. La diferencia esta en como se levanta:
 *
 *  - server.ts: llama a app.listen() y arranca los trabajos programados
 *    (setInterval) para un proceso que se queda vivo.
 *  - este archivo: no escucha ningun puerto ni programa nada; Vercel invoca
 *    el handler en cada peticion, y la sincronizacion periodica llega por
 *    HTTP desde Vercel Cron contra /api/internal/sync (ver vercel.json).
 *
 * La instancia de Fastify se memoriza en el modulo: mientras la funcion siga
 * "caliente" entre invocaciones, no se reconstruye la app ni se abren
 * conexiones nuevas a la base en cada peticion.
 */

let appPromise: ReturnType<typeof buildApp> | null = null;

async function getApp() {
  appPromise ??= buildApp();
  const app = await appPromise;
  await app.ready();
  return app;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const app = await getApp();
  app.server.emit('request', request, response);
}
