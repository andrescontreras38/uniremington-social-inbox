import type { PiiFlag, Sentiment, Topic, Urgency } from './enums.js';

/**
 * Politica de automatizacion.
 *
 * Traduce a codigo el acuerdo explicito de la reunion del 25 de agosto:
 *
 *   VA CON RESPUESTA ASISTIDA
 *     - Preguntas repetidas de horarios, costos, sedes y fechas
 *     - Agradecimientos, felicitaciones y comentarios de grado
 *     - Solicitudes de informacion que se resuelven con un enlace
 *     - Dudas simples sobre un programa o una modalidad
 *
 *   SIEMPRE PASA A UNA PERSONA
 *     - Reclamos y quejas formales, sin excepcion
 *     - Cualquier caso con dato personal, financiero o de salud
 *     - Senalamientos, conflictos y todo lo que huela a crisis
 *     - Consultas academicas que exigen mirar el expediente del estudiante
 *
 * Aclaracion que la propuesta pide repetir y que este modulo NO decide:
 * ni siquiera lo de la primera columna se publica solo. La IA redacta, una
 * persona aprueba. Eso se garantiza en services/replies/reply-service.ts.
 */

/** Temas que, por si solos, obligan intervencion humana. */
const HUMAN_ONLY_TOPICS: ReadonlySet<Topic> = new Set(['COMPLAINT']);

/** Banderas de datos que obligan intervencion humana. */
const HUMAN_ONLY_PII: ReadonlySet<PiiFlag> = new Set([
  'DOCUMENT_ID',
  'FINANCIAL',
  'HEALTH',
  'PERSONAL_ATTACK',
  'PHONE',
  'EMAIL',
  'ADDRESS',
]);

/**
 * Expresiones que indican una consulta atada al expediente del estudiante.
 * Requieren mirar el sistema academico, no un enlace publico.
 */
const STUDENT_RECORD_PATTERNS = [
  /mi\s+(nota|notas|promedio|matricula|semestre|certificado|homologaci)/i,
  /no\s+me\s+(aparece|sale|figura|registr)/i,
  /revisar?\s+mi\s+caso/i,
  /mi\s+(usuario|cuenta|plataforma)/i,
  /me\s+(cobraron|descontaron|debitaron)/i,
];

export interface PolicyInput {
  topic: Topic;
  sentiment: Sentiment;
  urgency: Urgency;
  piiFlags: PiiFlag[];
  text: string;
}

export interface PolicyDecision {
  /** Verdadero cuando ninguna respuesta asistida es admisible. */
  requiresHuman: boolean;
  /** Verdadero cuando la IA puede proponer un borrador para aprobacion. */
  allowAssistedDraft: boolean;
  /** Motivos legibles, se muestran en la bandeja y quedan en auditoria. */
  reasons: string[];
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const reasons: string[] = [];

  if (HUMAN_ONLY_TOPICS.has(input.topic)) {
    reasons.push('Reclamo o queja formal: siempre lo atiende una persona');
  }

  const sensitive = input.piiFlags.filter((flag) => HUMAN_ONLY_PII.has(flag));
  if (sensitive.length > 0) {
    reasons.push(`Contiene dato sensible o senalamiento (${sensitive.join(', ')})`);
  }

  if (input.urgency === 'CRITICAL') {
    reasons.push('Marcado como critico: posible crisis reputacional');
  }

  if (input.sentiment === 'NEGATIVE' && input.urgency === 'HIGH') {
    reasons.push('Comentario negativo urgente');
  }

  if (STUDENT_RECORD_PATTERNS.some((pattern) => pattern.test(input.text))) {
    reasons.push('Consulta academica que exige revisar el expediente del estudiante');
  }

  const requiresHuman = reasons.length > 0;

  return {
    requiresHuman,
    // Cuando el caso es sensible ni siquiera se genera borrador: evita que
    // alguien lo apruebe por inercia.
    allowAssistedDraft: !requiresHuman,
    reasons,
  };
}

/** Temas que suelen resolverse con un enlace o un dato publico. */
export function isAssistedTopic(topic: Topic): boolean {
  return (['QUESTION', 'PRAISE', 'ENROLLMENT_INTENT'] as Topic[]).includes(topic);
}
