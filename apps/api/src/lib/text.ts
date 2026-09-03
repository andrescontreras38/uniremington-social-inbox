import { createHash } from 'node:crypto';

/**
 * Utilidades de texto para ahorrar llamadas al modelo.
 *
 * La bandeja de una universidad en convocatoria recibe la misma pregunta
 * decenas de veces: "precio?", "hay becas", "info por favor". Clasificar cada
 * copia por separado es pagar el mismo trabajo una y otra vez.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Huella de un texto para reconocer comentarios equivalentes.
 *
 * Normaliza mayusculas, tildes, espacios, signos y emojis, de modo que
 * "Precio??", "precio" y "PRECIO 🙏" compartan huella. No es una firma
 * criptografica de seguridad: es una clave de agrupacion.
 */
export function textFingerprint(text: string): string {
  const normalized = text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    // Se conservan letras, numeros y espacios; lo demas se descarta.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

/** Cuenta las letras reales, ignorando emojis, signos y espacios. */
export function letterCount(text: string): number {
  return (text.normalize('NFD').replace(COMBINING_MARKS, '').match(/[a-zA-Z]/g) ?? []).length;
}

/** Verdadero si el texto son solo menciones (@usuario) y simbolos. */
export function isMentionOnly(text: string): boolean {
  const withoutMentions = text.replace(/@[\w.]+/g, ' ');
  return letterCount(withoutMentions) === 0 && /@[\w.]+/.test(text);
}

const POSITIVE_EMOJI =
  /[❤\u{1F495}-\u{1F49F}\u{1F44F}\u{1F44D}\u{1F389}\u{1F38A}\u{1F60D}\u{1F60A}\u{1F600}-\u{1F60F}\u{1F929}\u{1F970}]/u;

/** Verdadero si el texto no tiene letras pero si emojis o simbolos de aprecio. */
export function isPositiveReaction(text: string): boolean {
  return letterCount(text) === 0 && POSITIVE_EMOJI.test(text);
}

/**
 * Recorta un texto a un maximo de caracteres.
 *
 * Los comentarios de Instagram y Facebook casi nunca pasan de 300 caracteres;
 * el limite existe para que un caso extremo no dispare el costo de una
 * peticion, no para truncar rutinariamente.
 */
export function clamp(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
