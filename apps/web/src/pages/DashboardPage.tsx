import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch, queryString } from '../api/client';
import { BarRow, Stat, TOPIC_LABEL, formatDuration } from '../components/ui';
import type { AnalyticsBreakdown, AnalyticsSummary, SocialAccount } from '../types';

/**
 * El tablero.
 *
 * Primero el numero que hoy no existe: cuantos comentarios llegaron y cuantos
 * quedaron sin responder. Despues el detalle por sentimiento, tema y cuenta.
 */

const RANGES = [
  { label: 'Ultimos 7 dias', days: 7 },
  { label: 'Ultimos 30 dias', days: 30 },
  { label: 'Ultimos 90 dias', days: 90 },
];

export function DashboardPage() {
  const [days, setDays] = useState(30);
  const [accountId, setAccountId] = useState('');

  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const params = queryString({ from, accountId });

  const summaryQuery = useQuery({
    queryKey: ['analytics', 'summary', days, accountId],
    queryFn: () => apiFetch<AnalyticsSummary>(`/analytics/summary${params}`),
  });

  const breakdownQuery = useQuery({
    queryKey: ['analytics', 'breakdown', days, accountId],
    queryFn: () => apiFetch<AnalyticsBreakdown>(`/analytics/breakdown${params}`),
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<{ accounts: SocialAccount[] }>('/accounts'),
  });

  const totals = summaryQuery.data?.totals;
  const breakdown = breakdownQuery.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Tablero</h1>
          <p>
            Volumen, sentimiento, temas y tiempo de respuesta del periodo. Es la cifra con la que
            se decide, no el informe de fin de mes.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="d-range">Periodo</label>
          <select id="d-range" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {RANGES.map((range) => (
              <option key={range.days} value={range.days}>
                {range.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="d-account">Cuenta</label>
          <select
            id="d-account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Todas</option>
            {(accountsQuery.data?.accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Las cuatro cifras que abren la conversacion con el equipo. */}
      {totals ? (
        <ul className="box-info">
          <li className="tone-blue">
            <i className="bx bxs-conversation" aria-hidden="true"></i>
            <span className="text">
              <h3>{totals.total.toLocaleString('es-CO')}</h3>
              <p>Interacciones recibidas</p>
            </span>
          </li>
          <li className="tone-orange">
            <i className="bx bxs-hourglass" aria-hidden="true"></i>
            <span className="text">
              <h3>{totals.unanswered.toLocaleString('es-CO')}</h3>
              <p>Sin responder</p>
            </span>
          </li>
          <li className="tone-red">
            <i className="bx bxs-error" aria-hidden="true"></i>
            <span className="text">
              <h3>{totals.urgent.toLocaleString('es-CO')}</h3>
              <p>Urgentes o criticos</p>
            </span>
          </li>
          <li className="tone-green">
            <i className="bx bxs-check-circle" aria-hidden="true"></i>
            <span className="text">
              <h3>{totals.answered.toLocaleString('es-CO')}</h3>
              <p>Respondidos · {totals.responseRate}%</p>
            </span>
          </li>
        </ul>
      ) : null}

      {totals ? (
        <div className="stat-grid">
          <Stat
            label="Tiempo promedio"
            value={formatDuration(summaryQuery.data?.responseTime.averageSeconds ?? 0)}
            hint={`Sobre ${summaryQuery.data?.responseTime.measured ?? 0} respuestas`}
          />
          <Stat
            label="Atiende una persona"
            value={totals.requiresHuman}
            hint="Casos que la politica excluye de la respuesta asistida"
          />
        </div>
      ) : (
        <div className="card">Cargando cifras...</div>
      )}

      {summaryQuery.data?.ai ? <AiConsumption ai={summaryQuery.data.ai} /> : null}

      {breakdown ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Sentimiento</h2>
            <Distribution
              rows={breakdown.bySentiment.map((row) => ({
                label:
                  row.key === 'POSITIVE'
                    ? 'Positivo'
                    : row.key === 'NEGATIVE'
                      ? 'Negativo'
                      : row.key === 'NEUTRAL'
                        ? 'Neutral'
                        : 'Sin clasificar',
                count: row.count,
                variant:
                  row.key === 'POSITIVE'
                    ? ('positive' as const)
                    : row.key === 'NEGATIVE'
                      ? ('negative' as const)
                      : undefined,
              }))}
            />
          </section>

          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Que esta preguntando el aspirante</h2>
            <Distribution
              rows={breakdown.byTopic.map((row) => ({
                label: TOPIC_LABEL[row.key] ?? row.key,
                count: row.count,
              }))}
            />
          </section>

          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Por cuenta y sede</h2>
            <Distribution
              rows={breakdown.byAccount.map((row) => ({
                label: row.key,
                count: row.count,
              }))}
            />
          </section>

          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Estado</h2>
            <Distribution
              rows={breakdown.byStatus.map((row) => ({
                label:
                  { PENDING: 'Pendiente', IN_PROGRESS: 'En curso', ANSWERED: 'Respondido', ARCHIVED: 'Archivado', HIDDEN: 'Oculto' }[
                    row.key
                  ] ?? row.key,
                count: row.count,
              }))}
            />
          </section>
        </div>
      ) : null}
    </>
  );
}

/**
 * Consumo de IA.
 *
 * Existe para que el gasto sea visible desde el primer dia y no una sorpresa
 * en la factura. "Resueltas sin costo" son las clasificaciones que se
 * despacharon con reglas locales o reutilizando un comentario identico.
 */
function AiConsumption({ ai }: { ai: AnalyticsSummary['ai'] }) {
  if (ai.classified === 0) return null;

  const costoCop = ai.estimatedCostUsd * 4000;

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginBottom: 4 }}>Consumo de IA</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.82rem' }}>
        Estimación con los precios publicados y los modelos configurados
        {' ('}
        {ai.models.classify === ai.models.draft
          ? ai.models.classify
          : `${ai.models.classify} y ${ai.models.draft}`}
        {'). '}
        La factura la emite Anthropic.
      </p>

      <div className="stat-grid" style={{ marginBottom: 0 }}>
        <Stat
          label="Costo estimado"
          value={`US$ ${ai.estimatedCostUsd.toFixed(3)}`}
          hint={`≈ $${Math.round(costoCop).toLocaleString('es-CO')} COP`}
        />
        <Stat
          label="Resueltas sin costo"
          value={`${ai.avoidedRate}%`}
          hint={`${ai.avoidedCalls} de ${ai.classified} clasificaciones`}
        />
        <Stat
          label="Consultas al modelo"
          value={ai.bySource.model ?? 0}
          hint={`${(ai.bySource.reused ?? 0)} reutilizadas · ${(ai.bySource.rule ?? 0)} por regla`}
        />
        <Stat
          label="Tokens"
          value={`${((ai.inputTokens + ai.outputTokens) / 1000).toFixed(1)}k`}
          hint={`${ai.inputTokens.toLocaleString('es-CO')} entrada · ${ai.outputTokens.toLocaleString('es-CO')} salida`}
        />
      </div>
    </section>
  );
}

function Distribution({
  rows,
}: {
  rows: Array<{ label: string; count: number; variant?: 'positive' | 'negative' }>;
}) {
  if (rows.length === 0) return <p className="muted">Sin datos en este periodo.</p>;

  const max = Math.max(...rows.map((row) => row.count));
  const sorted = [...rows].sort((a, b) => b.count - a.count);

  return (
    <div>
      {sorted.map((row) => (
        <BarRow
          key={row.label}
          label={row.label}
          count={row.count}
          max={max}
          variant={row.variant}
        />
      ))}
    </div>
  );
}
