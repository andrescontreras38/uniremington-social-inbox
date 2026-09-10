import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../../config/env.js';
import type { InteractionKind } from '../../domain/enums.js';
import { logger } from '../../lib/logger.js';
import { FIXTURE_COMMENTS, FIXTURE_POSTS } from './fixtures.js';
import type {
  AccountCredentials,
  NormalizedInteraction,
  SocialProvider,
  WebhookVerification,
} from './types.js';

/**
 * Proveedor simulado.
 *
 * Permite desarrollar, demostrar y probar el sistema completo antes de que
 * Uniremington conceda accesos en su Business Manager. Genera comentarios
 * realistas, acepta publicaciones y recuerda que oculto.
 *
 * La configuracion impide usarlo en produccion (ver config/env.ts).
 */
export class MockProvider implements SocialProvider {
  readonly name = 'mock' as const;

  /** Comentarios ya entregados, para no repetirlos en cada sincronizacion. */
  private readonly delivered = new Set<string>();
  private readonly hidden = new Set<string>();
  private readonly published: Array<{ target: string; message: string; at: Date }> = [];

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = getConfig().META_APP_SECRET;

    // Sin secreto configurado el mock acepta el webhook: es un entorno de
    // desarrollo aislado. Con secreto, se comporta igual que Meta para poder
    // probar la verificacion de firma de extremo a extremo.
    if (!secret) return true;
    if (!signatureHeader) return false;

    const [algorithm, received] = signatureHeader.split('=');
    if (algorithm !== 'sha256' || !received) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  verifyWebhookChallenge(query: WebhookVerification): string | null {
    const expected = getConfig().META_WEBHOOK_VERIFY_TOKEN;
    if (!expected) return query.challenge ?? null;
    return query.token === expected ? (query.challenge ?? null) : null;
  }

  parseWebhook(payload: unknown): NormalizedInteraction[] {
    // El mock acepta el mismo formato normalizado que produce, para poder
    // inyectar casos concretos durante una demostracion.
    if (!payload || typeof payload !== 'object') return [];
    const candidate = payload as { interactions?: unknown };
    if (!Array.isArray(candidate.interactions)) return [];

    return candidate.interactions
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        provider: (item.provider as NormalizedInteraction['provider']) ?? 'META_INSTAGRAM',
        accountExternalId: String(item.accountExternalId ?? ''),
        kind: (item.kind as InteractionKind) ?? 'COMMENT',
        externalId: String(item.externalId ?? randomUUID()),
        authorName: item.authorName ? String(item.authorName) : undefined,
        authorExternalId: item.authorExternalId ? String(item.authorExternalId) : undefined,
        text: String(item.text ?? ''),
        remoteCreatedAt: item.remoteCreatedAt ? new Date(String(item.remoteCreatedAt)) : new Date(),
      }))
      .filter((item) => item.accountExternalId && item.text);
  }

  async fetchRecentInteractions(account: AccountCredentials): Promise<NormalizedInteraction[]> {
    const pending = FIXTURE_COMMENTS.map((comment, index) => ({ comment, index })).filter(
      ({ index }) => !this.delivered.has(`${account.id}:${index}`),
    );

    // Se entregan de a pocos para simular el goteo real de la bandeja.
    const batch = pending.slice(0, 5);
    const now = Date.now();

    return batch.map(({ comment, index }, position) => {
      this.delivered.add(`${account.id}:${index}`);
      const post = FIXTURE_POSTS[comment.postIndex % FIXTURE_POSTS.length]!;

      return {
        provider: account.provider,
        accountExternalId: account.externalId,
        kind: 'COMMENT' as const,
        externalId: `mock_${account.id}_${index}`,
        permalink: `${post.permalink}?comment=${index}`,
        authorExternalId: `mock_user_${comment.author}`,
        authorName: comment.author,
        text: comment.text,
        // Escalonados hacia atras para que el tablero muestre dispersion.
        remoteCreatedAt: new Date(now - (batch.length - position) * 7 * 60 * 1000),
        post: {
          externalId: post.externalId,
          permalink: post.permalink,
          caption: post.caption,
          mediaType: post.mediaType,
          publishedAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
        },
      };
    });
  }

  /** El simulado no tiene historico que rastrear: un lote vacio, ya completo. */
  async fetchHistoricalBatch(): Promise<{
    interactions: NormalizedInteraction[];
    nextCursor: string | null;
  }> {
    return { interactions: [], nextCursor: null };
  }

  async publishReply(
    _account: AccountCredentials,
    target: { kind: InteractionKind; externalId: string },
    message: string,
  ): Promise<{ externalId: string }> {
    this.published.push({ target: target.externalId, message, at: new Date() });
    logger.info(
      { target: target.externalId, length: message.length },
      'Respuesta publicada (proveedor simulado)',
    );
    return { externalId: `mock_reply_${randomUUID()}` };
  }

  async sendPrivateReply(
    _account: AccountCredentials,
    commentExternalId: string,
    message: string,
  ): Promise<{ externalId: string }> {
    this.published.push({ target: `private:${commentExternalId}`, message, at: new Date() });
    logger.info(
      { target: commentExternalId, length: message.length },
      'Respuesta privada enviada (proveedor simulado)',
    );
    return { externalId: `mock_private_${randomUUID()}` };
  }

  async setCommentHidden(
    _account: AccountCredentials,
    commentExternalId: string,
    hidden: boolean,
  ): Promise<void> {
    if (hidden) this.hidden.add(commentExternalId);
    else this.hidden.delete(commentExternalId);
  }

  /** Solo para pruebas y demostraciones. */
  getPublished(): ReadonlyArray<{ target: string; message: string; at: Date }> {
    return this.published;
  }

  reset(): void {
    this.delivered.clear();
    this.hidden.clear();
    this.published.length = 0;
  }
}
