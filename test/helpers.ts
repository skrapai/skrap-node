import { vi } from 'vitest';
import { Skrap } from '../src';
import type { ClientOptions } from '../src';

export interface ReplySpec {
  status?: number;
  /** JSON body (serialized with content-type application/json). */
  body?: unknown;
  /** Raw text body (sent with content-type from headers, default text/plain). */
  text?: string;
  headers?: Record<string, string>;
}

export type Reply = ReplySpec | Error | ((url: string, init: RequestInit) => Promise<Response>);

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  at: number;
  init: RequestInit;
}

export function toResponse(r: ReplySpec): Response {
  const status = r.status ?? 200;
  if (r.text !== undefined) {
    return new Response(r.text, { status, headers: { 'content-type': 'text/plain', ...(r.headers ?? {}) } });
  }
  return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(r.headers ?? {}) },
  });
}

export function mockFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({
      url,
      method: String(init.method),
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      at: Date.now(),
      init,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error(`Unexpected request: ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return toResponse(next);
  });
  return { fetch, calls, remaining: () => queue.length };
}

export const BASE = 'https://api.test.skrap.ai';

export function client(replies: Reply[], opts: ClientOptions = {}) {
  const m = mockFetch(replies);
  const skrap = new Skrap({ apiKey: 'sk_test_123', baseUrl: BASE, fetch: m.fetch, ...opts });
  return { skrap, ...m };
}

/** Run a promise to completion under fake timers, returning its value or error. */
export async function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const out = p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return out;
}
