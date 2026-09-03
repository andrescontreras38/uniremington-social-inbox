import { prisma } from '../lib/prisma.js';

/**
 * Contacto de admisiones por sede.
 *
 * Es el respaldo cuando la IA no tiene un dato exacto que citar, o cuando el
 * costo de un programa no puede darse en un comentario publico: en vez de un
 * generico "escriba por mensaje directo", se ofrece el asesor real de la
 * sede que recibio el comentario, igual que ya lo hace el guion de atencion
 * actual del equipo.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CampusContactMatch {
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
}

/**
 * Busca el contacto de una sede.
 *
 * `campus` normalmente es SocialAccount.campus ("MEDELLIN", "NACIONAL"...).
 * La comparacion ignora tildes y mayusculas para no depender de que ambos
 * lados usen exactamente el mismo formato.
 */
export async function findCampusContact(
  campus: string | null | undefined,
): Promise<CampusContactMatch | null> {
  if (!campus) return null;

  const target = normalize(campus);
  if (target === 'nacional' || target === '') return null;

  const contacts = await prisma.campusContact.findMany({
    where: { isActive: true },
    select: {
      campus: true,
      director: true,
      address: true,
      phone: true,
      advisor1Name: true,
      advisor1Email: true,
      advisor2Name: true,
      advisor2Email: true,
      whatsapp: true,
      isAlly: true,
    },
  });

  return contacts.find((contact) => normalize(contact.campus) === target) ?? null;
}

/** Convierte el contacto en el bloque de texto que recibe el redactor. */
export function buildContactContext(contact: CampusContactMatch | null): string | null {
  if (!contact) return null;

  const lines: string[] = [`CONTACTO DE LA SEDE (${contact.campus}).`];

  if (contact.director) lines.push(`Responsable: ${contact.director}`);
  if (contact.advisor1Name || contact.advisor1Email) {
    lines.push(`Asesor: ${[contact.advisor1Name, contact.advisor1Email].filter(Boolean).join(' - ')}`);
  }
  if (contact.advisor2Name || contact.advisor2Email) {
    lines.push(`Asesor: ${[contact.advisor2Name, contact.advisor2Email].filter(Boolean).join(' - ')}`);
  }
  if (contact.phone) lines.push(`Telefono: ${contact.phone}`);
  if (contact.whatsapp) lines.push(`WhatsApp: ${contact.whatsapp}`);
  if (contact.address) lines.push(`Direccion: ${contact.address}`);

  return lines.join('\n');
}
