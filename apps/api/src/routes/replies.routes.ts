import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditContextOf, requireUser } from '../plugins/auth.js';
import {
  approveReply,
  createAiDraft,
  createManualDraft,
  editReply,
  publishReply,
  rejectReply,
} from '../services/replies.js';

/**
 * Rutas de respuesta.
 *
 * El permiso esta separado a proposito: quien redacta (reply:draft) no
 * necesariamente aprueba (reply:approve) ni publica (reply:publish). Un agente
 * prepara, un supervisor aprueba y publica.
 */

const idParams = z.object({ id: z.string().cuid() });

const aiDraftSchema = z.object({
  style: z.enum(['shorter', 'more_formal', 'warmer', 'default']).optional(),
  instructions: z.string().max(500).optional(),
});

const manualDraftSchema = z.object({ text: z.string().min(1).max(2000) });
const editSchema = z.object({ text: z.string().min(1).max(2000) });
const approveSchema = z.object({ text: z.string().min(1).max(2000).optional() });
const rejectSchema = z.object({ reason: z.string().min(1).max(500) });

export async function replyRoutes(app: FastifyInstance): Promise<void> {
  /** Pide un borrador a la IA para una interaccion. */
  app.post(
    '/interactions/:id/draft',
    {
      onRequest: [app.requirePermission('reply:draft')],
      // La generacion tiene costo por llamada: se limita por usuario.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = aiDraftSchema.parse(request.body ?? {});
      const user = requireUser(request);

      const draft = await createAiDraft({
        interactionId: id,
        actor: user,
        adjustment: { style: body.style, instructions: body.instructions },
        context: auditContextOf(request),
      });

      return { reply: draft };
    },
  );

  /** Escribe un borrador a mano. Admitido incluso en casos sensibles. */
  app.post(
    '/interactions/:id/manual-draft',
    { onRequest: [app.requirePermission('reply:draft')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = manualDraftSchema.parse(request.body);
      const user = requireUser(request);

      const draft = await createManualDraft({
        interactionId: id,
        actor: user,
        text: body.text,
        context: auditContextOf(request),
      });

      return { reply: draft };
    },
  );

  app.patch('/:id', { onRequest: [app.requirePermission('reply:draft')] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = editSchema.parse(request.body);
    const user = requireUser(request);

    await editReply({
      replyId: id,
      actor: user,
      text: body.text,
      context: auditContextOf(request),
    });

    return { ok: true };
  });

  app.post(
    '/:id/approve',
    { onRequest: [app.requirePermission('reply:approve')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = approveSchema.parse(request.body ?? {});
      const user = requireUser(request);

      await approveReply({
        replyId: id,
        actor: user,
        text: body.text,
        context: auditContextOf(request),
      });

      return { ok: true };
    },
  );

  app.post(
    '/:id/reject',
    { onRequest: [app.requirePermission('reply:approve')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = rejectSchema.parse(request.body);
      const user = requireUser(request);

      await rejectReply({
        replyId: id,
        actor: user,
        reason: body.reason,
        context: auditContextOf(request),
      });

      return { ok: true };
    },
  );

  /**
   * Publicacion. El servicio vuelve a comprobar contra la base que exista una
   * aprobacion humana; el permiso de la ruta no basta como garantia.
   */
  app.post(
    '/:id/publish',
    { onRequest: [app.requirePermission('reply:publish')] },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const user = requireUser(request);

      const result = await publishReply({
        replyId: id,
        actor: user,
        context: auditContextOf(request),
      });

      return { published: result };
    },
  );
}
