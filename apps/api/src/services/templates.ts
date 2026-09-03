import { prisma } from '../lib/prisma.js';

/**
 * Plantillas de programa.
 *
 * Son la unica fuente que el redactor puede citar para hablar de costos,
 * duracion o requisitos. La regla que gobierna este modulo:
 *
 *   sin plantilla vigente que aplique, no hay cifra.
 *
 * Una plantilla vencida no se degrada a "aproximada": simplemente no se usa.
 * Un valor de matricula del ano pasado publicado en un comentario abierto le
 * cuesta mas a la institucion que no haber respondido.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Palabras que no distinguen un programa de otro. */
const STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'en',
  'a',
  'para',
  'con',
  'por',
  'un',
  'una',
  'programa',
  'carrera',
  'estudiar',
  'virtual',
  'presencial',
  'distancia',
]);

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Modalidad que el texto menciona explicitamente, si alguna. */
function detectModality(text: string): string | null {
  const plain = normalize(text);
  if (/\bvirtual(es)?\b/.test(plain)) return 'VIRTUAL';
  if (/\ba distancia\b|\bdistancia\b/.test(plain)) return 'DISTANCIA';
  if (/\bpresencial(es)?\b/.test(plain)) return 'PRESENCIAL';
  if (/\bhibrid/.test(plain)) return 'HIBRIDA';
  return null;
}

function significantWords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

export interface TemplateMatch {
  id: string;
  name: string;
  faculty: string;
  level: string;
  modality: string;
  campuses: string;
  semesterValue: number | null;
  enrollmentFee: number | null;
  otherFeesNote: string | null;
  discountNote: string | null;
  durationSemesters: number | null;
  credits: number | null;
  requirements: string | null;
  degreeAwarded: string | null;
  sniesCode: string | null;
  description: string | null;
  professionalProfile: string | null;
  curriculum: string | null;
  scheduleNote: string | null;
  admissionProcess: string | null;
  homologationNote: string | null;
  faq: string | null;
  officialUrl: string | null;
  costIsPublic: boolean;
  notes: string | null;
  validUntil: Date | null;
}

/** Verdadero si la plantilla esta vigente en la fecha dada. */
export function isValid(
  template: { validFrom: Date | null; validUntil: Date | null },
  at: Date = new Date(),
): boolean {
  if (template.validFrom && template.validFrom > at) return false;
  if (template.validUntil && template.validUntil < at) return false;
  return true;
}

/** Verdadero si `campus` aparece en la lista de sedes de la plantilla (o si la plantilla es NACIONAL). */
function coversCampus(templateCampuses: string, campus: string | null): boolean {
  const list = templateCampuses.split(',').map((item) => normalize(item));
  if (list.includes('nacional')) return true;
  if (!campus) return false;
  return list.includes(normalize(campus));
}

/**
 * Busca las plantillas que el comentario menciona.
 *
 * La coincidencia por nombre es por palabras significativas, no por
 * semantica: es deterministica, se puede explicar a quien revisa la
 * respuesta y no cuesta una llamada al modelo. Si el aspirante escribe
 * "psicologia", encuentra Psicologia; si escribe algo vago, no encuentra nada
 * y el redactor remite a admisiones, que es la conducta correcta.
 *
 * `campus` es la sede de la cuenta que recibio el comentario
 * (SocialAccount.campus). El mismo programa puede costar distinto en
 * distintas sedes -confirmado con datos reales: Derecho no vale lo mismo en
 * Bucaramanga que en el resto del pais-, asi que una plantilla que sea
 * especifica de OTRA sede se descarta por completo en vez de arriesgarse a
 * citar el precio equivocado. Una plantilla marcada NACIONAL (o sin `campus`
 * conocido) siempre participa.
 */
