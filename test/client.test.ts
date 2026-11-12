import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_URL, Skrap, SkrapError, VERSION } from '../src';
import { client, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Skrap client', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('reads the API key from SKRAP_API_KEY', async () => {
    vi.stubEnv('SKRAP_API_KEY', 'sk_env_key');
    const m = mockFetch([{ body: { id: 'u' } }]);
    const skrap = new Skrap({ fetch: m.fetch });
    await skrap.account.get();
    expect(m.calls[0]!.headers['x-api-key']).toBe('sk_env_key');
  });

  it('prefers the apiKey option over the environment', async () => {
    vi.stubEnv('SKRAP_API_KEY', 'sk_env_key');
    const m = mockFetch([{ body: {} }]);
    const skrap = new Skrap({ apiKey: 'sk_option', fetch: m.fetch });
    await skrap.account.get();
    expect(m.calls[0]!.headers['x-api-key']).toBe('sk_option');
  });

  it('throws MISSING_API_KEY without a key', () => {
    vi.stubEnv('SKRAP_API_KEY', '');
    expect(() => new Skrap()).toThrow(SkrapError);
    try {
      new Skrap();
    } catch (e) {
      expect((e as SkrapError).code).toBe('MISSING_API_KEY');
    }
  });

  it('defaults to https://api.skrap.ai, honours SKRAP_BASE_URL and strips trailing slashes', async () => {
    vi.stubEnv('SKRAP_BASE_URL', '');
    expect(new Skrap({ apiKey: 'k' }).baseUrl).toBe(DEFAULT_BASE_URL);
    vi.stubEnv('SKRAP_BASE_URL', 'http://localhost:5000/');
    expect(new Skrap({ apiKey: 'k' }).baseUrl).toBe('http://localhost:5000');
    expect(new Skrap({ apiKey: 'k', baseUrl: 'https://x.test///' }).baseUrl).toBe('https://x.test');
  });

  it('sends the key, user-agent, accept and content-type headers', async () => {
    const { skrap, calls } = client([{ body: {} }, { body: {} }]);
    await skrap.verifyEmail('a@b.co');
    await skrap.account.get();
    const post = calls[0]!.headers;
    expect(post['x-api-key']).toBe('sk_test_123');
    expect(post['user-agent']).toBe(`skrap-node/${VERSION}`);
    expect(post['accept']).toBe('application/json');
    expect(post['content-type']).toBe('application/json');
    expect(calls[1]!.headers['content-type']).toBeUndefined();
  });

  it('merges default and per-request headers but never lets them replace the key', async () => {
    const { skrap, calls } = client([{ body: {} }], { defaultHeaders: { 'x-trace': 'a', 'x-api-key': 'nope' } });
    await skrap.account.get({ headers: { 'x-extra': 'b' } });
    expect(calls[0]!.headers['x-trace']).toBe('a');
    expect(calls[0]!.headers['x-extra']).toBe('b');
    expect(calls[0]!.headers['x-api-key']).toBe('sk_test_123');
  });

  it('never exposes the API key through JSON.stringify or util.inspect', () => {
    const skrap = new Skrap({ apiKey: 'sk_live_supersecret', fetch: mockFetch([]).fetch });
    expect(JSON.stringify(skrap)).not.toContain('supersecret');
    expect(inspect(skrap, { depth: 10, showHidden: true })).not.toContain('supersecret');
  });

  it('does not put the API key in error messages', async () => {
    const { skrap } = client([{ status: 401, body: { error: 'Invalid API key', code: 'INVALID_API_KEY' } }]);
    const err = (await skrap.account.get().catch((e: unknown) => e)) as SkrapError;
    expect(err.message).not.toContain('sk_test_123');
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain('sk_test_123');
  });
});
