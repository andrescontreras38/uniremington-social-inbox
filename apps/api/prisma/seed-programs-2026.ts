import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';

/**
 * Carga de programas con precio real.
 *
 * Los datos vienen de prisma/data/programs-2026.json, generado a partir del
 * guion de atencion "PQRS REDES SOCIALES.xlsx" que Uniremington entrego el
 * 3 de septiembre de 2026. Se extrajeron con un analizador de texto sobre las
 * frases del guion (no se transcribieron a mano), y se agruparon por
 * (programa, modalidad, precio, descuento): cuando el mismo programa cuesta
 * lo mismo en varias sedes, comparten una fila; cuando el precio o el
 * descuento cambia de una sede a otra -como ocurre de verdad con Derecho o
 * con Medicina Veterinaria en este documento- quedan en filas separadas.
 *
 * Ninguna fecha de vigencia viene en el documento fuente, asi que no se
 * inventa una: las filas quedan sin validFrom/validUntil (vigentes desde
 * ahora, sin fecha de vencimiento) hasta que Admisiones fije una desde la
 * pantalla de Plantillas.
 */

interface SeedRow {
  name: string;
  level: 'PREGRADO' | 'ESPECIALIZACION' | 'MAESTRIA' | 'TECNOLOGIA';
  modality: 'PRESENCIAL' | 'DISTANCIA' | 'VIRTUAL' | 'HIBRIDA' | 'COMBINADA';
  faculty: string;
  campuses: string;
  durationSemesters: number | null;
  semesterValue: number | null;
  enrollmentFee: number | null;
  discountNote: string | null;
  officialUrl: string;
  costIsPublic: boolean;
  notes: string;
}

/** Marca de las 9 plantillas de arranque (sin datos) creadas antes de tener el documento real. */
const PLACEHOLDER_MARK = 'Pendiente: Admisiones debe cargar el valor del semestre y la vigencia.';

async function main(): Promise<void> {
  const dataPath = fileURLToPath(new URL('./data/programs-2026.json', import.meta.url));
  const rows = JSON.parse(readFileSync(dataPath, 'utf8')) as SeedRow[];

  // Las plantillas vacias de la primera carga quedan redundantes en cuanto
  // existe el dato real para ese mismo programa: se retiran para que la
  // busqueda no dude entre una fila sin precio y una con precio real.
  const removedPlaceholders = await prisma.programTemplate.deleteMany({
    where: { notes: PLACEHOLDER_MARK },
  });

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.programTemplate.findFirst({
      where: { name: row.name, modality: row.modality, campuses: row.campuses },
      select: { id: true },
    });

    const data = {
      name: row.name,
      level: row.level,
      modality: row.modality,
      faculty: row.faculty,
      campuses: row.campuses,
      durationSemesters: row.durationSemesters,
      semesterValue: row.semesterValue,
      enrollmentFee: row.enrollmentFee,
      discountNote: row.discountNote,
      officialUrl: row.officialUrl,
      costIsPublic: row.costIsPublic,
      notes: row.notes,
      isActive: true,
    };

    if (existing) {
      await prisma.programTemplate.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.programTemplate.create({ data });
      created += 1;
    }
  }

  const total = await prisma.programTemplate.count();
  const withPrice = await prisma.programTemplate.count({ where: { semesterValue: { not: null } } });

  console.log(`Plantillas eliminadas (marcador vacio): ${removedPlaceholders.count}`);
  console.log(`Plantillas creadas: ${created}. Actualizadas: ${updated}.`);
  console.log(`Total en la base: ${total}. Con precio cargado: ${withPrice}.`);
}

main()
  .catch((error) => {
    console.error('Fallo la carga de programas 2026:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
