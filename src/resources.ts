import { type HttpClient, type RequestOptions, type WithResponse, sleep, withMeta } from './core';
import { SkrapError } from './errors';
import type {
  Account,
  AddLeadResponse,
  BulkFindParams,
  BulkJobCreated,
  BulkVerifyParams,
  CompanyContactsParams,
  CompanyContactsResponse,
  CreateListParams,
  CreateWebhookParams,
  CreatedList,
  CreatedWebhook,
  EnrichCompanyParams,
  EnrichCompanyResponse,
  EnrichPersonParams,
  EnrichPersonResponse,
  ExportListsParams,
  Lead,
  ListKind,
  ListsCsv,
  ListsResponse,
  ReverseEmailParams,
  ReverseEmailResponse,
  Task,
  TaskControlResponse,
  TaskCsv,
  TaskDownloadUrl,
  TaskResultRow,
  TaskResultsPage,
  TaskResultsParams,
  TransferLeadsParams,
  TransferLeadsResponse,
  WaitForTaskOptions,
  WebhookEvent,
  WebhookEventType,
  WebhookList,
} from './types';
import { type VerifyWebhookOptions, constructWebhookEvent, verifyWebhookSignature } from './webhooks';

/** Path segment, URL-encoded; refuses empty ids so a typo never hits a collection URL. */
export function seg(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SkrapError(`${name} is required`, { code: 'VALIDATION_ERROR' });
  }
  return encodeURIComponent(value.trim());
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ enrichment */

export class Enrich {
  constructor(private readonly http: HttpClient) {}

  /** Who is behind a work email: person, current company, career. 2 credits when found (+1 with includeCompany). */
  async reverseEmail(params: ReverseEmailParams, opts?: RequestOptions): Promise<WithResponse<ReverseEmailResponse>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v2/enrich/reverse-email', body: params, idempotent: false }, opts);
    return withMeta(r.data as ReverseEmailResponse, r.meta);
  }

  /** Profile from a LinkedIn URL, plus the current work email when on record. 1 credit (+1 with email). */
  async person(params: EnrichPersonParams, opts?: RequestOptions): Promise<WithResponse<EnrichPersonResponse>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v2/enrich/person', body: params, idempotent: false }, opts);
    return withMeta(r.data as EnrichPersonResponse, r.meta);
  }

  /** Company profile from a domain or LinkedIn company URL. 1 credit (+1 with includeBreakdown). */
  async company(params: EnrichCompanyParams, opts?: RequestOptions): Promise<WithResponse<EnrichCompanyResponse>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v2/enrich/company', body: params, idempotent: false }, opts);
    return withMeta(r.data as EnrichCompanyResponse, r.meta);
  }

  /** People at a company, filtered by seniority, department and country. 1 credit per person returned. */
  async companyContacts(params: CompanyContactsParams, opts?: RequestOptions): Promise<WithResponse<CompanyContactsResponse>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v2/enrich/company-contacts', body: params, idempotent: false }, opts);
    return withMeta(r.data as CompanyContactsResponse, r.meta);
  }
}

/* ------------------------------------------------------------------ bulk jobs */

export class Bulk {
  constructor(private readonly http: HttpClient) {}

  /** Start a bulk verification (up to 25,000 emails). Each row is charged once, when valid or risky. */
  async verify(params: BulkVerifyParams, opts?: RequestOptions): Promise<WithResponse<BulkJobCreated>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v1/bulk-verify', body: params, idempotent: false }, opts);
    return withMeta(r.data as BulkJobCreated, r.meta);
  }

  /** Start a bulk email find (up to 25,000 rows; each needs a first name and a domain or company). */
  async find(params: BulkFindParams, opts?: RequestOptions): Promise<WithResponse<BulkJobCreated>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v1/bulk-find', body: params, idempotent: false }, opts);
    return withMeta(r.data as BulkJobCreated, r.meta);
  }
}

const FINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'paused']);

export class Tasks {
  constructor(private readonly http: HttpClient) {}

  /** Status and progress of a bulk job. */
  async get(taskId: string, opts?: RequestOptions): Promise<WithResponse<Task>> {
    const r = await this.http.request({ method: 'GET', path: `/api/v1/tasks/${seg(taskId, 'taskId')}`, idempotent: true }, opts);
    return withMeta(r.data as Task, r.meta);
  }

  /** One page of result rows (50 by default). */
  async results(taskId: string, params: TaskResultsParams = {}, opts?: RequestOptions): Promise<WithResponse<TaskResultsPage>> {
    const r = await this.http.request(
      {
        method: 'GET',
        path: `/api/v1/tasks/${seg(taskId, 'taskId')}/results`,
        query: { offset: params.offset, limit: params.limit },
        idempotent: true,
      },
      opts,
    );
    return withMeta(r.data as TaskResultsPage, r.meta);
  }