export async function findTemplatesForText(
  text: string,
  limit = 2,
  campus?: string | null,
): Promise<TemplateMatch[]> {
  const words = significantWords(text);
  if (words.length === 0) return [];

  const mentionedModality = detectModality(text);

  const candidates = await prisma.programTemplate.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      faculty: true,
      level: true,
      modality: true,
      campuses: true,
      semesterValue: true,
      enrollmentFee: true,
      otherFeesNote: true,
      discountNote: true,
      durationSemesters: true,
      credits: true,
      requirements: true,
      degreeAwarded: true,
      sniesCode: true,
      description: true,
      professionalProfile: true,
      curriculum: true,
      scheduleNote: true,
      admissionProcess: true,
      homologationNote: true,
      faq: true,
      officialUrl: true,
      costIsPublic: true,
      notes: true,
      validFrom: true,
      validUntil: true,
    },
  });

  const now = new Date();

  const scored = candidates
    // Una plantilla vencida no participa: no hay dato a medias.
    .filter((template) => isValid(template, now))
    // Una plantilla propia de otra sede no participa: el precio no aplica.
    .filter((template) => coversCampus(template.campuses, campus ?? null))
    .map((template) => {
      const nameWords = significantWords(template.name);
      if (nameWords.length === 0) return { template, score: 0 };

      const hits = nameWords.filter((word) => words.includes(word)).length;
      const nameScore = hits / nameWords.length;

      // Si el aspirante dijo la modalidad ("virtual", "a distancia"), esa
      // version del programa va primero: el valor cambia entre modalidades y
      // responder con la que no era es responder mal.
      const modalityBonus =
        mentionedModality && mentionedModality === template.modality ? 0.5 : 0;

      return { template, score: nameScore + modalityBonus };
    })
    // Se exige que coincida al menos la mitad del nombre del programa, para no
    // colar "Administracion de Empresas" cuando solo dijeron "empresas".
    .filter((entry) => entry.score >= 0.5)
    // El bono de modalidad ordena, pero no rescata un nombre que no coincide.
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ template }) => {
    const { validFrom: _validFrom, ...rest } = template;
    return rest;
  });
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/**
 * Convierte las plantillas en el bloque de datos verificados que se entrega al
 * redactor. Devuelve null cuando no hay nada citable.
 */
export function buildTemplateContext(
  templates: TemplateMatch[],
  channel: 'COMMENT' | 'DIRECT_MESSAGE',
): string | null {
  if (templates.length === 0) return null;

  const blocks = templates.map((template) => {
    const lines: string[] = [
      `Programa: ${template.name}`,
      `Facultad: ${template.faculty}`,
      `Nivel: ${template.level} | Modalidad: ${template.modality}`,
      `Sedes: ${template.campuses}`,
    ];

    // Un valor marcado como no publico solo se da por mensaje directo.
    const puedeDarValor = template.costIsPublic || channel === 'DIRECT_MESSAGE';

    if (template.semesterValue !== null && puedeDarValor) {
      lines.push(`Valor del semestre: ${COP.format(template.semesterValue)}`);
    } else if (template.semesterValue !== null) {
      lines.push(
        'Valor del semestre: NO puede darse en un comentario publico. Invite a la persona a escribir por mensaje directo.',
      );
    } else {
      lines.push(
        'Valor del semestre: no registrado. NO lo mencione; remita a admisiones.',
      );
    }

    if (template.enrollmentFee !== null && puedeDarValor) {
      lines.push(`Derechos de matricula: ${COP.format(template.enrollmentFee)}`);
    }
    if (template.otherFeesNote) lines.push(`Otros conceptos: ${template.otherFeesNote}`);
    if (template.discountNote) lines.push(`Descuentos: ${template.discountNote}`);
    if (template.durationSemesters) lines.push(`Duracion: ${template.durationSemesters} semestres`);
    if (template.credits) lines.push(`Creditos: ${template.credits}`);
    if (template.requirements) lines.push(`Requisitos: ${template.requirements}`);
    if (template.degreeAwarded) lines.push(`Titulo que otorga: ${template.degreeAwarded}`);
    if (template.sniesCode) lines.push(`Codigo SNIES: ${template.sniesCode}`);
    if (template.description) lines.push(`Sobre el programa: ${template.description}`);
    if (template.professionalProfile) lines.push(`Perfil profesional: ${template.professionalProfile}`);
    if (template.curriculum) lines.push(`Plan de estudios: ${template.curriculum}`);
    if (template.scheduleNote) lines.push(`Horarios: ${template.scheduleNote}`);
    if (template.admissionProcess) lines.push(`Proceso de inscripcion: ${template.admissionProcess}`);
    if (template.homologationNote) lines.push(`Homologaciones: ${template.homologationNote}`);
    if (template.faq) lines.push(`Preguntas frecuentes: ${template.faq}`);
    if (template.officialUrl) lines.push(`Enlace oficial: ${template.officialUrl}`);
    if (template.notes) lines.push(`Notas: ${template.notes}`);

    return lines.join('\n');
  });

  return [
    'DATOS VERIFICADOS DE LA INSTITUCION.',
    'Son los unicos valores que puede citar. Copielos tal cual; no los redondee, no los ajuste y no agregue cifras que no aparezcan aqui.',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}
