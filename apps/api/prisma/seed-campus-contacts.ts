import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';

/**
 * Carga de contactos de sede.
 *
 * Datos transcritos de la hoja "Contactos" de PQRS REDES SOCIALES.xlsx
 * (documento entregado el 3 de septiembre de 2026). Es lo que la IA ofrece
 * cuando no tiene un dato exacto que citar: en vez de un generico "escriba
 * por mensaje directo", el asesor real de la sede que recibio el comentario.
 */

interface SeedContact {
  campus: string;
  director: string | null;
  address: string | null;
  phone: string | null;
  advisor1Name: string | null;
  advisor1Email: string | null;
  advisor2Name: string | null;
  advisor2Email: string | null;
  whatsapp: string | null;
  isAlly: boolean;
  notes: string | null;
}

async function main(): Promise<void> {
  const dataPath = fileURLToPath(new URL('./data/campus-contacts.json', import.meta.url));
  const rows = JSON.parse(readFileSync(dataPath, 'utf8')) as SeedContact[];

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.campusContact.findUnique({
      where: { campus: row.campus },
      select: { id: true },
    });

    const data = {
      director: row.director,
      address: row.address,
      phone: row.phone,
      advisor1Name: row.advisor1Name,
      advisor1Email: row.advisor1Email,
      advisor2Name: row.advisor2Name,
      advisor2Email: row.advisor2Email,
      whatsapp: row.whatsapp,
      isAlly: row.isAlly,
      notes: row.notes,
      isActive: true,
    };

    if (existing) {
      await prisma.campusContact.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.campusContact.create({ data: { campus: row.campus, ...data } });
      created += 1;
    }
  }

  console.log(`Contactos de sede creados: ${created}. Actualizados: ${updated}.`);
}

main()
  .catch((error) => {
    console.error('Fallo la carga de contactos de sede:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
