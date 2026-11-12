import {
  APIConnectionError,
  APITimeoutError,
  SkrapError,
  errorClassFor,
} from './errors';
import { VERSION } from './version';

export const DEFAULT_BASE_URL = 'https://api.skrap.ai';
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Your API key. Defaults to the SKRAP_API_KEY environment variable. */
  apiKey?: string;
  /** API origin. Defaults to SKRAP_BASE_URL, then https://api.skrap.ai. */
  baseUrl?: string;
  /** Per-attempt timeout in ms (default 120000). Verify and find can take up to about a minute. */
  timeoutMs?: number;
  /** Retries after the first attempt (default 2). 0 turns retries off. */
  maxRetries?: number;
  /**
   * Longest wait before a retry, in ms (default 60000). When the API asks to wait longer
   * (Retry-After), the SDK does not wait: it throws, with `error.retryAfter` set.
   */
  maxRetryDelayMs?: number;
  /** Custom fetch implementation (defaults to the global fetch). */
  fetch?: FetchLike;
  /** Extra headers sent with every request. */
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  /** Cancels the request (and any pending retry). */
  signal?: AbortSignal;
  /** Override the client's per-attempt timeout. */
  timeoutMs?: number;
  /** Override the client's retry count. */
  maxRetries?: number;
  /** Extra headers for this request. */
  headers?: Record<string, string>;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** Seconds until the window resets. */
  reset: number | null;
}

/** HTTP details of a successful call, available as `result.lastResponse`. */
export interface ResponseMeta {
  status: number;
  /** x-request-id header, else the `requestId` field of the body, else null. */
  requestId: string | null;
  headers: Headers;
  rateLimit: RateLimitInfo | null;
}

/** A response object with its HTTP details attached (non-enumerable, so JSON.stringify skips it). */
export type WithResponse<T> = T & { readonly lastResponse: ResponseMeta };

export interface RequestSpec {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /**
   * true: sending the request twice has no extra effect (reads, verify and find, which are free
   * repeats). Only these are retried after an unknown outcome (network error, timeout, 502, 504).
   * Every request is retried on 429, 500 and 503, where the API did no work and charged nothing.
   */
  idempotent: boolean;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON when the response is JSON, else the body text. */
  data: unknown;
  meta: ResponseMeta;
}

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

/** Seconds from a Retry-After header (delta-seconds or HTTP date). */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const date = Date.parse(v);
  if (Number.isNaN(date)) return null;
  return Math.max(0, (date - now) / 1000);
}

/** Rate-limit headers: IETF draft-7 `RateLimit: limit=.., remaining=.., reset=..` or split headers. */
export function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const num = (v: string | null | undefined): number | null => {
    if (v == null || v.trim() === '') return null;
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  };
  const combined = headers.get('ratelimit');
  if (combined) {
    const parts: Record<string, string> = {};
    for (const p of combined.split(/[,;]/)) {
      const [k, val] = p.split('=');
      if (k && val !== undefined) parts[k.trim().toLowerCase()] = val.trim();
    }
    const info = { limit: num(parts.limit), remaining: num(parts.remaining), reset: num(parts.reset) };
    if (info.limit !== null || info.remaining !== null || info.reset !== null) return info;
  }
  const limit = num(headers.get('ratelimit-limit') ?? headers.get('x-ratelimit-limit'));
  const remaining = num(headers.get('ratelimit-remaining') ?? headers.get('x-ratelimit-remaining'));
  const reset = num(headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset'));
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, reset };
}

/** Exponential backoff with jitter: attempt 0 waits 250-500 ms, then 500-1000 ms, ... up to 8 s. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** attempt);
  return Math.round(base / 2 + random() * (base / 2));
}

export interface RetryInput {
  /** HTTP status, or undefined for a network error / timeout. */
  status?: number;
  idempotent: boolean;
  /** Seconds the API asked to wait, when it did. */
  retryAfter: number | null;
  /** The body's `retryable` flag, when present. */
  bodyRetryable?: boolean;
  maxRetryDelayMs: number;
}

/** Should this outcome be retried (attempts left are checked by the caller)? */
export function shouldRetry(i: RetryInput): boolean {
  if (i.retryAfter !== null && i.retryAfter * 1000 > i.maxRetryDelayMs) return false;
  if (i.bodyRetryable === false) return false;
  if (i.status === undefined) return i.idempotent;
  if (i.status === 429 || i.status === 500 || i.status === 503) return true;
  if (i.status === 408 || i.status === 502 || i.status === 504) return i.idempotent;
  return false;
}

