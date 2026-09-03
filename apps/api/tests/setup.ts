import { randomBytes } from 'node:crypto';

/**
 * Entorno de pruebas.
 *
 * Se fija antes de que cualquier modulo lea la configuracion, para que las
 * pruebas no dependan del archivo .env de la maquina de quien las ejecuta.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'file:./test.db';
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.SOCIAL_PROVIDER = 'mock';
process.env.AI_ENABLED = 'false';
process.env.META_APP_SECRET = 'secreto-de-prueba';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-de-prueba';
