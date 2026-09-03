import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { auditContextOf, requireUser } from '../plugins/auth.js';
import { recordAudit } from '../services/audit.js';
import { findTemplatesForText, isValid } from '../services/templates.js';

/**
 * Plantillas de programa.
 *
 * Cada plantilla es el dato oficial de un programa: costos, duracion,
 * requisitos y hasta cuando son validos. Es lo unico que la IA puede citar
 * cuando un aspirante pregunta por precios.
 */

const idParams = z.object({ id: z.string().cuid() });

/** Un valor de matricula en pesos: entero, sin decimales, con techo sensato. */
const cop = z.number().int().min(0).max(500_000_000);

const templateSchema = z.object({
  name: z.string().min(2).max(160),
  faculty: z.string().min(2).max(120),
  level: z.enum(['PREGRADO', 'ESPECIALIZACION', 'MAESTRIA', 'TECNOLOGIA']),
  modality: z.enum(['PRESENCIAL', 'DISTANCIA', 'VIRTUAL', 'HIBRIDA', 'COMBINADA']),
  campuses: z.string().min(2).max(200),
  semesterValue: cop.nullable().optional(),
  enrollmentFee: cop.nullable().optional(),
  otherFeesNote: z.string().max(500).nullable().optional(),
  discountNote: z.string().max(500).nullable().optional(),
  durationSemesters: z.number().int().min(1).max(30).nullable().optional(),
  credits: z.number().int().min(1).max(400).nullable().optional(),
  requirements: z.string().max(1000).nullable().optional(),
  degreeAwarded: z.string().max(200).nullable().optional(),
  sniesCode: z.string().max(40).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  professionalProfile: z.string().max(2000).nullable().optional(),
  curriculum: z.string().max(2000).nullable().optional(),
  scheduleNote: z.string().max(600).nullable().optional(),
  admissionProcess: z.string().max(1500).nullable().optional(),
  homologationNote: z.string().max(1000).nullable().optional(),
  faq: z.string().max(3000).nullable().optional(),
  officialUrl: z.string().url().max(500).nullable().optional().or(z.literal('')),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  costIsPublic: z.boolean().default(true),
  notes: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
});

const listQuerySchema = z.object({
  faculty: z.string().max(120).optional(),
  level: z.string().max(40).optional(),
  modality: z.string().max(40).optional(),
  search: z.string().max(120).optional(),
  /** "vigentes" | "vencidas" | "sin_costo" */
  estado: z.enum(['todas', 'vigentes', 'vencidas', 'sin_costo']).default('todas'),
});

/** Normaliza el enlace vacio a nulo para no guardar cadenas en blanco. */
function cleanUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { onRequest: [app.requirePermission('templates:read')] }, async (request) => {
    const query = listQuerySchema.parse(request.query);

    const where: Prisma.ProgramTemplateWhereInput = {
      ...(query.faculty ? { faculty: query.faculty } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.modality ? { modality: query.modality } : {}),
      ...(query.search ? { name: { contains: query.search } } : {}),
      ...(query.estado === 'sin_costo' ? { semesterValue: null } : {}),
    };

    const templates = await prisma.programTemplate.findMany({
      where,
      orderBy: [{ faculty: 'asc' }, { name: 'asc' }],
    });

    const now = new Date();
    const withState = templates.map((template) => ({
      ...template,
      vigente: isValid(template, now),
      // Lo que de verdad importa al revisar la lista: si esta plantilla puede
      // usarse hoy para responder por costos.
      usable: isValid(template, now) && template.isActive && template.semesterValue !== null,
    }));

    const filtered =
      query.estado === 'vigentes'
        ? withState.filter((template) => template.vigente)
        : query.estado === 'vencidas'
          ? withState.filter((template) => !template.vigente)
          : withState;

    return {
      templates: filtered,
      resumen: {
        total: withState.length,
        usables: withState.filter((template) => template.usable).length,
        sinCosto: withState.filter((template) => template.semesterValue === null).length,
        vencidas: withState.filter((template) => !template.vigente).length,
      },
    };
  });

  app.get('/:id', { onRequest: [app.requirePermission('templates:read')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const template = await prisma.programTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError('Plantilla');
    return { template: { ...template, vigente: isValid(template) } };
  });

  app.post('/', { onRequest: [app.requirePermission('templates:write')] }, async (request) => {
    const body = templateSchema.parse(request.body);
    const actor = requireUser(request);

    const template = await prisma.programTemplate.create({
      data: { ...body, officialUrl: cleanUrl(body.officialUrl), updatedById: actor.id },
    });

    await recordAudit({
      actor: { id: actor.id, email: actor.email },
      action: 'template.created',
      entityType: 'ProgramTemplate',
      entityId: template.id,
      metadata: { name: body.name, modality: body.modality },
      context: auditContextOf(request),
    });

    return { template };
  });

  app.patch('/:id', { onRequest: [app.requirePermission('templates:write')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = templateSchema.partial().parse(request.body);
    const actor = requireUser(request);

    const template = await prisma.programTemplate.update({
      where: { id },
      data: {
        ...body,
        ...(body.officialUrl !== undefined ? { officialUrl: cleanUrl(body.officialUrl) } : {}),
        updatedById: actor.id,
      },
    });

    await recordAudit({
      actor: { id: actor.id, email: actor.email },
      action: 'template.updated',
      entityType: 'ProgramTemplate',
      entityId: id,
      // Queda constancia de quien cambio un valor de matricula y cuando.
      metadata: body,
      context: auditContextOf(request),
    });

    return { template };
  });

  app.delete('/:id', { onRequest: [app.requirePermission('templates:write')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const actor = requireUser(request);

    await prisma.programTemplate.delete({ where: { id } });

    await recordAudit({
      actor: { id: actor.id, email: actor.email },
      action: 'template.deleted',
      entityType: 'ProgramTemplate',
      entityId: id,
      context: auditContextOf(request),
    });

    return { ok: true };
  });

  /**
   * Prueba de coincidencia: muestra que plantilla usaria la IA para un texto.
   * Sirve para que el equipo entienda por que una respuesta cito un valor.
   */
  app.post(
    '/match',
    { onRequest: [app.requirePermission('templates:read')] },
    async (request) => {
      const { text, campus } = z
        .object({ text: z.string().min(1).max(2000), campus: z.string().max(60).optional() })
        .parse(request.body);
      const matches = await findTemplatesForText(text, 3, campus ?? null);
      return { matches };
    },
  );
}
