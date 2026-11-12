import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientCreditsError, SkrapError } from '../src';
import type { Task } from '../src';
import { client, settle } from './helpers';

const task = (status: string, processed: number) => ({
  body: { taskId: 't1', type: 'bulk-verify', status, progress: { total: 4, processed, percentage: processed * 25 } },
});

describe('polling helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tasks.wait polls until the job completes and reports progress', async () => {
    const { skrap, calls } = client([task('pending', 0), task('processing', 2), task('completed', 4)]);
    const seen: number[] = [];
    const r = await settle(skrap.tasks.wait('t1', { intervalMs: 1000, onProgress: (t: Task) => seen.push(t.progress.processed) }));
    expect((r.value as Task).status).toBe('completed');
    expect(calls).toHaveLength(3);
    expect(seen).toEqual([0, 2, 4]);
    expect(calls[1]!.at - calls[0]!.at).toBe(1000);
  });

  it.each(['failed', 'cancelled', 'paused'])('tasks.wait stops on %s', async (status) => {
    const { skrap } = client([task(status, 1)]);
    const r = await settle(skrap.tasks.wait('t1'));
    expect((r.value as Task).status).toBe(status);
  });

  it('tasks.wait throws WAIT_TIMEOUT', async () => {
    const { skrap } = client([task('processing', 1), task('processing', 1), task('processing', 1)]);
    const r = await settle(skrap.tasks.wait('t1', { intervalMs: 1000, timeoutMs: 2500 }));
    expect(r.error).toBeInstanceOf(SkrapError);
    expect((r.error as SkrapError).code).toBe('WAIT_TIMEOUT');
  });

  it('tasks.iterResults walks every page', async () => {
    const page = (offset: number, rows: number, total: number) => ({
      body: { taskId: 't1', status: 'completed', offset, limit: 2, total, statusCounts: {}, rows: Array.from({ length: rows }, (_, i) => ({ email: `e${offset + i}@x.com`, status: 'valid' })) },
    });
    const { skrap, calls } = client([page(0, 2, 5), page(2, 2, 5), page(4, 1, 5)]);
    const emails: string[] = [];
    for await (const row of skrap.tasks.iterResults('t1', { pageSize: 2 })) emails.push(row.email);
    expect(emails).toEqual(['e0@x.com', 'e1@x.com', 'e2@x.com', 'e3@x.com', 'e4@x.com']);
    expect(calls.map((c) => new URL(c.url).search)).toEqual(['?offset=0&limit=2', '?offset=2&limit=2', '?offset=4&limit=2']);
  });

  it('waitForFindRefinement polls until ready', async () => {
    const { skrap, calls } = client([{ body: { ready: false } }, { body: { ready: true, email: 'j@example.com', status: 'valid', domainStatus: 'valid', retryable: false } }]);
    const r = await settle(skrap.waitForFindRefinement('req_1', { intervalMs: 500 }));
    expect((r.value as { email: string }).email).toBe('j@example.com');
    expect(calls).toHaveLength(2);
  });

  it('waitForFindRefinement surfaces a withheld (402) answer', async () => {
    const { skrap } = client([{ status: 402, body: { ready: true, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' } }]);
    const r = await settle(skrap.waitForFindRefinement('req_1'));
    expect(r.error).toBeInstanceOf(InsufficientCreditsError);
  });

  it('waitForFindRefinement times out', async () => {
    const { skrap } = client([{ body: { ready: false } }, { body: { ready: false } }]);
    const r = await settle(skrap.waitForFindRefinement('req_1', { intervalMs: 1000, timeoutMs: 1500 }));
    expect((r.error as SkrapError).code).toBe('WAIT_TIMEOUT');
  });
});
