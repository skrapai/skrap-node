/**
 * Live smoke test against the real API. Skipped unless SKRAP_API_KEY is set, and not part of
 * `npm test` (run it with `npm run test:smoke`). Makes 3 calls, at most 1 credit:
 *   1. account.get()                          free
 *   2. verifyEmail(SKRAP_SMOKE_EMAIL)          1 credit if valid or risky, else free
 *   3. getFindRefinement(<unknown id>) -> 404  free (checks error parsing)
 */
import { describe, expect, it } from 'vitest';
import { NotFoundError, Skrap } from '../src';

const key = process.env.SKRAP_API_KEY;
const email = process.env.SKRAP_SMOKE_EMAIL || 'support@github.com';

describe.skipIf(!key)('live API smoke test', () => {
  const skrap = new Skrap({ maxRetries: 1 });

  it('account.get returns the key owner and balance', async () => {
    const a = await skrap.account.get();
    expect(typeof a.email).toBe('string');
    expect(typeof a.credits).toBe('number');
    expect(a.lastResponse.status).toBe(200);
  });

  it('verifyEmail returns a status', async () => {
    const r = await skrap.verifyEmail(email);
    expect(['valid', 'risky', 'invalid', 'unknown']).toContain(r.status);
    expect(r.email).toBe(email.toLowerCase());
    expect(typeof r.retryable).toBe('boolean');
  }, 120_000);

  it('an unknown refinement id is a typed 404', async () => {
    const err = await skrap.getFindRefinement('req_sdk_smoke_does_not_exist').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('NOT_FOUND');
  });
});
