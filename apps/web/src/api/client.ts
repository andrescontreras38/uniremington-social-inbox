/**
 * Cliente HTTP.
 *
 * Dos decisiones que importan:
 *  - `credentials: 'same-origin'`: la sesion viaja en una cookie httpOnly que
 *    este codigo no puede leer. No hay token guardado en localStorage, asi que
 *    un XSS no puede robarlo.
 *  - Cada peticion que modifica algo repite en un encabezado el valor de la
 *    cookie CSRF. Un sitio de terceros puede provocar la peticion, pero no
 *    puede leer la cookie para copiar el valor.
 */

const CSRF_COOKIE = 'urem_csrf';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCsrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = readCsrfToken();

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> } | null)?.error;
    throw new ApiError(
      response.status,
      String(error?.code ?? 'ERROR'),
      String(error?.message ?? 'No se pudo completar la operacion'),
      error?.details,
      error?.requestId ? String(error.requestId) : undefined,
    );
  }

  return payload as T;
}

/** Construye una cadena de consulta omitiendo valores vacios. */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const result = search.toString();
  return result ? `?${result}` : '';
}
