import { type ClientOptions, HttpClient, type RequestOptions, type WithResponse, sleep, withMeta } from './core';
import { SkrapError } from './errors';
import { AccountResource, Bulk, Enrich, Lists, Tasks, Webhooks, seg } from './resources';
import type {
  FindEmailParams,
  FindEmailResponse,
  FindRefinementResponse,
  VerifyEmailParams,
  VerifyEmailResponse,
} from './types';

export interface WaitForRefinementOptions {
  /** Delay between polls in ms (default 2000). */
  intervalMs?: number;
  /** Give up after this many ms (default 120000). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Skrap.ai API client.
 *
 * ```ts
 * import { Skrap } from 'skrap-ai';
 * const skrap = new Skrap(); // reads SKRAP_API_KEY
 * const result = await skrap.verifyEmail('jane@example.com');
 * ```
 */
export class Skrap {
  /** Enrichment: reverse email, person, company, company contacts. */
  readonly enrich: Enrich;
  /** Start bulk verify / find jobs. */
  readonly bulk: Bulk;
  /** Bulk job status, results, download, pause / resume / cancel. */
  readonly tasks: Tasks;
  /** Lists of prospects and companies. */
  readonly lists: Lists;
  /** The key's owner and credit balance. */
  readonly account: AccountResource;
  /** Webhook subscriptions and signature checks. */
  readonly webhooks: Webhooks;

  readonly #http: HttpClient;

  constructor(options: ClientOptions = {}) {
    this.#http = new HttpClient(options);
    this.enrich = new Enrich(this.#http);
    this.bulk = new Bulk(this.#http);
    this.tasks = new Tasks(this.#http);
    this.lists = new Lists(this.#http);
    this.account = new AccountResource(this.#http);
    this.webhooks = new Webhooks(this.#http);
  }

  /** API origin in use, e.g. https://api.skrap.ai. */
  get baseUrl(): string {
    return this.#http.baseUrl;
  }

  /**
   * Verify one email address against its mail server.
   * Charged (1 credit) only when the result is valid or risky.
   */
  async verifyEmail(params: VerifyEmailParams | string, opts?: RequestOptions): Promise<WithResponse<VerifyEmailResponse>> {
    const body = typeof params === 'string' ? { email: params } : params;
    if (!body || typeof body.email !== 'string' || !body.email.trim()) {
      throw new SkrapError('email is required', { code: 'VALIDATION_ERROR' });
    }
    const r = await this.#http.request({ method: 'POST', path: '/api/v2/verify-email', body, idempotent: true }, opts);
    return withMeta(r.data as VerifyEmailResponse, r.meta);
  }

  /**
   * Find and verify the work email of a person at a company. Give a domain when you have one
   * (best results) or a company name. Charged (1 credit) only when a valid or risky email is found.
   *
   * When `pendingRefinement` is true the answer is not final (and not charged yet): call
   * `waitForFindRefinement(result.requestId)`.
   */
  async findEmail(params: FindEmailParams, opts?: RequestOptions): Promise<WithResponse<FindEmailResponse>> {
    const r = await this.#http.request({ method: 'POST', path: '/api/v2/find-email', body: params, idempotent: true }, opts);
    return withMeta(r.data as FindEmailResponse, r.meta);
  }

  /** Current state of a find that returned `pendingRefinement: true`. */
  async getFindRefinement(requestId: string, opts?: RequestOptions): Promise<WithResponse<FindRefinementResponse>> {
    const r = await this.#http.request(
      { method: 'GET', path: `/api/v1/find-email/refinement/${seg(requestId, 'requestId')}`, idempotent: true },
      opts,
    );
    return withMeta(r.data as FindRefinementResponse, r.meta);
  }

  /** Poll `getFindRefinement` until the answer is ready. */
  async waitForFindRefinement(requestId: string, options: WaitForRefinementOptions = {}): Promise<WithResponse<FindRefinementResponse>> {
    const interval = options.intervalMs ?? 2000;
    const timeout = options.timeoutMs ?? 120_000;
    const deadline = Date.now() + timeout;
    for (;;) {
      const r = await this.getFindRefinement(requestId, { signal: options.signal });
      if (r.ready) return r;
      if (Date.now() + interval > deadline) {
        throw new SkrapError(`Find ${requestId} still pending after ${timeout} ms`, { code: 'WAIT_TIMEOUT', retryable: true, body: r });
      }
      await sleep(interval, options.signal);
    }
  }

  /** Never print the API key. */
  toJSON(): Record<string, unknown> {
    return { baseUrl: this.baseUrl };
  }
}
