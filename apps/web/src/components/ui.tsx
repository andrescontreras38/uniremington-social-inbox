import type { ReactNode } from 'react';
import type { InteractionStatus, Sentiment, Urgency } from '../types';

/** Piezas visuales reutilizadas. Sin logica de negocio. */

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info';
  title?: string;
}) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

const SENTIMENT_LABEL: Record<Sentiment, { label: string; tone: 'positive' | 'negative' | 'neutral' }> =
  {
    POSITIVE: { label: 'Positivo', tone: 'positive' },
    NEUTRAL: { label: 'Neutral', tone: 'neutral' },
    NEGATIVE: { label: 'Negativo', tone: 'negative' },
  };

export function SentimentBadge({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return <Badge>Sin clasificar</Badge>;
  const config = SENTIMENT_LABEL[sentiment];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

const URGENCY_LABEL: Record<Urgency, { label: string; tone: 'neutral' | 'warning' | 'negative' }> = {
  LOW: { label: 'Baja', tone: 'neutral' },
  MEDIUM: { label: 'Media', tone: 'neutral' },
  HIGH: { label: 'Urgente', tone: 'warning' },
  CRITICAL: { label: 'Critico', tone: 'negative' },
};

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const config = URGENCY_LABEL[urgency];
  if (urgency === 'LOW' || urgency === 'MEDIUM') return null;
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export const TOPIC_LABEL: Record<string, string> = {
  QUESTION: 'Pregunta',
  COMPLAINT: 'Queja',
  PRAISE: 'Elogio',
  ENROLLMENT_INTENT: 'Interes de matricula',
  SUPPORT: 'Soporte',
  SPAM: 'Spam',
  OTHER: 'Otro',
  SIN_CLASIFICAR: 'Sin clasificar',
};

export const STATUS_LABEL: Record<InteractionStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  ANSWERED: 'Respondido',
  ARCHIVED: 'Archivado',
  HIDDEN: 'Oculto',
};

export function TopicBadge({ topic }: { topic: string | null }) {
  if (!topic) return null;
  return <Badge tone={topic === 'ENROLLMENT_INTENT' ? 'info' : 'neutral'}>{TOPIC_LABEL[topic] ?? topic}</Badge>;
}

export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warning' | 'error';
  children: ReactNode;
}) {
  return <div className={`notice notice--${kind}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
    </div>
  );
}

export function BarRow({
  label,
  count,
  max,
  variant,
}: {
  label: string;
  count: number;
  max: number;
  variant?: 'positive' | 'negative';
}) {
  const width = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="bar">
        <span className={variant ? `is-${variant}` : ''} style={{ width: `${width}%` }} />
      </div>
      <span className="count">{count}</span>
    </div>
  );
}

/** Fecha corta y legible en espanol de Colombia. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Tiempo transcurrido en palabras: "hace 12 min". */
export function timeAgo(value: string): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'hace instantes';
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86400)} d`;
}

/** Duracion legible a partir de segundos. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3600;
  return hours < 24 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}
