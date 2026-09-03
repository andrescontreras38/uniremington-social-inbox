import type { InteractionKind, Provider } from '../../domain/enums.js';

/**
 * Contrato con las redes sociales.
 *
 * Toda la aplicacion habla con esta interfaz, nunca con la Graph API
 * directamente. Eso permite tres cosas: desarrollar y probar sin credenciales
 * de Meta (proveedor mock), cambiar de version de la Graph API en un solo
 * archivo, y anadir mas adelante otra red sin tocar la logica de negocio.
 */

export interface NormalizedPost {
  externalId: string;
  permalink?: string;
  caption?: string;
  mediaType?: string;
  thumbnailUrl?: string;
  publishedAt?: Date;
}

export interface NormalizedInteraction {
  provider: Provider;
  /** ID de la pagina de Facebook o cuenta de Instagram que recibio el mensaje. */
  accountExternalId: string;
  kind: InteractionKind;
  externalId: string;
  parentExternalId?: string;
  permalink?: string;
  authorExternalId?: string;
  authorName?: string;
  text: string;
  remoteCreatedAt: Date;
  post?: NormalizedPost;
  /**
   * Verdadero cuando la propia institucion escribio el comentario. Sirve para
   * detectar que el equipo ya respondio desde Meta y dejar de mostrarlo como
   * pendiente.
   */
  fromInstitution?: boolean;
}

/** Credenciales resueltas de una cuenta, con el token ya descifrado. */
export interface AccountCredentials {
  id: string;
  provider: Provider;
  externalId: string;
  accessToken: string;
}

export interface WebhookVerification {
  mode?: string;
  token?: string;
  challenge?: string;
}

export interface SocialProvider {
  readonly name: 'mock' | 'meta';

  /**
   * Verifica la firma HMAC del cuerpo crudo del webhook. Debe usarse el buffer
   * original: reserializar el JSON cambia bytes y rompe la firma.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;

  /** Responde el reto GET de suscripcion. Devuelve null si el token no coincide. */
  verifyWebhookChallenge(query: WebhookVerification): string | null;

  /** Traduce el cuerpo del webhook a interacciones normalizadas. */
  parseWebhook(payload: unknown): NormalizedInteraction[];

  /** Sincroniza el historico reciente de una cuenta. */
  fetchRecentInteractions(
    account: AccountCredentials,
    since: Date,
  ): Promise<NormalizedInteraction[]>;

  /** Publica una respuesta ya aprobada por una persona. */
  publishReply(
    account: AccountCredentials,
    target: { kind: InteractionKind; externalId: string; authorExternalId?: string },
    message: string,
  ): Promise<{ externalId: string }>;

  /** Oculta o vuelve a mostrar un comentario. */
  setCommentHidden(
    account: AccountCredentials,
    commentExternalId: string,
    hidden: boolean,
  ): Promise<void>;
}
