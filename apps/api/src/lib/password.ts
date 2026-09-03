import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { z } from 'zod';

/**
 * Envoltura de scrypt con promesas.
 *
 * No se usa promisify() porque pierde la sobrecarga de cuatro argumentos que
 * admite las opciones de coste (N, r, p), justo lo que aqui hace falta.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Hash de contrasenas con scrypt (RFC 7914), incluido en Node.
 *
 * Se elige scrypt sobre bcrypt o argon2 de npm porque no requiere compilar
 * binarios nativos en Windows ni en el servidor de la universidad, y porque
 * es una funcion de derivacion con coste de memoria, resistente a GPU.
 *
 * Parametros: N=2^15 (32768), r=8, p=1 -> ~64 MB de memoria por verificacion.
 * Formato almacenado: scrypt$N$r$p$salt$hash (todo en base64url).
 */

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt exige maxmem > 128 * N * r; se deja margen.
const MAX_MEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });

  return ['scrypt', N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const n = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }

  const expected = Buffer.from(hashRaw, 'base64url');
  const derived = await scrypt(
    password.normalize('NFKC'),
    Buffer.from(saltRaw, 'base64url'),
    expected.length,
    { N: n, r, p, maxmem: Math.max(MAX_MEM, 128 * n * r * 2) },
  );

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Politica de contrasenas.
 *
 * Sigue la recomendacion vigente del NIST SP 800-63B: longitud minima alta en
 * lugar de reglas de composicion caprichosas, y rechazo de contrasenas
 * evidentes. No se fuerza rotacion periodica.
 */
const OBVIOUS_PASSWORDS = new Set([
  'password',
  'contrasena',
  'contraseña',
  '12345678',
  '123456789',
  'uniremington',
  'remington',
  'qwertyui',
  'administrador',
]);

export const passwordSchema = z
  .string()
  .min(12, 'La contrasena debe tener al menos 12 caracteres')
  .max(128, 'La contrasena no puede superar 128 caracteres')
  .refine(
    (value) => !OBVIOUS_PASSWORDS.has(value.toLowerCase().trim()),
    'Esa contrasena es demasiado comun',
  )
  .refine(
    (value) => !/^(.)\1+$/.test(value),
    'La contrasena no puede ser un solo caracter repetido',
  );