/** Delay before the next attempt: the API's Retry-After (plus a little jitter) or backoff. */
export function retryDelayMs(attempt: number, retryAfter: number | null, random: () => number = Math.random): number {
  if (retryAfter !== null) return Math.round(retryAfter * 1000 + random() * 250);
  return backoffDelayMs(attempt, random);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Build the SkrapError for an HTTP error response. */
export function errorFromResponse(status: number, headers: Headers, data: unknown): SkrapError {
  const body = isObject(data) ? data : null;
  const code = body && typeof body.code === 'string' ? body.code : null;
  const fromBody = body && typeof body.retryAfterSec === 'number' ? body.retryAfterSec : null;
  const retryAfter = parseRetryAfter(headers.get('retry-after')) ?? fromBody;
  const message =
    (body && typeof body.error === 'string' && body.error) ||
    (body && typeof body.message === 'string' && body.message) ||
    (typeof data === 'string' && data.trim() ? data.trim().slice(0, 300) : '') ||
    `Request failed with status ${status}`;
  const requestId =
    headers.get('x-request-id') ?? (body && typeof body.requestId === 'string' ? body.requestId : null);
  const retryable =
    body && typeof body.retryable === 'boolean' ? body.retryable : status === 429 || status >= 500;
  const Cls = errorClassFor(status);
  return new Cls(message, {
    status,
    code,
    requestId,
    retryable,
    retryAfter,
    details: body ? body.details : undefined,
    body: data,
    headers,
  });
}

function buildUrl(baseUrl: string, path: string, query?: RequestSpec['query']): string {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

/** Sleep that ends early (rejecting) when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function readEnv(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const v = g.process?.env?.[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Attach HTTP details to a result as a non-enumerable `lastResponse` property. */
export function withMeta<T>(value: T, meta: ResponseMeta): WithResponse<T> {
  if (isObject(value) || Array.isArray(value)) {
    Object.defineProperty(value, 'lastResponse', { value: meta, enumerable: false, configurable: true });
  }
  return value as WithResponse<T>;
}

/* ------------------------------------------------------------------ transport */

export class HttpClient {
  readonly #apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxRetryDelayMs: number;
  readonly #fetch: FetchLike;
  readonly #defaultHeaders: Record<string, string>;

  constructor(opts: ClientOptions = {}) {
    const apiKey = opts.apiKey ?? readEnv('SKRAP_API_KEY');
    if (!apiKey) {
      throw new SkrapError(
        'No API key. Pass { apiKey } to new Skrap() or set the SKRAP_API_KEY environment variable.',
        { code: 'MISSING_API_KEY' },
      );
    }
    this.#apiKey = apiKey;
    this.baseUrl = (opts.baseUrl ?? readEnv('SKRAP_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? DEFAULT_MAX_RETRIES));
    this.maxRetryDelayMs = opts.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (typeof f !== 'function') {
      throw new SkrapError('No fetch implementation found. Use Node.js 18+ or pass { fetch }.', {
        code: 'MISSING_FETCH',
      });
    }
    this.#fetch = f;
    this.#defaultHeaders = { ...(opts.defaultHeaders ?? {}) };
  }

  /** Never print the key (console.log, util.inspect, JSON.stringify). */
  toJSON(): Record<string, unknown> {
    return { baseUrl: this.baseUrl, timeoutMs: this.timeoutMs, maxRetries: this.maxRetries };
  }

  async request(spec: RequestSpec, opts: RequestOptions = {}): Promise<RawResponse> {
    const maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? this.maxRetries));
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const url = buildUrl(this.baseUrl, spec.path, spec.query);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': `skrap-node/${VERSION}`,
      ...this.#defaultHeaders,
      ...(opts.headers ?? {}),
      'x-api-key': this.#apiKey,
    };
    let payload: string | undefined;
    if (spec.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(spec.body);
    }

    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw abortReason(opts.signal);
      let outcome: { kind: 'response'; res: RawResponse } | { kind: 'error'; error: SkrapError };
      try {
        outcome = { kind: 'response', res: await this.#attempt(url, spec.method, headers, payload, timeoutMs, opts.signal) };
      } catch (err) {
        if (opts.signal?.aborted) throw abortReason(opts.signal);
        if (err instanceof SkrapError) outcome = { kind: 'error', error: err };
        else throw err;
      }

      if (outcome.kind === 'response' && outcome.res.status < 400) return outcome.res;

      const error =
        outcome.kind === 'error'
          ? outcome.error
          : errorFromResponse(outcome.res.status, outcome.res.headers, outcome.res.data);
      const bodyRetryable =
        outcome.kind === 'response' && isObject(outcome.res.data) && typeof outcome.res.data.retryable === 'boolean'
          ? outcome.res.data.retryable
          : undefined;
      const retry =
        attempt < maxRetries &&
        shouldRetry({
          status: error.status ?? undefined,
          idempotent: spec.idempotent,
          retryAfter: error.retryAfter,
          bodyRetryable,
          maxRetryDelayMs: this.maxRetryDelayMs,
        });
      if (!retry) throw error;
      await sleep(retryDelayMs(attempt, error.retryAfter), opts.signal);
    }
  }

  async #attempt(
    url: string,
    method: string,
    headers: Record<string, string>,
    payload: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RawResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let res: Response;
      try {
        res = await this.#fetch(url, { method, headers, body: payload, signal: controller.signal });
      } catch (err) {
        throw this.#networkError(err, timedOut, timeoutMs, signal);
      }
      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        throw this.#networkError(err, timedOut, timeoutMs, signal);
      }
      const contentType = res.headers.get('content-type') ?? '';
      let data: unknown = text;
      if (contentType.includes('json') && text.trim()) {
        try {
          data = JSON.parse(text);
        } catch {
          if (res.status < 400) {
            throw new SkrapError('The API returned invalid JSON', {
              status: res.status,
              code: 'INVALID_RESPONSE',
              body: text,
              headers: res.headers,
            });
          }
        }
      }
      const requestId =
        res.headers.get('x-request-id') ??
        (isObject(data) && typeof data.requestId === 'string' ? data.requestId : null);
      return {
        status: res.status,
        headers: res.headers,
        data,
        meta: { status: res.status, requestId, headers: res.headers, rateLimit: parseRateLimit(res.headers) },
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  #networkError(err: unknown, timedOut: boolean, timeoutMs: number, signal?: AbortSignal): unknown {
    if (signal?.aborted) return abortReason(signal);
    if (timedOut) {
      return new APITimeoutError(`Request timed out after ${timeoutMs} ms`, {
        code: 'TIMEOUT',
        retryable: true,
        cause: err,
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new APIConnectionError(`Connection error: ${msg}`, { code: 'CONNECTION_ERROR', retryable: true, cause: err });
  }
}
