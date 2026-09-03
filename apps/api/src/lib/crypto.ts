import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { getConfig } from '../config/env.js';
import { AppError } from './errors.js';

/**
 * Primitivas criptograficas.
 *
 * Se usa unicamente el modulo nativo de Node: menos dependencias que auditar
 * y sin binarios nativos que compilar en el servidor de la universidad.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recomendado para GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = getConfig().ENCRYPTION_KEY;
  const key = Buffer.from(raw, 'base64');

  if (key.length !== KEY_LENGTH) {
    throw new AppError(
      `ENCRYPTION_KEY debe ser de ${KEY_LENGTH} bytes en base64; se recibieron ${key.length}`,
      { code: 'CONFIG_ERROR' },
    );
  }

  cachedKey = key;
  return key;
}

/**
 * Cifra un secreto (token de pagina de Meta) para guardarlo en la base.
 * Formato: base64(iv) . base64(authTag) . base64(ciphertext)
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    '.',
  );
}

/** Descifra un secreto. Lanza si el texto fue alterado (GCM autentica). */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new AppError('Secreto cifrado con formato invalido', { code: 'CRYPTO_ERROR' });
  }

  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, masterKey(), Buffer.from(ivB64, 'base64'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Token opaco de alta entropia para sesiones y CSRF. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash del token de sesion: la base nunca guarda el token en claro. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Comparacion en tiempo constante, resistente a ataques de temporizacion. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // timingSafeEqual exige la misma longitud; se compara el hash para no
  // filtrar la longitud del secreto.
  const hashA = createHash('sha256').update(bufferA).digest();
  const hashB = createHash('sha256').update(bufferB).digest();

  return timingSafeEqual(hashA, hashB);
}