  /** Every result row, fetched page by page. */
  async *iterResults(taskId: string, params: { pageSize?: number } = {}, opts?: RequestOptions): AsyncGenerator<TaskResultRow> {
    const limit = params.pageSize ?? 500;
    let offset = 0;
    for (;;) {
      const page = await this.results(taskId, { offset, limit }, opts);
      for (const row of page.rows) yield row;
      offset += page.rows.length;
      if (page.rows.length === 0 || offset >= page.total) return;
    }
  }

  /**
   * The results CSV. Throws a SkrapError with code TASK_PROCESSING (status 202) while the job has
   * no results yet, and RESULTS_EXPIRED (410) after the 30-day retention.
   */
  async download(taskId: string, opts?: RequestOptions): Promise<WithResponse<TaskCsv>> {
    const r = await this.http.request(
      { method: 'GET', path: `/api/v1/tasks/${seg(taskId, 'taskId')}/download`, query: { inline: 1 }, idempotent: true },
      opts,
    );
    if (isObject(r.data)) {
      const d = r.data;
      throw new SkrapError(typeof d.message === 'string' ? d.message : 'No results to download yet', {
        status: r.status,
        code: typeof d.code === 'string' ? d.code : 'TASK_PROCESSING',
        retryable: true,
        body: d,
        headers: r.headers,
      });
    }
    const csv = typeof r.data === 'string' ? r.data : '';
    return withMeta({ csv, filename: filenameFrom(r.headers.get('content-disposition')) }, r.meta);
  }

  /** A short-lived signed URL of the results CSV (when the job has a stored results file). */
  async downloadUrl(taskId: string, opts?: RequestOptions): Promise<WithResponse<TaskDownloadUrl>> {
    const r = await this.http.request({ method: 'GET', path: `/api/v1/tasks/${seg(taskId, 'taskId')}/download`, idempotent: true }, opts);
    if (!isObject(r.data) || typeof r.data.downloadUrl !== 'string') {
      const d = r.data;
      throw new SkrapError('No stored results file for this job yet; use tasks.download() for the CSV', {
        status: r.status,
        code: isObject(d) && typeof d.code === 'string' ? d.code : 'NO_DOWNLOAD_URL',
        retryable: r.status === 202,
        body: d,
        headers: r.headers,
      });
    }
    return withMeta(r.data as unknown as TaskDownloadUrl, r.meta);
  }

  /** Pause after the current batch. Rows already processed stay charged. */
  async pause(taskId: string, opts?: RequestOptions): Promise<WithResponse<TaskControlResponse>> {
    return this.control(taskId, 'pause', opts);
  }

  /** Resume a paused or stalled job. */
  async resume(taskId: string, opts?: RequestOptions): Promise<WithResponse<TaskControlResponse>> {
    return this.control(taskId, 'resume', opts);
  }

  /** Cancel a job. Rows already processed stay charged; nothing else is. */
  async cancel(taskId: string, opts?: RequestOptions): Promise<WithResponse<TaskControlResponse>> {
    return this.control(taskId, 'cancel', opts);
  }

  /**
   * Poll until the job stops: completed, failed, cancelled or paused (a paused job does not
   * move until resumed, e.g. after a top-up). Returns the last status.
   */
  async wait(taskId: string, options: WaitForTaskOptions = {}): Promise<WithResponse<Task>> {
    const interval = options.intervalMs ?? 5000;
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : null;
    for (;;) {
      const task = await this.get(taskId, { signal: options.signal });
      options.onProgress?.(task);
      if (FINAL_TASK_STATUSES.has(task.status)) return task;
      if (deadline !== null && Date.now() + interval > deadline) {
        throw new SkrapError(`Task ${taskId} still ${task.status} after ${options.timeoutMs} ms`, {
          code: 'WAIT_TIMEOUT',
          retryable: true,
          body: task,
        });
      }
      await sleep(interval, options.signal);
    }
  }

  private async control(taskId: string, action: 'pause' | 'resume' | 'cancel', opts?: RequestOptions): Promise<WithResponse<TaskControlResponse>> {
    const r = await this.http.request(
      { method: 'POST', path: `/api/v1/tasks/${seg(taskId, 'taskId')}/${action}`, idempotent: false },
      opts,
    );
    return withMeta(r.data as TaskControlResponse, r.meta);
  }
}

/* ------------------------------------------------------------------ lists */

export class Lists {
  constructor(private readonly http: HttpClient) {}

  /** Your lists: names, kinds and lead counts. */
  async list(params: { kind?: ListKind } = {}, opts?: RequestOptions): Promise<WithResponse<ListsResponse>> {
    const r = await this.http.request({ method: 'GET', path: '/api/v1/lists', query: { kind: params.kind }, idempotent: true }, opts);
    return withMeta(r.data as ListsResponse, r.meta);
  }

