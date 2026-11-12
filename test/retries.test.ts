import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkrapError } from '../src';
import { APIConnectionError, RateLimitError, ServerError } from '../src';
import { backoffDelayMs, parseRateLimit, parseRetryAfter, retryDelayMs, shouldRetry } from '../src/core';
import { client, settle } from './helpers';

const ok = { body: { email: 'a@b.co', status: 'valid' } };

describe('retry helpers', () => {
  it('parseRetryAfter reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter('1.5')).toBe(1.5);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10);
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0);
  });

  it('parseRateLimit reads draft-7 and split headers', () => {
    expect(parseRateLimit(new Headers({ ratelimit: 'limit=30, remaining=0, reset=12' }))).toEqual({ limit: 30, remaining: 0, reset: 12 });
    expect(parseRateLimit(new Headers({ 'ratelimit-limit': '120', 'ratelimit-remaining': '5', 'ratelimit-reset': '9' }))).toEqual({ limit: 120, remaining: 5, reset: 9 });
    expect(parseRateLimit(new Headers({ 'x-ratelimit-limit': '600' }))).toEqual({ limit: 600, remaining: null, reset: null });
    expect(parseRateLimit(new Headers())).toBeNull();
  });

  it('backoff grows exponentially with jitter and is capped at 8 s', () => {
    expect(backoffDelayMs(0, () => 0)).toBe(250);
    expect(backoffDelayMs(0, () => 1)).toBe(500);
    expect(backoffDelayMs(1, () => 0)).toBe(500);
    expect(backoffDelayMs(2, () => 1)).toBe(2000);
    expect(backoffDelayMs(10, () => 1)).toBe(8000);
    expect(backoffDelayMs(10, () => 0)).toBe(4000);
  });

  it('retryDelayMs honours Retry-After', () => {
    expect(retryDelayMs(0, 3, () => 0)).toBe(3000);
    expect(retryDelayMs(0, 3, () => 1)).toBe(3250);
    expect(retryDelayMs(1, null, () => 0)).toBe(500);
  });

  it('shouldRetry policy', () => {
    const base = { idempotent: false, retryAfter: null, maxRetryDelayMs: 60_000 };
    expect(shouldRetry({ ...base, status: 429 })).toBe(true);
    expect(shouldRetry({ ...base, status: 500 })).toBe(true);
    expect(shouldRetry({ ...base, status: 503 })).toBe(true);
    expect(shouldRetry({ ...base, status: 502 })).toBe(false);
    expect(shouldRetry({ ...base, status: 504 })).toBe(false);
    expect(shouldRetry({ ...base, status: 502, idempotent: true })).toBe(true);
    expect(shouldRetry({ ...base, status: undefined })).toBe(false);
    expect(shouldRetry({ ...base, status: undefined, idempotent: true })).toBe(true);
    expect(shouldRetry({ ...base, status: 400 })).toBe(false);
    expect(shouldRetry({ ...base, status: 402 })).toBe(false);
    expect(shouldRetry({ ...base, status: 429, retryAfter: 3600 })).toBe(false);
    expect(shouldRetry({ ...base, status: 503, bodyRetryable: false })).toBe(false);
  });
});

