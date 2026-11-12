import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIConnectionError, APITimeoutError, SkrapError } from '../src';
import { client, settle } from './helpers';

/** A fetch reply that never answers until its signal aborts. */
function hang() {
  return (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
}

describe('timeouts and cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws APITimeoutError after timeoutMs (non-idempotent: no retry)', async () => {
    const { skrap, calls } = client([hang()], { timeoutMs: 1000 });
    const r = await settle(skrap.enrich.company({ domain: 'example.com' }));
    expect(calls).toHaveLength(1);
    expect(r.error).toBeInstanceOf(APITimeoutError);
    expect(r.error).toBeInstanceOf(APIConnectionError);
    expect((r.error as SkrapError).code).toBe('TIMEOUT');
    expect((r.error as SkrapError).status).toBeNull();
  });

  it('retries a timed-out idempotent call', async () => {
    const { skrap, calls } = client([hang(), { body: { email: 'a@b.co', status: 'valid' } }], { timeoutMs: 1000 });
    const r = await settle(skrap.verifyEmail('a@b.co'));
    expect(r.error).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('per-request timeoutMs overrides the client', async () => {
    const { skrap, calls } = client([hang()], { timeoutMs: 60_000, maxRetries: 0 });
    const p = settle(skrap.account.get({ timeoutMs: 500 }));
    const r = await p;
    expect(r.error).toBeInstanceOf(APITimeoutError);
    expect((r.error as Error).message).toContain('500 ms');
    expect(calls).toHaveLength(1);
  });

  it('an AbortSignal cancels an in-flight request with an AbortError (no retry)', async () => {
    const controller = new AbortController();
    const { skrap, calls } = client([hang()]);
    const p = skrap.verifyEmail('a@b.co', { signal: controller.signal }).then(
      () => ({ error: undefined as unknown }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const r = await p;
    expect(calls).toHaveLength(1);
    expect((r.error as Error).name).toBe('AbortError');
    expect(r.error).not.toBeInstanceOf(SkrapError);
  });

  it('an already-aborted signal sends nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const { skrap, calls } = client([]);
    const r = await settle(skrap.account.get({ signal: controller.signal }));
    expect(calls).toHaveLength(0);
    expect((r.error as Error).name).toBe('AbortError');
  });

  it('passes an AbortSignal to fetch', async () => {
    const { skrap, calls } = client([{ body: {} }]);
    await settle(skrap.account.get());
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});
