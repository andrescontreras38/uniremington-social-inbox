import { z } from 'zod';

/**
 * Valores enumerados del dominio.
 *
 * La base de datos los guarda como texto para mantener el esquema portable
 * entre SQLite y PostgreSQL; este archivo es la unica fuente de verdad y
 * valida toda entrada y salida.
 *
 * Cada enumeracion se declara primero como arreglo constante y despues como
 * esquema de Zod. El arreglo permite reutilizar los mismos valores en el
 * esquema de salida estructurada del modelo, que usa otra version de Zod, sin
 * que las dos listas se separen con el tiempo.
 */

export const ROLES = ['ADMIN', 'SUPERVISOR', 'AGENT', 'VIEWER'] as const;
export const Role = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

export const PROVIDERS = ['META_FACEBOOK', 'META_INSTAGRAM'] as const;
export const Provider = z.enum(PROVIDERS);
export type Provider = (typeof PROVIDERS)[number];

export const INTERACTION_KINDS = ['COMMENT', 'DIRECT_MESSAGE'] as const;
export const InteractionKind = z.enum(INTERACTION_KINDS);
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const;
export const Sentiment = z.enum(SENTIMENTS);
export type Sentiment = (typeof SENTIMENTS)[number];

export const TOPICS = [
  'QUESTION',
  'COMPLAINT',
  'PRAISE',
  'ENROLLMENT_INTENT',
  'SUPPORT',
  'SPAM',
  'OTHER',
] as const;
export const Topic = z.enum(TOPICS);
export type Topic = (typeof TOPICS)[number];

export const URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const Urgency = z.enum(URGENCIES);
export type Urgency = (typeof URGENCIES)[number];

export const INTERACTION_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'ANSWERED',
  'ARCHIVED',
  'HIDDEN',
] as const;
export const InteractionStatus = z.enum(INTERACTION_STATUSES);
export type InteractionStatus = (typeof INTERACTION_STATUSES)[number];

export const REPLY_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'FAILED',
] as const;
export const ReplyStatus = z.enum(REPLY_STATUSES);
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const REPLY_ORIGINS = ['AI_DRAFT', 'HUMAN'] as const;
export const ReplyOrigin = z.enum(REPLY_ORIGINS);
export type ReplyOrigin = (typeof REPLY_ORIGINS)[number];

/**
 * PUBLIC: comentario visible bajo la publicacion.
 * PRIVATE_REPLY: respuesta privada de Meta al mismo comentario (Private
 * Replies), un mensaje 1 a 1 que no aparece en el feed. Solo aplica a
 * interacciones de tipo COMMENT.
 */
export const REPLY_CHANNELS = ['PUBLIC', 'PRIVATE_REPLY'] as const;
export const ReplyChannel = z.enum(REPLY_CHANNELS);
export type ReplyChannel = (typeof REPLY_CHANNELS)[number];

export const ALERT_TYPES = [
  'URGENT_INTERACTION',
  'NEGATIVE_SPIKE',
  'PII_DETECTED',
  'PUBLISH_FAILURE',
] as const;
export const AlertType = z.enum(ALERT_TYPES);
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const AlertSeverity = z.enum(ALERT_SEVERITIES);
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export const AlertStatus = z.enum(ALERT_STATUSES);
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/**
 * Banderas de datos personales o sensibles detectados en el texto.
 * Cualquiera de ellas obliga revision humana (acuerdo de la propuesta).
 */
export const PII_FLAGS = [
  'DOCUMENT_ID',
  'PHONE',
  'EMAIL',
  'FINANCIAL',
  'HEALTH',
  'ADDRESS',
  'PERSONAL_ATTACK',
] as const;
export const PiiFlag = z.enum(PII_FLAGS);
export type PiiFlag = (typeof PII_FLAGS)[number];
