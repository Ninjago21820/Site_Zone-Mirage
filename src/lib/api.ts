export class ApiError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(status: number, code: string, message: string, data?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function readCookie(name: string): string | null {
  const target = name;
  const alt = name.startsWith('__Host-') ? name.replace('__Host-', '') : `__Host-${name}`;
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === target || key === alt) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function csrfToken(): string | null {
  return readCookie('zm_csrf') ?? readCookie('__Host-zm_csrf');
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  raw?: boolean;
}

export async function api<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body ? 'POST' : 'GET');
  const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = csrfToken();
  if (token && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = token;
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const code = (data && typeof data === 'object' && (data.error || data.code)) || `http_${res.status}`;
    const message = (data && typeof data === 'object' && data.message) || 'Une erreur est survenue.';
    throw new ApiError(res.status, String(code), String(message), data);
  }
  return data as T;
}

export const apiGet = <T = any>(path: string) => api<T>(path);
export const apiPost = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const apiPatch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiPut = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const apiDelete = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