  /** Create a list (kind prospect = people, or company). 409 when the name exists. */
  async create(params: CreateListParams, opts?: RequestOptions): Promise<WithResponse<CreatedList>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v1/lists', body: params, idempotent: false }, opts);
    return withMeta(r.data as CreatedList, r.meta);
  }

  /** Add a lead (id, name and company required; email required on prospect lists). 409 on duplicates. */
  async addLead(listId: string, lead: Lead, opts?: RequestOptions): Promise<WithResponse<AddLeadResponse>> {
    const r = await this.http.request(
      { method: 'POST', path: `/api/v1/lists/${seg(listId, 'listId')}/leads`, body: lead, idempotent: false },
      opts,
    );
    return withMeta(r.data as AddLeadResponse, r.meta);
  }

  /** Copy or move leads to another list of the same kind; leads already there are skipped. */
  async transferLeads(listId: string, params: TransferLeadsParams, opts?: RequestOptions): Promise<WithResponse<TransferLeadsResponse>> {
    const r = await this.http.request(
      { method: 'POST', path: `/api/v1/lists/${seg(listId, 'listId')}/leads/transfer`, body: params, idempotent: false },
      opts,
    );
    return withMeta(r.data as TransferLeadsResponse, r.meta);
  }

  /** Export one or more lists as CSV. Do-not-contact leads are left out unless includeSuppressed. */
  async export(params: ExportListsParams = {}, opts?: RequestOptions): Promise<WithResponse<ListsCsv>> {
    const ids = params.ids === undefined || params.ids === 'all' ? 'all' : params.ids.join(',');
    const r = await this.http.request(
      {
        method: 'GET',
        path: '/api/v1/lists/export',
        query: { ids, kind: params.kind, includeSuppressed: params.includeSuppressed ? 1 : undefined },
        idempotent: true,
      },
      opts,
    );
    const raw = typeof r.data === 'string' ? r.data : '';
    const csv = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const suppressed = Number(r.headers.get('x-skrap-suppressed') ?? 0) || 0;
    return withMeta({ csv, suppressed }, r.meta);
  }
}

/* ------------------------------------------------------------------ account */

export class AccountResource {
  constructor(private readonly http: HttpClient) {}

  /** Who the key belongs to: email, plan, spendable credits, team. Free; good as a connection test. */
  async get(opts?: RequestOptions): Promise<WithResponse<Account>> {
    const r = await this.http.request({ method: 'GET', path: '/api/v2/account', idempotent: true }, opts);
    return withMeta(r.data as Account, r.meta);
  }
}

/* ------------------------------------------------------------------ webhooks */

export class Webhooks {
  constructor(private readonly http: HttpClient) {}

  /** Subscribe an HTTPS endpoint to events. The signing secret is returned only here. */
  async create(params: CreateWebhookParams, opts?: RequestOptions): Promise<WithResponse<CreatedWebhook>> {
    const r = await this.http.request({ method: 'POST', path: '/api/v2/webhooks', body: params, idempotent: false }, opts);
    return withMeta(r.data as CreatedWebhook, r.meta);
  }

  /** Your subscriptions (no secrets). */
  async list(opts?: RequestOptions): Promise<WithResponse<WebhookList>> {
    const r = await this.http.request({ method: 'GET', path: '/api/v2/webhooks', idempotent: true }, opts);
    return withMeta(r.data as WebhookList, r.meta);
  }

  /** Unsubscribe. */
  async delete(webhookId: string, opts?: RequestOptions): Promise<WithResponse<{ ok: boolean }>> {
    const r = await this.http.request({ method: 'DELETE', path: `/api/v2/webhooks/${seg(webhookId, 'webhookId')}`, idempotent: false }, opts);
    return withMeta(r.data as { ok: boolean }, r.meta);
  }

  /** Example payload of an event (an array of one), for mapping fields. */
  async sample(event: WebhookEventType, opts?: RequestOptions): Promise<WithResponse<WebhookEvent[]>> {
    const r = await this.http.request({ method: 'GET', path: `/api/v2/webhooks/samples/${seg(event, 'event')}`, idempotent: true }, opts);
    return withMeta(r.data as WebhookEvent[], r.meta);
  }

  /** true when the Skrap-Signature header is valid for this raw body and secret. */
  verifySignature(payload: string | Uint8Array, header: string | null | undefined, secret: string, options?: VerifyWebhookOptions): boolean {
    return verifyWebhookSignature(payload, header, secret, options);
  }

  /** Verify the signature and parse the event; throws WebhookSignatureError when invalid. */
  constructEvent<T = Record<string, unknown>>(
    payload: string | Uint8Array,
    header: string | null | undefined,
    secret: string,
    options?: VerifyWebhookOptions,
  ): WebhookEvent<T> {
    return constructWebhookEvent<T>(payload, header, secret, options);
  }
}
