import { createHmac, timingSafeEqual } from 'node:crypto';
import { request } from 'undici';
import { z } from 'zod';
import { getConfig } from '../../config/env.js';
import type { InteractionKind, Provider } from '../../domain/enums.js';
import { ExternalServiceError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type {
  AccountCredentials,
  NormalizedInteraction,
  SocialProvider,
  WebhookVerification,
} from './types.js';

/**
 * Proveedor real: Meta Graph API (Facebook Pages e Instagram profesional).
 *
 * Notas de seguridad:
 *  - La firma del webhook se verifica sobre el cuerpo crudo con HMAC-SHA256 y
 *    comparacion en tiempo constante. Un webhook sin firma valida se descarta
 *    antes de tocar la base de datos.
 *  - El token de pagina viaja como parametro de consulta porque asi lo exige
 *    la Graph API; por eso nunca se registra la URL completa en los logs.
 */

const graphErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

/** Cambio de un comentario de Facebook notificado por webhook. */
const facebookChangeSchema = z.object({
  field: z.string(),
  value: z.object({
    item: z.string().optional(),
    verb: z.string().optional(),
    comment_id: z.string().optional(),
    parent_id: z.string().optional(),
    post_id: z.string().optional(),
    message: z.string().optional(),
    created_time: z.number().optional(),
    permalink_url: z.string().optional(),
    from: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  }),
});

const instagramChangeSchema = z.object({
  field: z.string(),
  value: z.object({
    id: z.string().optional(),
    parent_id: z.string().optional(),
    text: z.string().optional(),
    timestamp: z.string().optional(),
    media: z
      .object({
        id: z.string(),
        media_product_type: z.string().optional(),
      })
      .optional(),
    from: z.object({ id: z.string(), username: z.string().optional() }).optional(),
  }),
});

const webhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number().optional(),
      changes: z.array(z.union([facebookChangeSchema, instagramChangeSchema])).optional(),
      messaging: z
        .array(
          z.object({
            sender: z.object({ id: z.string() }),
            recipient: z.object({ id: z.string() }),
            timestamp: z.number().optional(),
            message: z
              .object({
                mid: z.string(),
                text: z.string().optional(),
                is_echo: z.boolean().optional(),
                // Solo presente en ecos: que app envio el mensaje en nombre
                // de la pagina (la nuestra, Meta Business Suite, un CRM...).
                app_id: z.union([z.string(), z.number()]).optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});

export class MetaProvider implements SocialProvider {
  readonly name = 'meta' as const;

  private get config() {
    return getConfig();
  }

  private get baseUrl(): string {
    return `${this.config.META_GRAPH_BASE_URL}/${this.config.META_GRAPH_VERSION}`;
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = this.config.META_APP_SECRET;
    if (!secret || !signatureHeader) return false;

    const [algorithm, received] = signatureHeader.split('=');
    if (algorithm !== 'sha256' || !received) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(received, 'hex');

    if (expectedBuffer.length !== receivedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  verifyWebhookChallenge(query: WebhookVerification): string | null {
    const expected = this.config.META_WEBHOOK_VERIFY_TOKEN;
    if (!expected) return null;
    if (query.mode !== 'subscribe' || !query.token || !query.challenge) return null;

    const a = Buffer.from(query.token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    return query.challenge;
  }

  parseWebhook(payload: unknown): NormalizedInteraction[] {
    const parsed = webhookSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Webhook de Meta con estructura inesperada');
      return [];
    }

    const provider: Provider =
      parsed.data.object === 'instagram' ? 'META_INSTAGRAM' : 'META_FACEBOOK';
    const results: NormalizedInteraction[] = [];

    for (const entry of parsed.data.entry) {
      for (const change of entry.changes ?? []) {
        const interaction = this.normalizeChange(provider, entry.id, change);
        if (interaction) results.push(interaction);
      }

      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue;

        if (event.message.is_echo) {
          // La pagina (esta herramienta, Meta Business Suite o cualquier
          // otra app conectada, como un CRM) le respondio a alguien. En un
          // eco, sender/recipient se invierten: sender es la pagina,
          // recipient es la persona. Se usa para marcar como respondida
          // toda la conversacion pendiente con esa persona, sin importar
          // quien haya escrito la respuesta.
          results.push({
            provider,
            accountExternalId: event.sender.id,
            kind: 'DIRECT_MESSAGE',
            externalId: event.message.mid,
            authorExternalId: event.recipient.id,
            text: event.message.text,
            remoteCreatedAt: new Date(event.timestamp ?? Date.now()),
            fromInstitution: true,
            answeredByApp: event.message.app_id ? String(event.message.app_id) : undefined,
          });
          continue;
        }

        results.push({
          provider,
          accountExternalId: event.recipient.id,
          kind: 'DIRECT_MESSAGE',
          externalId: event.message.mid,
          authorExternalId: event.sender.id,
          text: event.message.text,
          remoteCreatedAt: new Date(event.timestamp ?? Date.now()),
        });
      }
    }

    return results;
  }

  private normalizeChange(
    provider: Provider,
    entryId: string,
    change: z.infer<typeof facebookChangeSchema> | z.infer<typeof instagramChangeSchema>,
  ): NormalizedInteraction | null {
    if (!change.field.includes('comment') && change.field !== 'feed') return null;

    const value = change.value as Record<string, unknown>;

    // Facebook entrega comment_id / message; Instagram entrega id / text.
    const externalId = (value.comment_id ?? value.id) as string | undefined;
    const text = (value.message ?? value.text) as string | undefined;
    if (!externalId || !text) return null;

    // Solo interesan los comentarios creados; las ediciones y borrados se
    // resuelven en la sincronizacion periodica.
    if (typeof value.verb === 'string' && value.verb !== 'add') return null;

    const createdTime = value.created_time as number | undefined;
    const timestamp = value.timestamp as string | undefined;
    const media = value.media as { id?: string } | undefined;
    const from = value.from as { id?: string; name?: string; username?: string } | undefined;

    return {
      provider,
      accountExternalId: entryId,
      kind: 'COMMENT',
      externalId,
      parentExternalId: (value.parent_id as string | undefined) ?? undefined,
      permalink: (value.permalink_url as string | undefined) ?? undefined,
      authorExternalId: from?.id,
      authorName: from?.name ?? from?.username,
      text,
      remoteCreatedAt: createdTime
        ? new Date(createdTime * 1000)
        : timestamp
          ? new Date(timestamp)
          : new Date(),
      post: (value.post_id as string | undefined)
        ? { externalId: value.post_id as string }
        : media?.id
          ? { externalId: media.id }
          : undefined,
      fromInstitution: from?.id === entryId,
    };
  }

  /** Campos del edge de publicaciones/medios, iguales para cualquier lote. */
  private postsEdge(account: AccountCredentials): { edge: string; fields: string } {
    const isInstagram = account.provider === 'META_INSTAGRAM';
    return {
      edge: isInstagram ? 'media' : 'posts',
      fields: isInstagram
        ? 'id,permalink,caption,media_type,thumbnail_url,timestamp,comments{id,text,timestamp,username,from,parent_id}'
        : 'id,permalink_url,message,created_time,full_picture,comments.filter(stream){id,message,created_time,from,parent,permalink_url}',
    };
  }

  /** Convierte una pagina cruda de publicaciones en interacciones normalizadas. */
  private extractComments(
    account: AccountCredentials,
    posts: unknown[],
  ): NormalizedInteraction[] {
    const results: NormalizedInteraction[] = [];

    for (const rawPost of posts) {
      const post = rawPost as Record<string, any>;
      const postInfo = {
        externalId: String(post.id),
        permalink: post.permalink ?? post.permalink_url,
        caption: post.caption ?? post.message,
        mediaType: post.media_type,
        thumbnailUrl: post.thumbnail_url ?? post.full_picture,
        publishedAt:
          post.timestamp ?? post.created_time ? new Date(post.timestamp ?? post.created_time) : undefined,
      };

      for (const rawComment of post.comments?.data ?? []) {
        const comment = rawComment as Record<string, any>;
        const authorId = comment.from?.id ?? comment.username;

        results.push({
          provider: account.provider,
          accountExternalId: account.externalId,
          kind: 'COMMENT',
          externalId: String(comment.id),
          parentExternalId: comment.parent?.id ?? comment.parent_id,
          permalink: comment.permalink_url,
          authorExternalId: comment.from?.id,
          authorName: comment.from?.name ?? comment.username,
          text: String(comment.message ?? comment.text ?? ''),
          remoteCreatedAt: new Date(comment.created_time ?? comment.timestamp ?? Date.now()),
          post: postInfo,
          fromInstitution: authorId === account.externalId,
        });
      }
    }

    return results.filter((item) => item.text.trim().length > 0);
  }

  async fetchRecentInteractions(
    account: AccountCredentials,
    since: Date,
  ): Promise<NormalizedInteraction[]> {
    const { edge, fields } = this.postsEdge(account);

    // "since" no se manda aqui a proposito: en este edge, la Graph API lo
    // aplica a la fecha de la PUBLICACION, no a la del comentario. Un
    // comentario nuevo en una publicacion vieja nunca se detectaria. En vez
    // de eso se piden las publicaciones mas recientes sin filtro de fecha y
    // se filtra cada comentario por su propia fecha, mas abajo.
    //
    // Se pagina hasta MAX_PAGES: una pagina publicaciones (100, el maximo de
    // este edge) alcanza sobra para una cuenta que casi no publica, pero una
    // universidad activa agota eso en un par de meses, y un comentario nuevo
    // en una publicacion mas vieja que la ventana revisada quedaria invisible
    // para siempre. Para revisar todo el historico sin este limite, ver
    // fetchHistoricalBatch.
    const MAX_PAGES = 3;
    type PostsPage = { data?: unknown[]; paging?: { next?: string } };

    let page = await this.graphGet<PostsPage>(`/${account.externalId}/${edge}`, account.accessToken, {
      fields,
      limit: '100',
    });

    const results: NormalizedInteraction[] = [];
    let pagesFetched = 0;

    while (true) {
      results.push(...this.extractComments(account, page.data ?? []));

      pagesFetched += 1;
      if (!page.paging?.next || pagesFetched >= MAX_PAGES) break;
      page = await this.graphGetPage<PostsPage>(page.paging.next);
    }

    return results.filter((item) => item.remoteCreatedAt >= since);
  }

  async fetchHistoricalBatch(
    account: AccountCredentials,
    cursor: string | null,
  ): Promise<{ interactions: NormalizedInteraction[]; nextCursor: string | null }> {
    const { edge, fields } = this.postsEdge(account);
    type PostsPage = { data?: unknown[]; paging?: { next?: string } };

    // Un solo lote (una pagina de publicaciones): quien llama decide cuantos
    // lotes encadenar. Sin filtro de fecha -a diferencia de
    // fetchRecentInteractions, aqui el objetivo es traer TODO, sin importar
    // que tan viejo sea el comentario.
    const page = cursor
      ? await this.graphGetPage<PostsPage>(cursor)
      : await this.graphGet<PostsPage>(`/${account.externalId}/${edge}`, account.accessToken, {
          fields,
          limit: '25',
        });

    return {
      interactions: this.extractComments(account, page.data ?? []),
      nextCursor: page.paging?.next ?? null,
    };
  }

  async publishReply(
    account: AccountCredentials,
    target: { kind: InteractionKind; externalId: string; authorExternalId?: string },
    message: string,
  ): Promise<{ externalId: string }> {
    if (target.kind === 'DIRECT_MESSAGE') {
      if (!target.authorExternalId) {
        throw new ExternalServiceError('Meta', 'Falta el destinatario del mensaje directo');
      }

      const response = await this.graphPost<{ message_id?: string }>(
        `/${account.externalId}/messages`,
        account.accessToken,
        {
          recipient: { id: target.authorExternalId },
          message: { text: message },
          messaging_type: 'RESPONSE',
        },
      );

      return { externalId: response.message_id ?? '' };
    }

    const response = await this.graphPost<{ id?: string }>(
      `/${target.externalId}/comments`,
      account.accessToken,
      { message },
    );

    return { externalId: response.id ?? '' };
  }

  async setCommentHidden(
    account: AccountCredentials,
    commentExternalId: string,
    hidden: boolean,
  ): Promise<void> {
    await this.graphPost(`/${commentExternalId}`, account.accessToken, { is_hidden: hidden });
  }

  // -------------------------------------------------------------------------
  // Transporte
  // -------------------------------------------------------------------------

  private async graphGet<T>(
    path: string,
    accessToken: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('access_token', accessToken);

    const response = await request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });

    return this.handleResponse<T>(response.statusCode, await response.body.json(), path);
  }

  /**
   * Sigue el cursor de paginacion que la Graph API devuelve en paging.next:
   * ya es una URL absoluta con el token incluido, asi que nunca se registra
   * completa (solo un marcador fijo, igual que el resto de las llamadas).
   */
  private async graphGetPage<T>(nextUrl: string): Promise<T> {
    const response = await request(nextUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });

    return this.handleResponse<T>(response.statusCode, await response.body.json(), '(paginacion)');
  }

  private async graphPost<T>(
    path: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('access_token', accessToken);

    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });

    return this.handleResponse<T>(response.statusCode, await response.body.json(), path);
  }

  private handleResponse<T>(statusCode: number, payload: unknown, path: string): T {
    if (statusCode >= 400) {
      const parsed = graphErrorSchema.safeParse(payload);
      const message = parsed.success ? parsed.data.error.message : `HTTP ${statusCode}`;
      // Se registra la ruta, nunca la URL completa: lleva el token.
      logger.error({ path, statusCode }, 'Error de la Graph API de Meta');
      throw new ExternalServiceError('Meta', message, { statusCode });
    }

    return payload as T;
  }
}
