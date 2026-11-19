/**
 * HTTP client for the API. Cookies are httpOnly, so every call sends credentials.
 *
 * Refresh tokens rotate with strict reuse detection: two refreshes sent with the
 * same cookie revoke the whole session. So refresh is single-flight:
 *  - in this tab: one shared in-flight promise;
 *  - across tabs: the Web Locks API serialises refreshes, and a tab that waited on
 *    the lock skips its own refresh when another tab refreshed meanwhile. Without
 *    Web Locks (insecure context) a localStorage lease plays the same role.
 * The original request is retried once; if the refresh is rejected (401/403) we go to /login.
 * A network failure during refresh keeps the session (NETWORK_ERROR is thrown instead).
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
const LEASE_KEY = 'thesis-auth:refreshLease';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('thesis-auth') : null;

let inFlight: Promise<boolean> | null = null;

const readRefreshedAt = (): number => {
  try {
    return Number(localStorage.getItem(REFRESHED_AT_KEY) ?? 0);
  } catch {
    return 0;
  }
};

/** true = refreshed; false = the server rejected the refresh token; throws on network/server failure. */
async function postRefresh(): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/auth/refresh'), { method: 'POST', credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
  }
  if (res.ok) {
    try {
      localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
    } catch {
      /* storage blocked: the lock still serialises refreshes */
    }
    return true;
  }
  if (res.status === 401 || res.status === 403) return false;
  throw await toError(res);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LEASE_TTL_MS = 10_000;
const LEASE_WAIT_MS = 8_000;
const OWNER_ID = Math.random().toString(36).slice(2);

const readLease = (): { owner: string; ts: number } | null => {
  try {
    return JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null');
  } catch {
    return null;
  }
};

/** Fallback for contexts without navigator.locks: a best-effort localStorage lease. */
async function withLease<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LEASE_WAIT_MS;
  try {
    while (Date.now() < deadline) {
      const lease = readLease();
      if (!lease || lease.owner === OWNER_ID || Date.now() - lease.ts > LEASE_TTL_MS) {
        localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: OWNER_ID, ts: Date.now() }));
        await sleep(40); // let a racing tab overwrite us, then confirm who won
        if (readLease()?.owner === OWNER_ID) break;
      }
      await sleep(100);
    }
  } catch {
    /* storage blocked: proceed unserialised */
  }
  try {
    return await fn();
  } finally {
    try {
      if (readLease()?.owner === OWNER_ID) localStorage.removeItem(LEASE_KEY);
    } catch {
      /* ignore */
    }
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
  const started = (locks ? locks.request(LOCK_NAME, run).then((v) => v) : withLease(run)).finally(() => {
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
  /** A 401 never triggers the session-lost handler (the caller decides what to do). */
  silent?: boolean;
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
    // A network failure during refresh rejects with NETWORK_ERROR: the session is kept.
    const ok = await refreshSession(sentAt);
    if (!ok) {
      if (!opts.silent) onSessionLost?.();
      throw await toError(res);
    }
    try {
      res = await send();
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
    }
    if (res.status === 401) {
      if (!opts.silent) onSessionLost?.();
      throw await toError(res);
    }
  }

  if (!res.ok) throw await toError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Downloads an authenticated file as an object URL (for the PDF viewer or a save).
 * `?as=url` makes the API answer `{ url }` (a 5-minute presigned Vercel Blob URL) for blob-stored
 * files instead of a 302: a credentialed fetch cannot follow a redirect to the Blob host
 * (it answers `Access-Control-Allow-Origin: *`), so the bytes are fetched from that URL without
 * cookies. GridFS files are streamed by the API as before, whatever the query.
 */
export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await request<Response>(path, { raw: true, query: { as: 'url' } });
  if (!res.headers.get('content-type')?.includes('application/json')) {
    return URL.createObjectURL(await res.blob());
  }
  const { url } = (await res.json()) as { url: string };
  let file: Response;
  try {
    file = await fetch(url, { credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'DOWNLOAD_FAILED', 'Download from storage failed');
  }
  if (!file.ok) throw new ApiError(file.status, 'DOWNLOAD_FAILED', 'Download from storage failed');
  return URL.createObjectURL(await file.blob());
}

export async function downloadFile(path: string, fileName: string): Promise<void> {
  const url = await fetchBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
