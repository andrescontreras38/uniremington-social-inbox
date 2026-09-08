import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { apiFetch, ApiError, queryString } from '../api/client';
import { Badge, Notice, formatDate } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { Alert, AppUser, AuditEntry, Pagination, Role, SocialAccount } from '../types';

/** Pantallas de administracion: cuentas, usuarios, alertas y auditoria. */

function useErrorMessage() {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    capture: (caught: unknown) =>
      setError(caught instanceof ApiError ? caught.message : 'No se pudo completar la operacion'),
  };
}

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

export function AccountsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { error, capture, clear } = useErrorMessage();
  const [form, setForm] = useState({
    provider: 'META_INSTAGRAM',
    externalId: '',
    name: '',
    campus: 'NACIONAL',
    accessToken: '',
  });
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [newToken, setNewToken] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ batches: number; imported: number } | null>(
    null,
  );
  const importCancelRef = useRef(false);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<{ accounts: SocialAccount[] }>('/accounts'),
  });

  const create = useMutation({
    mutationFn: () => apiFetch('/accounts', { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ ...form, externalId: '', name: '', accessToken: '' });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: capture,
  });

  const sync = useMutation({
    mutationFn: ({ id, sinceDays }: { id: string; sinceDays?: number }) =>
      apiFetch(`/accounts/${id}/sync`, { method: 'POST', body: sinceDays ? { sinceDays } : {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: capture,
  });

  const rotateToken = useMutation({
    mutationFn: ({ id, accessToken }: { id: string; accessToken: string }) =>
      apiFetch(`/accounts/${id}/token`, { method: 'POST', body: { accessToken } }),
    onSuccess: () => {
      setRotatingId(null);
      setNewToken('');
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: capture,
  });

  // Encadena lotes de /import-historical hasta que el servidor diga que no
  // quedan publicaciones mas viejas por revisar (o hasta que se cancele).
  // Cada lote es una llamada corta; el ciclo completo puede tomar muchas
  // llamadas si la pagina tiene anos de publicaciones.
  async function runFullImport(id: string) {
    importCancelRef.current = false;
    setImportingId(id);
    setImportProgress({ batches: 0, imported: 0 });
    clear();

    try {
      let done = false;
      let batches = 0;
      let imported = 0;

      while (!done && !importCancelRef.current) {
        const res = await apiFetch<{ summary: { created: number; done: boolean } }>(
          `/accounts/${id}/import-historical`,
          { method: 'POST' },
        );
        batches += 1;
        imported += res.summary.created;
        done = res.summary.done;
        setImportProgress({ batches, imported });
      }
    } catch (err) {
      capture(err);
    } finally {
      setImportingId(null);
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Cuentas conectadas</h1>
          <p>
            La cuenta nacional y las de sede. El acceso se concede desde el Business Manager de
            Uniremington; no se comparten contrasenas y el token se guarda cifrado.
          </p>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="card table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Red</th>
              <th>Sede</th>
              <th>Estado</th>
              <th>Ultima sincronizacion</th>
              <th>Interacciones</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(accountsQuery.data?.accounts ?? []).map((account) => (
              <tr key={account.id}>
                <td>
                  <strong>{account.name}</strong>
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    {account.externalId}
                  </div>
                </td>
                <td>{account.provider === 'META_INSTAGRAM' ? 'Instagram' : 'Facebook'}</td>
                <td>{account.campus}</td>
                <td>
                  {!account.isActive ? (
                    <Badge tone="negative">Inactiva</Badge>
                  ) : account.isConnected ? (
                    <Badge tone="positive">Conectada</Badge>
                  ) : (
                    <Badge tone="warning">Sin token</Badge>
                  )}
                </td>
                <td>{formatDate(account.lastSyncAt)}</td>
                <td>{account._count.interactions}</td>
                <td>
                  {can('accounts:write') ? (
                    rotatingId === account.id ? (
                      <div className="toolbar" style={{ gap: 6 }}>
                        <input
                          type="password"
                          autoComplete="off"
                          placeholder="Token de pagina"
                          value={newToken}
                          onChange={(event) => setNewToken(event.target.value)}
                          style={{ minWidth: 180 }}
                        />
                        <button
                          type="button"
                          className="primary"
                          disabled={rotateToken.isPending || newToken.length < 10}
                          onClick={() => rotateToken.mutate({ id: account.id, accessToken: newToken })}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRotatingId(null);
                            setNewToken('');
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="toolbar" style={{ gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => sync.mutate({ id: account.id })}
                          disabled={sync.isPending || !account.isConnected}
                        >
                          Sincronizar
                        </button>
                        <button
                          type="button"
                          title="Trae comentarios de hasta 90 dias atras, sin importar la ultima sincronizacion"
                          onClick={() => sync.mutate({ id: account.id, sinceDays: 90 })}
                          disabled={sync.isPending || !account.isConnected}
                        >
                          Traer historial (90 dias)
                        </button>
                        {importingId === account.id ? (
                          <button type="button" onClick={() => (importCancelRef.current = true)}>
                            Detener (lote {importProgress?.batches ?? 0} · {importProgress?.imported ?? 0}{' '}
                            nuevos)
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Revisa TODAS las publicaciones de la cuenta, sin limite de fecha, hasta traer todo lo que exista"
                            onClick={() => void runFullImport(account.id)}
                            disabled={importingId !== null || !account.isConnected}
                          >
                            Importar todo el historial
                          </button>
                        )}
                        <button type="button" onClick={() => setRotatingId(account.id)}>
                          Actualizar token
                        </button>
                      </div>
                    )
                  ) : null}
                  {account.historicalImportedAt && importingId !== account.id ? (
                    <div className="muted" style={{ fontSize: '0.72rem', marginTop: 4 }}>
                      Historial completo importado el {formatDate(account.historicalImportedAt)}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {(accountsQuery.data?.accounts ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No hay cuentas conectadas.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {can('accounts:write') ? (
        <form
          className="card"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            clear();
            create.mutate();
          }}
        >
          <h2 style={{ marginBottom: 12 }}>Conectar una cuenta</h2>

          <div className="toolbar">
            <div className="field">
              <label htmlFor="a-provider">Red</label>
              <select
                id="a-provider"
                value={form.provider}
                onChange={(event) => setForm({ ...form, provider: event.target.value })}
              >
                <option value="META_INSTAGRAM">Instagram</option>
                <option value="META_FACEBOOK">Facebook</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="a-name">Nombre</label>
              <input
                id="a-name"
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="a-external">ID de pagina o cuenta</label>
              <input
                id="a-external"
                required
                value={form.externalId}
                onChange={(event) => setForm({ ...form, externalId: event.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="a-campus">Sede</label>
              <input
                id="a-campus"
                value={form.campus}
                onChange={(event) => setForm({ ...form, campus: event.target.value })}
              />
            </div>

            <div className="field" style={{ minWidth: 240 }}>
              <label htmlFor="a-token">Token de pagina</label>
              <input
                id="a-token"
                type="password"
                autoComplete="off"
                value={form.accessToken}
                onChange={(event) => setForm({ ...form, accessToken: event.target.value })}
              />
            </div>

            <button type="submit" className="primary" disabled={create.isPending}>
              Conectar
            </button>
          </div>

          <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>
            El token se cifra antes de guardarse y no vuelve a mostrarse por ninguna pantalla.
          </p>
        </form>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Agente',
  VIEWER: 'Observador',
};

const ROLE_HINT: Record<Role, string> = {
  ADMIN: 'Todo, incluidas cuentas y usuarios',
  SUPERVISOR: 'Aprueba, publica y modera',
  AGENT: 'Redacta borradores, no aprueba',
  VIEWER: 'Solo consulta',
};

export function UsersPage() {
  const queryClient = useQueryClient();
  const { error, capture, clear } = useErrorMessage();
  const [form, setForm] = useState({ email: '', name: '', role: 'AGENT' as Role, password: '' });

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: AppUser[] }>('/users'),
  });

  const create = useMutation({
    mutationFn: () => apiFetch('/users', { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ email: '', name: '', role: 'AGENT', password: '' });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: capture,
  });

  const update = useMutation({
    mutationFn: (payload: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/users/${payload.id}`, { method: 'PATCH', body: payload.body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: capture,
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Usuarios</h1>
          <p>
            Sin costo por persona: cree los que el equipo necesite. El rol define quien aprueba y
            publica en nombre de la institucion.
          </p>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="card table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Ultimo ingreso</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(usersQuery.data?.users ?? []).map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td className="muted">{user.email}</td>
                <td>
                  <select
                    value={user.role}
                    onChange={(event) =>
                      update.mutate({ id: user.id, body: { role: event.target.value } })
                    }
                    style={{ width: 'auto' }}
                  >
                    {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{formatDate(user.lastLoginAt)}</td>
                <td>
                  {user.isActive ? (
                    <Badge tone="positive">Activo</Badge>
                  ) : (
                    <Badge tone="negative">Inactivo</Badge>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() =>
                      update.mutate({ id: user.id, body: { isActive: !user.isActive } })
                    }
                  >
                    {user.isActive ? 'Desactivar' : 'Reactivar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="card"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          clear();
          create.mutate();
        }}
      >
        <h2 style={{ marginBottom: 12 }}>Crear usuario</h2>

        <div className="toolbar">
          <div className="field">
            <label htmlFor="u-name">Nombre</label>
            <input
              id="u-name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>

          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="u-email">Correo</label>
            <input
              id="u-email"
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="u-role">Rol</label>
            <select
              id="u-role"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
            >
              {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="u-password">Contrasena inicial</label>
            <input
              id="u-password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </div>

          <button type="submit" className="primary" disabled={create.isPending}>
            Crear
          </button>
        </div>

        <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>
          {ROLE_HINT[form.role]}. Minimo 12 caracteres; se pedira cambiarla en el primer ingreso.
        </p>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export function AlertsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: () => apiFetch<{ items: Alert[]; pagination: Pagination }>('/alerts'),
    refetchInterval: 60_000,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => apiFetch(`/alerts/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Alertas</h1>
          <p>
            Casos urgentes y acumulacion de comentarios negativos. El texto aparece enmascarado por
            proteccion de datos personales.
          </p>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Alerta</th>
              <th>Cuenta</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(alertsQuery.data?.items ?? []).map((alert) => (
              <tr key={alert.id}>
                <td>
                  <Badge tone={alert.severity === 'CRITICAL' ? 'negative' : 'warning'}>
                    {alert.severity === 'CRITICAL' ? 'Critica' : 'Aviso'}
                  </Badge>
                </td>
                <td>
                  <strong>{alert.title}</strong>
                  <div className="muted">{alert.message}</div>
                </td>
                <td>{alert.account?.name ?? '—'}</td>
                <td>{formatDate(alert.createdAt)}</td>
                <td>{alert.status === 'OPEN' ? 'Abierta' : 'Revisada'}</td>
                <td>
                  {can('alerts:write') && alert.status === 'OPEN' ? (
                    <button type="button" onClick={() => acknowledge.mutate(alert.id)}>
                      Marcar revisada
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {(alertsQuery.data?.items ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No hay alertas.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export function AuditPage() {
  const [action, setAction] = useState('');

  const auditQuery = useQuery({
    queryKey: ['audit', action],
    queryFn: () =>
      apiFetch<{ items: AuditEntry[]; pagination: Pagination }>(
        `/audit${queryString({ action, pageSize: 100 })}`,
      ),
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Auditoria</h1>
          <p>
            Quien aprobo, publico, oculto o asigno cada cosa. Es el respaldo de la regla: nada sale
            publicado sin que una persona lo apruebe.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="au-action">Accion</label>
          <select id="au-action" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">Todas</option>
            <option value="reply.published">Respuesta publicada</option>
            <option value="reply.approved">Respuesta aprobada</option>
            <option value="reply.drafted">Borrador creado</option>
            <option value="interaction.hidden">Comentario oculto</option>
            <option value="auth.login">Ingreso</option>
            <option value="auth.login_failed">Ingreso fallido</option>
            <option value="account.token_rotated">Token rotado</option>
          </select>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Quien</th>
              <th>Accion</th>
              <th>Entidad</th>
              <th>Detalle</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {(auditQuery.data?.items ?? []).map((entry) => (
              <tr key={entry.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDate(entry.createdAt)}</td>
                <td>{entry.actorEmail ?? 'Sistema'}</td>
                <td>{entry.action}</td>
                <td className="muted">
                  {entry.entityType}
                  {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}
                </td>
                <td className="muted" style={{ maxWidth: 320, wordBreak: 'break-word' }}>
                  {entry.metadata ?? '—'}
                </td>
                <td className="muted">{entry.ipAddress ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
