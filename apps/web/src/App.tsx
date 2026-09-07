import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { apiFetch } from './api/client';
import { timeAgo } from './components/ui';
import { useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import { AccountsPage, AlertsPage, AuditPage, UsersPage } from './pages/AdminPages';
import { DashboardPage } from './pages/DashboardPage';
import { InboxPage } from './pages/InboxPage';
import { LoginPage } from './pages/LoginPage';
import { TemplatesPage } from './pages/TemplatesPage';
import type { Alert, Pagination, Permission } from './types';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login">
        <p className="muted">Verificando sesion...</p>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <>
      <Sidebar />
      <section id="content">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/bandeja" replace />} />
            <Route path="/bandeja" element={<InboxPage />} />
            <Route path="/bandeja/:id" element={<InboxPage />} />
            <Route
              path="/tablero"
              element={
                <Guard permission="analytics:read">
                  <DashboardPage />
                </Guard>
              }
            />
            <Route
              path="/plantillas"
              element={
                <Guard permission="templates:read">
                  <TemplatesPage />
                </Guard>
              }
            />
            <Route
              path="/cuentas"
              element={
                <Guard permission="accounts:read">
                  <AccountsPage />
                </Guard>
              }
            />
            <Route
              path="/usuarios"
              element={
                <Guard permission="users:read">
                  <UsersPage />
                </Guard>
              }
            />
            <Route
              path="/alertas"
              element={
                <Guard permission="alerts:read">
                  <AlertsPage />
                </Guard>
              }
            />
            <Route
              path="/auditoria"
              element={
                <Guard permission="audit:read">
                  <AuditPage />
                </Guard>
              }
            />
            <Route path="*" element={<Navigate to="/bandeja" replace />} />
          </Routes>
        </main>
      </section>
    </>
  );
}

/**
 * Oculta lo que el rol no permite.
 *
 * Es comodidad para el usuario, no seguridad: la autorizacion real la aplica
 * el servidor en cada ruta. Una pantalla escondida no protege nada por si sola.
 */
function Guard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <Navigate to="/bandeja" replace />;
  return <>{children}</>;
}

/** Consulta compartida por el menu lateral y la campana de la barra. */
function useOpenAlerts() {
  const { can } = useAuth();

  return useQuery({
    queryKey: ['alerts', 'open'],
    queryFn: () => apiFetch<{ items: Alert[]; pagination: Pagination }>('/alerts?status=OPEN'),
    enabled: can('alerts:read'),
    refetchInterval: 120_000,
  });
}

const NAV_LINKS: Array<{ to: string; label: string; icon: string; permission?: Permission }> = [
  { to: '/bandeja', label: 'Bandeja', icon: 'bxs-inbox' },
  { to: '/tablero', label: 'Tablero', icon: 'bxs-dashboard', permission: 'analytics:read' },
  { to: '/plantillas', label: 'Plantillas', icon: 'bxs-graduation', permission: 'templates:read' },
  { to: '/alertas', label: 'Alertas', icon: 'bxs-bell-ring', permission: 'alerts:read' },
  { to: '/cuentas', label: 'Cuentas', icon: 'bxs-share-alt', permission: 'accounts:read' },
  { to: '/usuarios', label: 'Usuarios', icon: 'bxs-group', permission: 'users:read' },
  { to: '/auditoria', label: 'Auditoria', icon: 'bxs-shield-alt-2', permission: 'audit:read' },
];

