import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ConflictError,
  InsufficientCreditsError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  SkrapError,
  ValidationError,
} from '../src';
import { client } from './helpers';

async function errorFor(status: number, body: unknown, headers: Record<string, string> = {}) {
  const { skrap } = client([{ status, body, headers }], { maxRetries: 0 });
  return (await skrap.account.get().catch((e: unknown) => e)) as SkrapError;
}

describe('typed errors', () => {
  it.each([
    [400, ValidationError, 'VALIDATION_ERROR'],
    [401, AuthenticationError, 'INVALID_API_KEY'],
    [402, InsufficientCreditsError, 'INSUFFICIENT_CREDITS'],
    [403, PermissionDeniedError, 'PLAN_REQUIRED'],
    [404, NotFoundError, 'NOT_FOUND'],
    [409, ConflictError, undefined],
    [429, RateLimitError, 'RATE_LIMITED'],
    [500, ServerError, 'INTERNAL_ERROR'],
    [410, SkrapError, 'RESULTS_EXPIRED'],
  ])('%i -> %s', async (status, Cls, code) => {
    const err = await errorFor(status, { error: 'boom', ...(code ? { code } : {}) });
    expect(err).toBeInstanceOf(Cls);
    expect(err).toBeInstanceOf(SkrapError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code ?? null);
    expect(err.message).toBe('boom');
    expect(err.name).toBe(Cls.name);
  });

  it('402 carries details { required, available }', async () => {
    const err = await errorFor(402, { error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', details: { required: 1, available: 0, shortfall: 1 } });
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.details).toEqual({ required: 1, available: 0, shortfall: 1 });
    expect(err.retryable).toBe(false);
  });

  it('plan-aware 429 exposes retryAfter and the plan info in body', async () => {
    const body = {
      error: 'Free plan limit reached: 30 API requests a minute per key. Try again in 12s, or upgrade to Professional for 120 a minute.',
      code: 'RATE_LIMITED',
      retryAfterSec: 12,
      plan: 'free',
      planName: 'Free',
      limitPerMinute: 30,
      upgrade: { plan: 'pro', planName: 'Professional', limitPerMinute: 120 },
    };
    const err = await errorFor(429, body, { 'retry-after': '12' });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(12);
    expect(err.retryable).toBe(true);
    expect((err.body as typeof body).upgrade.limitPerMinute).toBe(120);
  });

  it('uses retryAfterSec from the body when there is no Retry-After header', async () => {
    const err = await errorFor(429, { error: 'slow down', code: 'RATE_LIMITED', retryAfterSec: 7 });
    expect(err.retryAfter).toBe(7);
  });

  it('respects the body retryable flag', async () => {
    const err = await errorFor(402, { error: 'step limit', code: 'OVERAGE_LIMIT', retryable: true });
    expect(err.retryable).toBe(true);
  });

  it('takes the request id from x-request-id, else from the body', async () => {
    expect((await errorFor(500, { error: 'x' }, { 'x-request-id': 'rid_h' })).requestId).toBe('rid_h');
    expect((await errorFor(500, { error: 'x', requestId: 'req_b' })).requestId).toBe('req_b');
    expect((await errorFor(500, { error: 'x' })).requestId).toBeNull();
  });

  it('handles a non-JSON error body', async () => {
    const { skrap } = client([{ status: 502, text: '<html>Bad gateway</html>', headers: { 'content-type': 'text/html' } }], { maxRetries: 0 });
    const err = (await skrap.account.get().catch((e: unknown) => e)) as SkrapError;
    expect(err).toBeInstanceOf(ServerError);
    expect(err.status).toBe(502);
    expect(err.code).toBeNull();
    expect(err.message).toContain('Bad gateway');
  });

  it('handles an empty error body', async () => {
    const err = await errorFor(503, undefined);
    expect(err.message).toBe('Request failed with status 503');
    expect(err.retryable).toBe(true);
  });

  it('lists-style errors without a code', async () => {
    const err = await errorFor(409, { success: false, error: 'A list with this name already exists' });
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBeNull();
    expect(err.message).toBe('A list with this name already exists');
  });
});
