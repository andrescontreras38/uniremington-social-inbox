import type { PiiFlag } from '../domain/enums.js';

/**
 * Deteccion y enmascaramiento de datos personales.
 *
 * Cumple dos funciones distintas:
 *  1. Marcar interacciones que, por acuerdo con Uniremington, nunca pueden
 *     resolverse con respuesta asistida (cedula, dato financiero, dato de
 *     salud, ataque personal).
 *  2. Enmascarar el texto antes de escribirlo en logs, alertas por correo o
 *     en el registro de auditoria. La Ley 1581 de 2012 exige tratar estos
 *     datos con finalidad limitada; el log de la aplicacion no es esa
 *     finalidad.
 *
 * La deteccion es deliberadamente conservadora: prefiere marcar de mas y
 * enviar a una persona antes que dejar pasar un dato sensible.
 */

/** Marcas diacriticas combinantes (tildes, dieresis) en Unicode. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Quita tildes y pasa a minusculas para comparar sin depender de la escritura. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase();
}

/** Documento de identidad: 6 a 11 digitos aislados, con o sin separadores. */
const DOCUMENT_RE = /(?<!\d)(?:\d{1,3}[.\s]){1,3}\d{3}(?!\d)|(?<!\d)\d{6,11}(?!\d)/g;

/**
 * Valor en pesos colombianos: el mismo formato con puntos de una cedula
 * (25.119.100), asi que un precio verificado que el redactor cita tal cual
 * quedaria marcado como dato personal y bloqueado en publishReply. Se
 * retira del texto ANTES de buscar documentos -igual que ya se hace con los
 * telefonos-, en vez de excluirlo con un lookbehind: un lookbehind solo
 * protege el inicio del numero, y la busqueda de documentos igual encuentra
 * una coincidencia mas adentro (p. ej. "119.100" dentro de "$ 25.119.100").
 */
const CURRENCY_RE = /\$\s?\d{1,3}(?:[.\s]\d{3})+/g;

/**
 * Telefono colombiano.
 *
 * Se exige una senal inequivoca de que el numero es telefonico: movil que
 * empieza por 3, indicativo entre parentesis, o prefijo +57. Sin esa senal, un
 * numero de diez digitos es mas probablemente una cedula, y confundirlos
 * distorsiona el reporte que ve el equipo.
 */
const PHONE_RE =
  /(?:\+?57[\s-]?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)|\(\d{1,4}\)[\s-]?\d{3}[\s-]?\d{4}(?!\d)|\+57[\s-]?\d{7,10}(?!\d)/g;

const EMAIL_RE = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi;

/** Numero de tarjeta: 13 a 19 digitos en grupos. */
const CARD_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

const FINANCIAL_TERMS = [
  'numero de cuenta',
  'cuenta bancaria',
  'cuenta de ahorros',
  'nequi',
  'daviplata',
  'tarjeta de credito',
  'tarjeta debito',
  'codigo de seguridad',
  'clave dinamica',
  'referencia de pago',
];

/**
 * Terminos de salud.
 *
 * Se evitan raices demasiado amplias: "psicolog" marcaria como dato de salud
 * cualquier pregunta por el programa de Psicologia, que es justo el comentario
 * que la herramienta debe poder responder. Por eso los terminos ambiguos se
 * exigen acompanados de contexto clinico.
 */
const HEALTH_TERMS = [
  'incapacidad medica',
  'diagnostico',
  'enfermedad',
  'embarazo',
  'atencion psicologica',
  'consulta psicologica',
  'tratamiento psicologico',
  'tratamiento psiquiatrico',
  'discapacidad',
  'tratamiento medico',
  'medicamento',
  'historia clinica',
  'cancer',
  'depresion',
  'mi eps',
  'la eps',
];

const ADDRESS_RE =
  /\b(?:calle|carrera|cra|cr|kr|avenida|av|diagonal|transversal|manzana|barrio)\s*\.?\s*\d+[\w\s#\-.]{0,20}/gi;

const ATTACK_TERMS = [
  'estafa',
  'estafador',
  'ladron',
  'ladrones',
  'roban',
  'robaron',
  'fraude',
  'corrupto',
  'demanda',
  'tutela',
  'denuncia',
  'basura',
  'porqueria',
  'inutil',
  'incompetente',
  'verguenza',
];

export interface PiiScan {
  flags: PiiFlag[];
  /** Verdadero si algo obliga a que responda una persona. */
  requiresHuman: boolean;
}

/** Detecta datos personales y senales de conflicto en un texto libre. */
export function scanPii(text: string): PiiScan {
  const flags = new Set<PiiFlag>();
  const plain = normalize(text);

  // El correo se descarta del texto antes de buscar numeros para no confundir
  // el dominio de un correo con un documento.
  const withoutEmails = text.replace(EMAIL_RE, ' ');

  if (EMAIL_RE.test(text)) flags.add('EMAIL');
  EMAIL_RE.lastIndex = 0;

  const phones = withoutEmails.match(PHONE_RE) ?? [];
  if (phones.some((match) => match.replace(/\D/g, '').length >= 7)) {
    flags.add('PHONE');
  }
  PHONE_RE.lastIndex = 0;

  const cards = withoutEmails.match(CARD_RE) ?? [];
  if (cards.some((match) => match.replace(/\D/g, '').length >= 13)) {
    flags.add('FINANCIAL');
  }
  CARD_RE.lastIndex = 0;

  // Los documentos se buscan sobre el texto sin telefonos ni valores en
  // pesos ya reconocidos.
  const withoutPhones = withoutEmails.replace(PHONE_RE, ' ').replace(CURRENCY_RE, ' ');
  PHONE_RE.lastIndex = 0;
  CURRENCY_RE.lastIndex = 0;
  const documents = withoutPhones.match(DOCUMENT_RE) ?? [];
  if (documents.some((match) => match.replace(/\D/g, '').length >= 6)) {
    flags.add('DOCUMENT_ID');
  }
  DOCUMENT_RE.lastIndex = 0;

  if (FINANCIAL_TERMS.some((term) => plain.includes(term))) flags.add('FINANCIAL');
  if (HEALTH_TERMS.some((term) => plain.includes(term))) flags.add('HEALTH');
  if (ATTACK_TERMS.some((term) => plain.includes(term))) flags.add('PERSONAL_ATTACK');

  if (ADDRESS_RE.test(text)) flags.add('ADDRESS');
  ADDRESS_RE.lastIndex = 0;

  return {
    flags: [...flags],
    requiresHuman: flags.size > 0,
  };
}

/**
 * Enmascara datos personales para logs, correos de alerta y auditoria.
 * Conserva lo suficiente para reconocer el caso sin exponer el dato.
 */
export function maskPii(text: string): string {
  return text
    .replace(EMAIL_RE, (match) => {
      const [user = '', domain = ''] = match.split('@');
      return `${user.slice(0, 2)}***@${domain}`;
    })
    .replace(PHONE_RE, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 7 ? `***${digits.slice(-3)}` : match;
    })
    .replace(CARD_RE, (match) =>
      match.replace(/\D/g, '').length >= 13 ? '**** tarjeta oculta ****' : match,
    )
    .replace(DOCUMENT_RE, (match) =>
      match.replace(/\D/g, '').length >= 6 ? '***documento***' : match,
    );
}

/** Recorta y enmascara un texto para dejarlo en un registro de auditoria. */
export function safeExcerpt(text: string, maxLength = 160): string {
  const masked = maskPii(text).replace(/\s+/g, ' ').trim();
  return masked.length > maxLength ? `${masked.slice(0, maxLength - 1)}…` : masked;
}