describe('automatic retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a 429 after Retry-After seconds', async () => {
    const { skrap, calls } = client([
      { status: 429, body: { error: 'limit', code: 'RATE_LIMITED', retryAfterSec: 2 }, headers: { 'retry-after': '2' } },
      ok,
    ]);
    const r = await settle(skrap.verifyEmail('a@b.co'));
    expect(r.error).toBeUndefined();
    expect(calls).toHaveLength(2);
    const gap = calls[1]!.at - calls[0]!.at;
    expect(gap).toBeGreaterThanOrEqual(2000);
    expect(gap).toBeLessThanOrEqual(2250);
  });

  it('retries 500 and 503 with backoff, then succeeds', async () => {
    const { skrap, calls } = client([{ status: 500, body: { error: 'x', code: 'INTERNAL_ERROR' } }, { status: 503, body: { error: 'busy' } }, ok]);
    const r = await settle(skrap.bulk.verify({ emails: ['a@b.co'] }));
    expect(r.error).toBeUndefined();
    expect(calls).toHaveLength(3);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(250);
    expect(calls[1]!.at - calls[0]!.at).toBeLessThanOrEqual(500);
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(500);
    expect(calls[2]!.at - calls[1]!.at).toBeLessThanOrEqual(1000);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const { skrap, calls } = client(
      [
        { status: 503, body: { error: 'one' } },
        { status: 503, body: { error: 'two' } },
        { status: 503, body: { error: 'three' } },
      ],
      { maxRetries: 2 },
    );
    const r = await settle(skrap.account.get());
    expect(calls).toHaveLength(3);
    expect(r.error).toBeInstanceOf(ServerError);
    expect((r.error as SkrapError).message).toBe('three');
  });

  it('maxRetries: 0 disables retries (client and per request)', async () => {
    const a = client([{ status: 503, body: {} }], { maxRetries: 0 });
    expect((await settle(a.skrap.account.get())).error).toBeInstanceOf(ServerError);
    expect(a.calls).toHaveLength(1);
    const b = client([{ status: 503, body: {} }]);
    expect((await settle(b.skrap.account.get({ maxRetries: 0 }))).error).toBeInstanceOf(ServerError);
    expect(b.calls).toHaveLength(1);
  });

  it('does not wait for a Retry-After longer than maxRetryDelayMs', async () => {
    const { skrap, calls } = client([
      { status: 429, body: { error: 'Daily enrichment limit reached', code: 'ENRICH_DAILY_LIMIT', retryable: true }, headers: { 'retry-after': '3600' } },
    ]);
    const r = await settle(skrap.enrich.company({ domain: 'example.com' }));
    expect(calls).toHaveLength(1);
    expect(r.error).toBeInstanceOf(RateLimitError);
    expect((r.error as SkrapError).code).toBe('ENRICH_DAILY_LIMIT');
    expect((r.error as SkrapError).retryAfter).toBe(3600);
    expect((r.error as SkrapError).retryable).toBe(true);
  });

  it('does not retry 4xx errors other than 429', async () => {
    const { skrap, calls } = client([{ status: 402, body: { error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' } }]);
    await settle(skrap.verifyEmail('a@b.co'));
    expect(calls).toHaveLength(1);
  });

  it('retries network errors for idempotent calls (verify, GET)', async () => {
    const { skrap, calls } = client([new TypeError('fetch failed'), ok]);
    const r = await settle(skrap.verifyEmail('a@b.co'));
    expect(r.error).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('does not retry network errors for calls that could run twice (bulk, enrich)', async () => {
    const { skrap, calls } = client([new TypeError('fetch failed')]);
    const r = await settle(skrap.bulk.find({ data: [{ firstName: 'Jane', domain: 'example.com' }] }));
    expect(calls).toHaveLength(1);
    expect(r.error).toBeInstanceOf(APIConnectionError);
    expect((r.error as SkrapError).retryable).toBe(true);
  });

  it('retries 502/504 only for idempotent calls', async () => {
    const a = client([{ status: 504, text: 'gateway timeout' }, { body: { ok: 1 } }]);
    expect((await settle(a.skrap.tasks.get('t1'))).error).toBeUndefined();
    expect(a.calls).toHaveLength(2);
    const b = client([{ status: 502, text: 'bad gateway' }]);
    expect((await settle(b.skrap.enrich.person({ linkedinUrl: 'https://www.linkedin.com/in/x' }))).error).toBeInstanceOf(ServerError);
    expect(b.calls).toHaveLength(1);
  });

  it('honours the body retryable: false flag', async () => {
    const { skrap, calls } = client([{ status: 503, body: { error: 'no', code: 'X', retryable: false } }]);
    await settle(skrap.account.get());
    expect(calls).toHaveLength(1);
  });

  it('an abort during the backoff stops retrying', async () => {
    const controller = new AbortController();
    const { skrap, calls } = client([{ status: 503, body: {}, headers: { 'retry-after': '10' } }, ok]);
    const p = skrap.account.get({ signal: controller.signal }).then(
      () => ({ error: undefined as unknown }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    const r = await p;
    expect(calls).toHaveLength(1);
    expect((r.error as Error).name).toBe('AbortError');
  });
});
