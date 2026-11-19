/**
 * HTTP client for the API. Cookies are httpOnly, so every call sends credentials.
 *
 * Refresh tokens rotate with strict reuse detection: two refreshes sent with the
 * same cookie revoke the whole session. So refresh is single-flight:
 *  - in this tab: one shared in-flight promise;
 *  - across tabs: the Web Locks API serialises refreshes, and a tab that waited on
 *    the lock skips its own refresh when another tab refreshed meanwhile.
 * The original request is retried once; if refresh fails we go to /login.
 */
import { ErrorCode } from '@thesis/shared';
import type { ApiErrorBody } from '~/types/api';
import { errorText } from './i18n';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  /** Spanish message for the UI. */
  get userMessage(): string {
    return errorText(this.code, this.message);
  }
}

let apiBase = 'http://localhost:3001/api';
let onSessionLost: (() => void) | null = null;

export function configureHttp(opts: { apiBase: string; onSessionLost: () => void }): void {
  apiBase = opts.apiBase.replace(/\/$/, '');
  onSessionLost = opts.onSessionLost;
}

export const apiUrl = (path: string): string => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;

const REFRESHED_AT_KEY = 'thesis-auth:refreshedAt';
const LOCK_NAME = 'thesis-auth-refresh';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('thesis-auth') : null;

let inFlight: Promise<boolean> | null = null;

const readRefreshedAt = (): number => {
  try {
    return Number(localStorage.getItem(REFRESHED_AT_KEY) ?? 0);
  } catch {
    return 0;
  }
};

async function postRefresh(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/auth/refresh'), { method: 'POST', credentials: 'include' });
    if (res.ok) {
      try {
        localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
      } catch {
        /* storage blocked: the lock still serialises refreshes */
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Single-flight refresh. `since` = when the failing request was sent. */
export function refreshSession(since = Date.now()): Promise<boolean> {
  if (inFlight) return inFlight;
  const run = async (): Promise<boolean> => {
    // Another tab refreshed after our request left: the cookie jar already has the new pair.
    if (readRefreshedAt() > since) return true;
    return postRefresh();
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const started = (locks ? locks.request(LOCK_NAME, run).then((v) => v) : run()).finally(() => {
    inFlight = null;
  });
  inFlight = started;
  return started;
}

export function broadcastLogout(): void {
  channel?.postMessage({ type: 'logout' });
}

export function onBroadcastLogout(cb: () => void): void {
  channel?.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
    if (e.data?.type === 'logout') cb();
  });
}

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/external/validate-token'];

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Return the raw Response (downloads). */
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = apiUrl(path);
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `${url}?${s}` : url;
}

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  return new ApiError(res.status, String(body.code ?? ErrorCode.HTTP_ERROR), body.message ?? res.statusText, body.details);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const send = () =>
    fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });

  let res: Response;
  const sentAt = Date.now();
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
  }

  if (res.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    const ok = await refreshSession(sentAt);
    if (!ok) {
      onSessionLost?.();
      throw await toError(res);
    }
    try {
      res = await send();
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
    }
    if (res.status === 401) {
      onSessionLost?.();
      throw await toError(res);
    }
  }

  if (!res.ok) throw await toError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Downloads an authenticated file as an object URL (for the PDF viewer or a save). */
export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await request<Response>(path, { raw: true });
  return URL.createObjectURL(await res.blob());
}

export async function downloadFile(path: string, fileName: string): Promise<void> {
  const url = await fetchBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
