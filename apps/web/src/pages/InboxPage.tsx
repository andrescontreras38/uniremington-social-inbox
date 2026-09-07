import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError, queryString } from '../api/client';
import {
  Avatar,
  Badge,
  KindIcon,
  Notice,
  SentimentBadge,
  STATUS_LABEL,
  TopicBadge,
  UrgencyBadge,
  formatDate,
  formatDuration,
  timeAgo,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type {
  AppUser,
  Interaction,
  InteractionDetail,
  Pagination,
  SocialAccount,
} from '../types';

/**
 * La bandeja.
 *
 * Izquierda: la cola con filtros. Derecha: el caso abierto, con la publicacion
 * a la que responde, el borrador y las acciones. Es la pantalla donde el
 * equipo pasa el dia, asi que el flujo es leer, redactar, aprobar, publicar,
 * sin cambiar de lugar.
 */

interface Filters {
  status: string;
  urgency: string;
  topic: string;
  sentiment: string;
  accountId: string;
  assignedTo: string;
  search: string;
}

const EMPTY_FILTERS: Filters = {
  status: 'PENDING',
  urgency: '',
  topic: '',
  sentiment: '',
  accountId: '',
  assignedTo: '',
  search: '',
};

export function InboxPage() {
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  // La busqueda de la barra superior llega como ?buscar=... y siembra el filtro.
  const [searchParams] = useSearchParams();
  const termFromUrl = searchParams.get('buscar') ?? '';
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, search: termFromUrl });

  useEffect(() => {
    setFilters((current) =>
      current.search === termFromUrl ? current : { ...current, search: termFromUrl },
    );
  }, [termFromUrl]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['inbox', filters],
    queryFn: () =>
      apiFetch<{ items: Interaction[]; pagination: Pagination }>(
        `/inbox${queryString({ ...filters, pageSize: 50, sort: 'urgency' })}`,
      ),
    refetchInterval: 60_000,
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<{ accounts: SocialAccount[] }>('/accounts'),
    enabled: can('accounts:read'),
  });

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: AppUser[] }>('/users'),
    enabled: can('users:read'),
  });

  const items = listQuery.data?.items ?? [];

  // Solo elige el primero cuando no hay nada seleccionado (carga inicial o
  // filtro nuevo sin resultados). Si ya hay un caso abierto, se queda ahi
  // aunque una accion propia (por ejemplo generar un borrador, que cambia el
  // estado a "En curso") lo saque del filtro actual: cambiar de tarjeta sin
  // que el usuario lo pida es mas disruptivo que dejarla fuera del filtro.
  useEffect(() => {
    if (selectedId) return;
    if (items.length > 0) setSelectedId(items[0]!.id);
  }, [items, selectedId]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    void queryClient.invalidateQueries({ queryKey: ['interaction'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Bandeja</h1>
          <p>
            Comentarios y mensajes de todas las cuentas conectadas. Ninguna respuesta se publica
            sin que una persona la apruebe.
          </p>
        </div>
        <div className="muted">
          {listQuery.data ? `${listQuery.data.pagination.total} en este filtro` : null}
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="f-status">Estado</label>
          <select
            id="f-status"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendientes</option>
            <option value="IN_PROGRESS">En curso</option>
            <option value="ANSWERED">Respondidos</option>
            <option value="ARCHIVED">Archivados</option>
            <option value="HIDDEN">Ocultos</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-urgency">Urgencia</label>
          <select
            id="f-urgency"
            value={filters.urgency}
            onChange={(event) => setFilters({ ...filters, urgency: event.target.value })}
          >
            <option value="">Toda</option>
            <option value="CRITICAL">Critica</option>
            <option value="HIGH">Urgente</option>
            <option value="MEDIUM">Media</option>
            <option value="LOW">Baja</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-topic">Tema</label>
          <select
            id="f-topic"
            value={filters.topic}
            onChange={(event) => setFilters({ ...filters, topic: event.target.value })}
          >
            <option value="">Todos</option>
            <option value="ENROLLMENT_INTENT">Interes de matricula</option>
            <option value="QUESTION">Pregunta</option>
            <option value="COMPLAINT">Queja</option>
            <option value="SUPPORT">Soporte</option>
            <option value="PRAISE">Elogio</option>
            <option value="SPAM">Spam</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-account">Cuenta</label>
          <select
            id="f-account"
            value={filters.accountId}
            onChange={(event) => setFilters({ ...filters, accountId: event.target.value })}
          >
            <option value="">Todas</option>
            {(accountsQuery.data?.accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="f-assigned">Asignacion</label>
          <select
            id="f-assigned"
            value={filters.assignedTo}
            onChange={(event) => setFilters({ ...filters, assignedTo: event.target.value })}
          >
            <option value="">Cualquiera</option>
            <option value="me">Los mios</option>
            <option value="unassigned">Sin asignar</option>
          </select>
        </div>

        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="f-search">Buscar</label>
          <input
            id="f-search"
            type="search"
            placeholder="Texto del comentario"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>

        <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
          Limpiar
        </button>
      </div>

      <div className="inbox">
        <div className="inbox__list">
          {listQuery.isLoading ? (
            <div className="empty">Cargando...</div>
          ) : items.length === 0 ? (
            <div className="empty">
              No hay interacciones con estos filtros.
              <br />
              <span className="muted">
                Si acaba de conectar una cuenta, sincronicela desde Cuentas.
              </span>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`inbox__item ${item.id === selectedId ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="inbox__item-head">
                  <div className="inbox__item-who">
                    <Avatar name={item.authorName} provider={item.account.provider} size="sm" />
                    <span className="inbox__author">{item.authorName ?? 'Anonimo'}</span>
                    <KindIcon kind={item.kind} />
                  </div>
                  <span className="inbox__time" title={formatDate(item.remoteCreatedAt)}>
                    {timeAgo(item.remoteCreatedAt)}
                  </span>
                </div>
                <div className="inbox__text">{item.text}</div>
                <div className="inbox__tags">
                  <UrgencyBadge urgency={item.urgency} />
                  <TopicBadge topic={item.topic} />
                  <SentimentBadge sentiment={item.sentiment} />
                  {item.requiresHuman ? <Badge tone="warning">Atiende una persona</Badge> : null}
                  {item.isHidden ? <Badge tone="negative">Oculto</Badge> : null}
                  {item.assignedTo ? <Badge>{item.assignedTo.name}</Badge> : null}
                  <Badge>{item.account.campus}</Badge>
                </div>
              </button>
            ))
          )}
        </div>

        <div>
          {selectedId ? (
            <InteractionDetailPanel
              interactionId={selectedId}
              users={usersQuery.data?.users ?? []}
              currentUserId={user?.id ?? null}
              onChanged={invalidate}
            />
          ) : (
            <div className="detail">
              <div className="empty">Seleccione una interaccion para verla.</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function InteractionDetailPanel({
  interactionId,
  users,
  currentUserId,
  onChanged,
}: {
  interactionId: string;
  users: AppUser[];
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [draftText, setDraftText] = useState('');
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error' | 'warning'; text: string } | null>(
    null,
  );

  const detailQuery = useQuery({
    queryKey: ['interaction', interactionId],
    queryFn: () => apiFetch<{ interaction: InteractionDetail }>(`/inbox/${interactionId}`),
  });

  const interaction = detailQuery.data?.interaction;

  // Al cambiar de caso se carga el borrador vigente, si lo hay.
  useEffect(() => {
    const pending = interaction?.replies.find(
      (reply) => reply.status === 'DRAFT' || reply.status === 'APPROVED',
    );
    setActiveReplyId(pending?.id ?? null);
    setDraftText(pending?.finalText ?? pending?.draftText ?? '');
    setMessage(null);
  }, [interaction]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['interaction', interactionId] });
    onChanged();
  }

  function handleError(error: unknown) {
    setMessage({
      kind: 'error',
      text: error instanceof ApiError ? error.message : 'No se pudo completar la operacion',
    });
  }

  const aiDraft = useMutation({
    mutationFn: (style?: string) =>
      apiFetch<{ reply: { id: string; text: string } }>(
        `/replies/interactions/${interactionId}/draft`,
        { method: 'POST', body: style ? { style } : {} },
      ),
    onSuccess: (data) => {
      setActiveReplyId(data.reply.id);
      setDraftText(data.reply.text);
      setMessage({ kind: 'info', text: 'Borrador generado. Reviselo antes de aprobar.' });
      refresh();
    },
    onError: handleError,
  });

  const manualDraft = useMutation({
    mutationFn: (text: string) =>
      apiFetch<{ reply: { id: string } }>(`/replies/interactions/${interactionId}/manual-draft`, {
        method: 'POST',
        body: { text },
      }),
    onSuccess: (data) => {
      setActiveReplyId(data.reply.id);
      setMessage({ kind: 'info', text: 'Borrador guardado.' });
      refresh();
    },
    onError: handleError,
  });

  const approve = useMutation({
    mutationFn: (replyId: string) =>
      apiFetch(`/replies/${replyId}/approve`, { method: 'POST', body: { text: draftText } }),
    onSuccess: () => {
      setMessage({ kind: 'info', text: 'Respuesta aprobada. Ya puede publicarse.' });
      refresh();
    },
    onError: handleError,
  });

  const publish = useMutation({
    mutationFn: (replyId: string) => apiFetch(`/replies/${replyId}/publish`, { method: 'POST' }),
    onSuccess: () => {
      setMessage({ kind: 'info', text: 'Respuesta publicada.' });
      refresh();
    },
    onError: handleError,
  });

  const assign = useMutation({
    mutationFn: (userId: string | null) =>
      apiFetch(`/inbox/${interactionId}/assign`, { method: 'POST', body: { userId } }),
    onSuccess: refresh,
    onError: handleError,
  });

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/inbox/${interactionId}/status`, { method: 'POST', body: { status } }),
    onSuccess: refresh,
    onError: handleError,
  });

  const hide = useMutation({
    mutationFn: (hidden: boolean) =>
      apiFetch(`/inbox/${interactionId}/hide`, { method: 'POST', body: { hidden } }),
    onSuccess: refresh,
    onError: handleError,
  });

  if (detailQuery.isLoading || !interaction) {
    return (
      <div className="detail">
        <div className="empty">Cargando...</div>
      </div>
    );
  }

  const activeReply = interaction.replies.find((reply) => reply.id === activeReplyId) ?? null;
  const piiFlags = interaction.piiFlags?.split(',').filter(Boolean) ?? [];
  const busy =
    aiDraft.isPending || manualDraft.isPending || approve.isPending || publish.isPending;

  return (
    <div className="detail">
      <div className="detail__section">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Avatar name={interaction.authorName} provider={interaction.account.provider} />
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {interaction.authorName ?? 'Anonimo'}
                <KindIcon kind={interaction.kind} />
              </h2>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                {interaction.account.name} · {interaction.kind === 'COMMENT' ? 'Comentario' : 'Mensaje directo'}{' '}
                · <span title={formatDate(interaction.remoteCreatedAt)}>{timeAgo(interaction.remoteCreatedAt)}</span>
                {interaction.permalink ? (
                  <>
                    {' · '}
                    <a href={interaction.permalink} target="_blank" rel="noreferrer noopener">
                      Ver en la red
                    </a>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="inbox__tags">
            <Badge>{STATUS_LABEL[interaction.status]}</Badge>
            <UrgencyBadge urgency={interaction.urgency} />
            <TopicBadge topic={interaction.topic} />
            <SentimentBadge sentiment={interaction.sentiment} />
          </div>
        </div>
      </div>

      {interaction.post ? (
        <div className="detail__section detail__post">
          {interaction.post.thumbnailUrl ? (
            <img src={interaction.post.thumbnailUrl} alt="" />
          ) : null}
          <div>
            <strong>Responde a esta publicacion</strong>
            <div>{interaction.post.caption ?? 'Sin texto'}</div>
            {interaction.post.permalink ? (
              <a href={interaction.post.permalink} target="_blank" rel="noreferrer noopener">
                Abrir publicacion
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="detail__section">
        <div className="detail__comment">{interaction.text}</div>
        {interaction.summary ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Resumen: {interaction.summary}
          </p>
        ) : null}
      </div>

      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

      {interaction.requiresHuman ? (
        <Notice kind="warning">
          <strong>Este caso lo atiende una persona.</strong>{' '}
          {interaction.classifierNote ?? 'Politica de atencion.'}
          {piiFlags.length > 0 ? ` Datos detectados: ${piiFlags.join(', ')}.` : ''}
        </Notice>
      ) : null}

      {interaction.answeredExternally ? (
        <Notice kind="info">
          El equipo respondio directamente desde Meta. Ya no figura como pendiente.
        </Notice>
      ) : null}

      <div className="detail__section">
        <h3 style={{ marginBottom: 8 }}>Respuesta</h3>

        {can('reply:draft') ? (
          <>
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              placeholder={
                interaction.requiresHuman
                  ? 'Escriba la respuesta. Este caso no admite borrador asistido.'
                  : 'Escriba la respuesta o pida un borrador a la IA.'
              }
              maxLength={2000}
            />
            <div className="muted" style={{ fontSize: '0.75rem', textAlign: 'right' }}>
              {draftText.length} / 2000
            </div>

            <div className="actions">
              {!interaction.requiresHuman ? (
                <>
                  <button
                    type="button"
                    onClick={() => aiDraft.mutate(undefined)}
                    disabled={busy}
                  >
                    {aiDraft.isPending ? 'Redactando...' : 'Redactar con IA'}
                  </button>
                  <button type="button" onClick={() => aiDraft.mutate('shorter')} disabled={busy}>
                    Mas corto
                  </button>
                  <button
                    type="button"
                    onClick={() => aiDraft.mutate('more_formal')}
                    disabled={busy}
                  >
                    Mas formal
                  </button>
                  <button type="button" onClick={() => aiDraft.mutate('warmer')} disabled={busy}>
                    Mas cercano
                  </button>
                </>
              ) : null}

              <button
                type="button"
                onClick={() => manualDraft.mutate(draftText)}
                disabled={busy || draftText.trim().length === 0}
              >
                Guardar borrador
              </button>

              {can('reply:approve') && activeReply && activeReply.status !== 'PUBLISHED' ? (
                <button
                  type="button"
                  onClick={() => approve.mutate(activeReply.id)}
                  disabled={busy || draftText.trim().length === 0}
                >
                  Aprobar
                </button>
              ) : null}

              {can('reply:publish') && activeReply?.status === 'APPROVED' ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => publish.mutate(activeReply.id)}
                  disabled={busy}
                >
                  {publish.isPending ? 'Publicando...' : 'Publicar'}
                </button>
              ) : null}
            </div>

            {activeReply?.status === 'DRAFT' && can('reply:approve') ? (
              <p className="muted" style={{ fontSize: '0.78rem' }}>
                Al aprobar queda registrado su nombre como responsable del texto publicado.
              </p>
            ) : null}
            {activeReply?.status === 'APPROVED' ? (
              <p className="muted" style={{ fontSize: '0.78rem' }}>
                Aprobada por {activeReply.approvedBy?.name ?? 'un usuario'}. Editar el texto
                invalida la aprobacion.
              </p>
            ) : null}
          </>
        ) : (
          <Notice kind="info">Su rol permite consultar, pero no redactar respuestas.</Notice>
        )}
      </div>

      <div className="detail__section">
        <h3 style={{ marginBottom: 8 }}>Acciones</h3>
        <div className="actions">
          {can('inbox:assign') ? (
            <select
              value={interaction.assignedTo?.id ?? ''}
              onChange={(event) => assign.mutate(event.target.value || null)}
              style={{ width: 'auto', minWidth: 180 }}
            >
              <option value="">Sin asignar</option>
              {currentUserId ? <option value={currentUserId}>Asignarmelo</option> : null}
              {users
                .filter((candidate) => candidate.isActive && candidate.id !== currentUserId)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          ) : null}

          {can('inbox:archive') ? (
            <button type="button" onClick={() => setStatus.mutate('ARCHIVED')}>
              Archivar
            </button>
          ) : null}

          {can('inbox:moderate') ? (
            <button
              type="button"
              className={interaction.isHidden ? '' : 'danger'}
              onClick={() => hide.mutate(!interaction.isHidden)}
            >
              {interaction.isHidden ? 'Volver a mostrar' : 'Ocultar en la red'}
            </button>
          ) : null}
        </div>
      </div>

      {interaction.replies.length > 0 ? (
        <div className="detail__section">
          <h3 style={{ marginBottom: 8 }}>Historial</h3>
          <ul className="reply-history">
            {interaction.replies.map((reply) => (
              <li key={reply.id}>
                <strong>{REPLY_STATUS_LABEL[reply.status] ?? reply.status}</strong>
                {reply.origin === 'AI_DRAFT' ? ' · borrador de IA' : ' · escrito a mano'}
                {reply.approvedBy ? ` · aprobo ${reply.approvedBy.name}` : ''}
                {reply.publishedAt ? ` · publicado ${timeAgo(reply.publishedAt)}` : ''}
                {reply.publishError ? ` · error: ${reply.publishError}` : ''}
              </li>
            ))}
          </ul>
          {interaction.firstResponseSeconds ? (
            <p className="muted" style={{ fontSize: '0.78rem' }}>
              Tiempo de respuesta: {formatDuration(interaction.firstResponseSeconds)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const REPLY_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobacion',
  APPROVED: 'Aprobada',
  PUBLISHED: 'Publicada',
  REJECTED: 'Descartada',
  FAILED: 'Fallo al publicar',
};