function Sidebar() {
  const { can, logout } = useAuth();
  const alertsQuery = useOpenAlerts();
  const openAlerts = alertsQuery.data?.pagination.total ?? 0;

  return (
    <section id="sidebar">
      <NavLink to="/bandeja" className="brand">
        <img src="/logo-uniremington.svg" alt="Uniremington" className="brand__logo" />
        <span className="text">Bandeja</span>
      </NavLink>

      <ul className="side-menu top">
        {NAV_LINKS.filter((link) => !link.permission || can(link.permission)).map((link) => (
          <li key={link.to}>
            <NavLink to={link.to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <i className={`bx ${link.icon} bx-sm`} aria-hidden="true"></i>
              <span className="text">{link.label}</span>
              {link.to === '/alertas' && openAlerts > 0 ? (
                <span className="side-badge">{openAlerts}</span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>

      <ul className="side-menu bottom">
        <li>
          <a
            href="#salir"
            className="logout"
            onClick={(event) => {
              event.preventDefault();
              void logout();
            }}
          >
            <i className="bx bx-power-off bx-sm" aria-hidden="true"></i>
            <span className="text">Salir</span>
          </a>
        </li>
      </ul>
    </section>
  );
}

function Navbar() {
  const { user, logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const [term, setTerm] = useState('');
  const [openMenu, setOpenMenu] = useState<'none' | 'alerts' | 'profile'>('none');
  const navRef = useRef<HTMLElement>(null);

  const alertsQuery = useOpenAlerts();
  const alerts = alertsQuery.data?.items ?? [];
  const openAlerts = alertsQuery.data?.pagination.total ?? 0;

  // Cerrar los menus al hacer clic fuera o al presionar Escape.
  useEffect(() => {
    if (openMenu === 'none') return;

    function onPointerDown(event: MouseEvent) {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenu('none');
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu('none');
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  return (
    <nav ref={navRef}>
      <button
        type="button"
        className="menu-toggle"
        aria-label="Contraer o expandir el menu"
        onClick={() => document.getElementById('sidebar')?.classList.toggle('hide')}
      >
        <i className="bx bx-menu bx-sm" aria-hidden="true"></i>
      </button>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          navigate(`/bandeja?buscar=${encodeURIComponent(term.trim())}`);
        }}
      >
        <div className="form-input">
          <label className="sr-only" htmlFor="nav-search">
            Buscar en los comentarios
          </label>
          <input
            id="nav-search"
            type="search"
            placeholder="Buscar en los comentarios..."
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <button type="submit" className="search-btn" aria-label="Buscar">
            <i className="bx bx-search" aria-hidden="true"></i>
          </button>
        </div>
      </form>

      <input
        type="checkbox"
        className="checkbox"
        id="switch-mode"
        hidden
        checked={theme === 'dark'}
        onChange={toggle}
      />
      <label className="swith-lm" htmlFor="switch-mode" title="Cambiar entre claro y oscuro">
        <span className="sr-only">Cambiar entre tema claro y oscuro</span>
        <i className="bx bxs-moon" aria-hidden="true"></i>
        <i className="bx bx-sun" aria-hidden="true"></i>
        <span className="ball"></span>
      </label>

      {can('alerts:read') ? (
        <>
          <button
            type="button"
            className="notification"
            aria-label={`Alertas abiertas: ${openAlerts}`}
            aria-expanded={openMenu === 'alerts'}
            onClick={() => setOpenMenu((current) => (current === 'alerts' ? 'none' : 'alerts'))}
          >
            <i className="bx bxs-bell" aria-hidden="true"></i>
            {openAlerts > 0 ? <span className="num">{openAlerts}</span> : null}
          </button>

          <div className={`notification-menu ${openMenu === 'alerts' ? 'show' : ''}`}>
            {alerts.length === 0 ? (
              <p className="menu-empty">Sin alertas abiertas.</p>
            ) : (
              <ul>
                {alerts.slice(0, 6).map((alert) => (
                  <li key={alert.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu('none');
                        navigate(alert.interactionId ? `/bandeja/${alert.interactionId}` : '/alertas');
                      }}
                    >
                      <span className={`dot dot--${alert.severity.toLowerCase()}`} aria-hidden="true"></span>
                      <span>
                        <strong>{alert.title}</strong>
                        <small>{timeAgo(alert.createdAt)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="profile"
        aria-label="Menu de la cuenta"
        aria-expanded={openMenu === 'profile'}
        onClick={() => setOpenMenu((current) => (current === 'profile' ? 'none' : 'profile'))}
      >
        <span className="avatar">{initials(user?.name ?? '')}</span>
      </button>

      <div className={`profile-menu ${openMenu === 'profile' ? 'show' : ''}`}>
        <div className="profile-menu__head">
          <strong>{user?.name}</strong>
          <small>{ROLE_LABEL[user?.role ?? 'VIEWER']}</small>
          <small className="muted">{user?.email}</small>
        </div>
        <ul>
          <li>
            <button type="button" onClick={() => void logout()}>
              <i className="bx bx-power-off" aria-hidden="true"></i> Cerrar sesion
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}

/** Iniciales para el avatar, sin depender de una imagen externa. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Agente',
  VIEWER: 'Observador',
};
