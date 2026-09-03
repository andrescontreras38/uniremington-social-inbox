import { prisma } from '../src/lib/prisma.js';

/**
 * Carga inicial de plantillas de programa.
 *
 * Importante: los valores de matricula quedan VACIOS a proposito.
 *
 * El sitio de Uniremington no publica las cifras y el documento de derechos
 * pecuniarios esta escaneado, sin capa de texto. Sembrar un valor aproximado
 * seria justo el riesgo que estas plantillas existen para evitar: mientras
 * semesterValue sea nulo, la IA no cita precio y remite a admisiones.
 *
 * Admisiones completa los valores desde la pantalla de Plantillas y define la
 * vigencia. A partir de ese momento las respuestas empiezan a citar cifras.
 */

interface SeedTemplate {
  name: string;
  faculty: string;
  level: 'PREGRADO' | 'ESPECIALIZACION' | 'MAESTRIA' | 'TECNOLOGIA';
  modality: 'PRESENCIAL' | 'DISTANCIA' | 'VIRTUAL' | 'HIBRIDA' | 'COMBINADA';
  campuses?: string;
  durationSemesters?: number;
}

/**
 * Programas confirmados en el sitio oficial (uniremington.edu.co/programas).
 * Es un punto de partida, no la oferta completa: son 29 carreras y varias
 * especializaciones y maestrias. El equipo agrega el resto desde la pantalla.
 */
const TEMPLATES: SeedTemplate[] = [
  {
    name: 'Administracion de Empresas',
    faculty: 'Ciencias Empresariales',
    level: 'PREGRADO',
    modality: 'VIRTUAL',
  },
  {
    name: 'Administracion de Empresas Agropecuarias',
    faculty: 'Ciencias Empresariales',
    level: 'PREGRADO',
    modality: 'VIRTUAL',
  },
  {
    name: 'Administracion de Empresas y Finanzas',
    faculty: 'Ciencias Empresariales',
    level: 'PREGRADO',
    modality: 'PRESENCIAL',
  },
  {
    name: 'Administracion de Negocios',
    faculty: 'Ciencias Empresariales',
    level: 'PREGRADO',
    modality: 'PRESENCIAL',
  },
  {
    name: 'Administracion de Negocios',
    faculty: 'Ciencias Empresariales',
    level: 'PREGRADO',
    modality: 'DISTANCIA',
  },
  {
    name: 'Administracion de Negocios',
    faculty: 'Ciencias Empresariales',
    level: 'PREGRADO',
    modality: 'VIRTUAL',
  },
  {
    name: 'Contaduria Publica',
    faculty: 'Ciencias Contables',
    level: 'PREGRADO',
    modality: 'PRESENCIAL',
  },
  {
    name: 'Contaduria Publica',
    faculty: 'Ciencias Contables',
    level: 'PREGRADO',
    modality: 'DISTANCIA',
  },
  {
    name: 'Contaduria Publica',
    faculty: 'Ciencias Contables',
    level: 'PREGRADO',
    modality: 'VIRTUAL',
  },
];

/** Descuento confirmado en la comunicacion institucional de admisiones. */
const DESCUENTO = '7 % por pronto pago, aplicable a todos los programas.';

async function main(): Promise<void> {
  let creadas = 0;

  for (const template of TEMPLATES) {
    const existing = await prisma.programTemplate.findUnique({
      where: { name_modality: { name: template.name, modality: template.modality } },
      select: { id: true },
    });

    if (existing) continue;

    await prisma.programTemplate.create({
      data: {
        name: template.name,
        faculty: template.faculty,
        level: template.level,
        modality: template.modality,
        campuses: template.campuses ?? 'NACIONAL',
        durationSemesters: template.durationSemesters ?? null,
        discountNote: DESCUENTO,
        officialUrl: 'https://www.uniremington.edu.co/programas/',
        // Sin valor y sin vigencia: la plantilla existe pero aun no se puede
        // usar para responder por costos. La pantalla lo muestra en rojo.
        semesterValue: null,
        validFrom: null,
        validUntil: null,
        notes: 'Pendiente: Admisiones debe cargar el valor del semestre y la vigencia.',
      },
    });

    creadas += 1;
  }

  const total = await prisma.programTemplate.count();
  const sinCosto = await prisma.programTemplate.count({ where: { semesterValue: null } });

  console.log(`Plantillas creadas: ${creadas}. Total: ${total}.`);
  console.log(`Pendientes de valor: ${sinCosto}. Hasta cargarlas, la IA no cita precios.`);
}

main()
  .catch((error) => {
    console.error('Fallo la carga de plantillas:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
