import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config/env.js';
import { safeCompare } from '../lib/crypto.js';
import { purgeExpiredData, runExclusive } from '../jobs/scheduler.js';
import { syncAllAccounts } from '../services/sync.js';
import { prisma } from '../lib/prisma.js';
import programsData from '../../prisma/data/programs-2026.json' with { type: 'json' };
import campusContactsData from '../../prisma/data/campus-contacts.json' with { type: 'json' };

/**
 * Disparadores para un programador externo (Vercel Cron u otro).
 *
 * Existen porque en un despliegue serverless no hay proceso que se quede
 * vivo entre peticiones: el setInterval de jobs/scheduler.ts (ENABLE_JOBS=true,
 * pensado para un servidor persistente como un VPS) no tiene donde correr.
 * Aqui la misma logica se dispara por HTTP en su lugar.
 *
 * Quien llama no es una persona con sesion, asi que no hay cookie ni CSRF que
 * verificar: la autorizacion es un secreto compartido en el encabezado
 * Authorization, comparado en tiempo constante.
 */

function requireCronSecret(request: FastifyRequest, reply: FastifyReply): boolean {
  const config = getConfig();

  if (!config.CRON_SECRET) {
    reply.status(503).send({
      error: { code: 'CRON_NOT_CONFIGURED', message: 'CRON_SECRET no esta configurado' },
    });
    return false;
  }

  const header = request.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !safeCompare(provided, config.CRON_SECRET)) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Secreto invalido' } });
    return false;
  }

  return true;
}

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // GET, no POST: asi es como Vercel Cron invoca la ruta. Cuando el proyecto
  // tiene definida la variable CRON_SECRET, Vercel agrega automaticamente el
  // encabezado Authorization: Bearer <CRON_SECRET> a esa peticion, que es
  // exactamente lo que requireCronSecret verifica.
  app.get('/sync', async (request, reply) => {
    if (!requireCronSecret(request, reply)) return;

    let summary: Awaited<ReturnType<typeof syncAllAccounts>> | null = null;
    await runExclusive('sync', async () => {
      summary = await syncAllAccounts();
    });

    return reply.send({ ok: true, summary });
  });

  app.get('/retention', async (request, reply) => {
    if (!requireCronSecret(request, reply)) return;

    await runExclusive('retention', purgeExpiredData);

    return reply.send({ ok: true });
  });

  // Bootstrap de un solo uso: carga plantillas de programa y contactos de
  // sede en un entorno donde nunca corrieron los scripts db:seed:*. Vercel
  // solo migra el esquema en el build, no siembra datos. Protegida con el
  // mismo CRON_SECRET. Se retira del codigo despues del primer uso.
  app.post('/seed-templates', async (request, reply) => {
    if (!requireCronSecret(request, reply)) return;

    const PLACEHOLDER_MARK = 'Pendiente: Admisiones debe cargar el valor del semestre y la vigencia.';
    const removedPlaceholders = await prisma.programTemplate.deleteMany({
      where: { notes: PLACEHOLDER_MARK },
    });

    let programsCreated = 0;
    let programsUpdated = 0;
    for (const row of programsData as Array<Record<string, unknown>>) {
      const existing = await prisma.programTemplate.findFirst({
        where: { name: row.name as string, modality: row.modality as string, campuses: row.campuses as string },
        select: { id: true },
      });

      const data = {
        name: row.name as string,
        level: row.level as string,
        modality: row.modality as string,
        faculty: row.faculty as string,
        campuses: row.campuses as string,
        durationSemesters: row.durationSemesters as number | null,
        semesterValue: row.semesterValue as number | null,
        enrollmentFee: row.enrollmentFee as number | null,
        discountNote: row.discountNote as string | null,
        officialUrl: row.officialUrl as string,
        costIsPublic: row.costIsPublic as boolean,
        notes: row.notes as string,
        isActive: true,
      };

      if (existing) {
        await prisma.programTemplate.update({ where: { id: existing.id }, data });
        programsUpdated += 1;
      } else {
        await prisma.programTemplate.create({ data });
        programsCreated += 1;
      }
    }

    let contactsCreated = 0;
    let contactsUpdated = 0;
    for (const row of campusContactsData as Array<Record<string, unknown>>) {
      const existing = await prisma.campusContact.findUnique({
        where: { campus: row.campus as string },
        select: { id: true },
      });

      const data = {
        director: row.director as string | null,
        address: row.address as string | null,
        phone: row.phone as string | null,
        advisor1Name: row.advisor1Name as string | null,
        advisor1Email: row.advisor1Email as string | null,
        advisor2Name: row.advisor2Name as string | null,
        advisor2Email: row.advisor2Email as string | null,
        whatsapp: row.whatsapp as string | null,
        isAlly: row.isAlly as boolean,
        notes: row.notes as string | null,
        isActive: true,
      };

      if (existing) {
        await prisma.campusContact.update({ where: { id: existing.id }, data });
        contactsUpdated += 1;
      } else {
        await prisma.campusContact.create({ data: { campus: row.campus as string, ...data } });
        contactsCreated += 1;
      }
    }

    return reply.send({
      ok: true,
      removedPlaceholders: removedPlaceholders.count,
      programsCreated,
      programsUpdated,
      contactsCreated,
      contactsUpdated,
    });
  });
}
