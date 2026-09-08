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
   * Verdadero cuando la propia institucion escribio el comentario o el
   * mensaje. Sirve para detectar que el caso ya se respondio desde Meta -por
   * esta herramienta, por Meta Business Suite o por otra app conectada a la
   * misma pagina, como un CRM- y dejar de mostrarlo como pendiente.
   *
   * En un comentario, `parentExternalId` dice cual comentario se respondio.
   * En un mensaje directo no hay ese enlace: Meta entrega un eco por cada
   * mensaje que la pagina envia, no una referencia al mensaje del usuario que
   * lo origino, asi que se usa `authorExternalId` (aqui, el destinatario del
   * eco) para marcar como respondida toda la conversacion abierta con esa
   * persona en esa cuenta.
   */
  fromInstitution?: boolean;
  /**
   * Que aplicacion envio la respuesta, cuando Meta lo informa (los ecos de
   * Messenger traen el id de la app). Solo para diagnostico en el registro;
   * no se persiste en la interaccion.
   */
  answeredByApp?: string;
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

  /**
   * Un lote de la importacion de todo el historico, sin filtro de fecha:
   * trae cada comentario de una pagina de publicaciones, sea de hoy o de
   * anos atras. `cursor` es lo que devolvio el lote anterior; null para
   * empezar desde la publicacion mas reciente. `nextCursor` null significa
   * que ya no quedan publicaciones mas viejas por revisar.
   */
  fetchHistoricalBatch(
    account: AccountCredentials,
    cursor: string | null,
  ): Promise<{ interactions: NormalizedInteraction[]; nextCursor: string | null }>;

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
