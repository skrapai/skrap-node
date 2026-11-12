import { describe, expect, it } from 'vitest';
import { BASE, client } from './helpers';

describe('verify and find', () => {
  it('verifyEmail accepts a string and posts { email }', async () => {
    const body = {
      email: 'jane@example.com',
      status: 'valid',
      retryable: false,
      score: 95,
      checks: { syntax: true, mxFound: true, smtp: 'accepted', catchAll: false, disposable: false, roleAccount: false, freeProvider: false },
      riskReasons: [],
      didYouMean: null,
    };
    const { skrap, calls } = client([{ body }]);
    const r = await skrap.verifyEmail('jane@example.com');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/api/v2/verify-email`);
    expect(calls[0]!.body).toEqual({ email: 'jane@example.com' });
    expect(r.status).toBe('valid');
    expect(r.checks.smtp).toBe('accepted');
  });

  it('verifyEmail accepts params and rejects an empty email without a request', async () => {
    const { skrap, calls } = client([{ body: { email: 'a@b.co', status: 'invalid' } }]);
    await skrap.verifyEmail({ email: 'a@b.co' });
    expect(calls[0]!.body).toEqual({ email: 'a@b.co' });
    await expect(skrap.verifyEmail('  ')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(calls).toHaveLength(1);
  });

  it('findEmail posts the person and company', async () => {
    const { skrap, calls } = client([
      { body: { emails: [{ email: 'jane.doe@example.com', status: 'valid' }], status: 'valid', domainStatus: 'valid', pendingRefinement: false, requestId: 'req_1', retryable: false } },
    ]);
    const r = await skrap.findEmail({ firstName: 'Jane', lastName: 'Doe', domain: 'example.com' });
    expect(calls[0]!.url).toBe(`${BASE}/api/v2/find-email`);
    expect(calls[0]!.body).toEqual({ firstName: 'Jane', lastName: 'Doe', domain: 'example.com' });
    expect(r.emails[0]!.email).toBe('jane.doe@example.com');
    expect(r.lastResponse.requestId).toBe('req_1');
  });

  it('getFindRefinement GETs the refinement by request id (encoded)', async () => {
    const { skrap, calls } = client([{ body: { ready: true, email: 'j@example.com', status: 'valid', domainStatus: 'valid', retryable: false } }]);
    const r = await skrap.getFindRefinement('req/1');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/find-email/refinement/req%2F1`);
    expect(r.ready).toBe(true);
  });
});

describe('enrichment', () => {
  it.each([
    ['reverseEmail', '/api/v2/enrich/reverse-email', { email: 'jane@example.com', includeCompany: true }],
    ['person', '/api/v2/enrich/person', { linkedinUrl: 'https://www.linkedin.com/in/jane-doe', includeEmail: false }],
    ['company', '/api/v2/enrich/company', { domain: 'example.com', includeBreakdown: true }],
    ['companyContacts', '/api/v2/enrich/company-contacts', { domain: 'example.com', seniority: ['vp'], department: ['sales'], country: ['US'], limit: 5, page: 2 }],
  ] as const)('%s posts to %s', async (method, path, params) => {
    const { skrap, calls } = client([{ body: { found: true, creditsCharged: 1, requestId: 'req_e' } }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (skrap.enrich as any)[method](params);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}${path}`);
    expect(calls[0]!.body).toEqual(params);
    expect(r.found).toBe(true);
    expect(r.creditsCharged).toBe(1);
  });
});

describe('bulk jobs and tasks', () => {
  const created = { taskId: 't1', status: 'pending', progress: { total: 2, processed: 0, percentage: 0 } };

  it('bulk.verify posts emails (and listName)', async () => {
    const { skrap, calls } = client([{ status: 202, body: created }]);
    const r = await skrap.bulk.verify({ emails: ['a@x.com', 'b@y.com'], listName: 'Q2' });
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/bulk-verify`);
    expect(calls[0]!.body).toEqual({ emails: ['a@x.com', 'b@y.com'], listName: 'Q2' });
    expect(r.taskId).toBe('t1');
    expect(r.lastResponse.status).toBe(202);
  });

  it('bulk.find posts data rows', async () => {
    const { skrap, calls } = client([{ status: 202, body: created }]);
    await skrap.bulk.find({ data: [{ firstName: 'Jane', lastName: 'Doe', domain: 'example.com' }, { firstName: 'Li', company: 'Acme' }] });
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/bulk-find`);
    expect(calls[0]!.body).toEqual({ data: [{ firstName: 'Jane', lastName: 'Doe', domain: 'example.com' }, { firstName: 'Li', company: 'Acme' }] });
  });

  it('tasks.get', async () => {
    const { skrap, calls } = client([{ body: { taskId: 't1', type: 'bulk-verify', status: 'completed', progress: { total: 2, processed: 2, percentage: 100 } } }]);
    const t = await skrap.tasks.get('t1');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/tasks/t1`);
    expect(t.status).toBe('completed');
  });

  it('tasks.results passes offset and limit', async () => {
    const { skrap, calls } = client([{ body: { taskId: 't1', status: 'completed', offset: 50, limit: 25, total: 60, statusCounts: { valid: 1, risky: 0, invalid: 0, unknown: 0 }, rows: [] } }]);
    await skrap.tasks.results('t1', { offset: 50, limit: 25 });
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/tasks/t1/results?offset=50&limit=25`);
  });

  it('tasks.results without params sends no query', async () => {
    const { skrap, calls } = client([{ body: { rows: [], total: 0 } }]);
    await skrap.tasks.results('t1');
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/tasks/t1/results`);
  });

  it('tasks.download returns the CSV and filename', async () => {
    const { skrap, calls } = client([
      { text: 'email,status\njane@example.com,valid\n', headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="bulk-bulk-verify-t1.csv"' } },
    ]);
    const r = await skrap.tasks.download('t1');
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/tasks/t1/download?inline=1`);
    expect(r.csv).toContain('jane@example.com,valid');
    expect(r.filename).toBe('bulk-bulk-verify-t1.csv');
  });

  it('tasks.download throws TASK_PROCESSING while there are no results', async () => {
    const { skrap } = client([{ status: 202, body: { message: 'Task is still processing and has no results yet', code: 'TASK_PROCESSING', progress: {} } }]);
    await expect(skrap.tasks.download('t1')).rejects.toMatchObject({ code: 'TASK_PROCESSING', status: 202, retryable: true });
  });

  it('tasks.downloadUrl returns the signed URL', async () => {
    const { skrap, calls } = client([{ body: { downloadUrl: 'https://files.example/x.csv', expiresIn: 3600, message: 'ok' } }]);
    const r = await skrap.tasks.downloadUrl('t1');
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/tasks/t1/download`);
    expect(r.downloadUrl).toBe('https://files.example/x.csv');
  });

  it('tasks.downloadUrl throws when the server streams CSV instead', async () => {
    const { skrap } = client([{ text: 'email,status\n', headers: { 'content-type': 'text/csv' } }]);
    await expect(skrap.tasks.downloadUrl('t1')).rejects.toMatchObject({ code: 'NO_DOWNLOAD_URL' });
  });

  it.each(['pause', 'resume', 'cancel'] as const)('tasks.%s posts to the control endpoint', async (action) => {
    const { skrap, calls } = client([{ body: { message: 'ok', taskId: 't1' } }]);
    const r = await skrap.tasks[action]('t1');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/tasks/t1/${action}`);
    expect(calls[0]!.body).toBeUndefined();
    expect(r.taskId).toBe('t1');
  });

  it('refuses an empty task id', async () => {
    const { skrap, calls } = client([]);
    await expect(skrap.tasks.get('')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(calls).toHaveLength(0);
  });
});

describe('lists', () => {
  it('lists.list with kind', async () => {
    const { skrap, calls } = client([{ body: { success: true, lists: [{ id: 'l1', name: 'Q2', kind: 'prospect', leadCount: 3 }] } }]);
    const r = await skrap.lists.list({ kind: 'prospect' });
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/lists?kind=prospect`);
    expect(r.lists[0]!.leadCount).toBe(3);
  });

  it('lists.create', async () => {
    const { skrap, calls } = client([{ status: 201, body: { success: true, list: { id: 'l1', name: 'Q2', kind: 'company', leads: [] } } }]);
    const r = await skrap.lists.create({ name: 'Q2', kind: 'company' });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/lists`);
    expect(calls[0]!.body).toEqual({ name: 'Q2', kind: 'company' });
    expect(r.list.id).toBe('l1');
  });

  it('lists.addLead', async () => {
    const lead = { id: 'lead-1', name: 'Jane Doe', company: 'Example Inc', email: 'jane@example.com', emailStatus: 'valid' as const };
    const { skrap, calls } = client([{ status: 201, body: { success: true, lead } }]);
    await skrap.lists.addLead('l1', lead);
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/lists/l1/leads`);
    expect(calls[0]!.body).toEqual(lead);
  });

  it('lists.transferLeads', async () => {
    const { skrap, calls } = client([{ body: { success: true, mode: 'move', matched: 1, added: 1, skipped: 0 } }]);
    const r = await skrap.lists.transferLeads('l1', { targetListId: 'l2', leadIds: ['lead-1'], mode: 'move' });
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/lists/l1/leads/transfer`);
    expect(calls[0]!.body).toEqual({ targetListId: 'l2', leadIds: ['lead-1'], mode: 'move' });
    expect(r.added).toBe(1);
  });

  it('lists.export returns CSV without BOM and the suppressed count', async () => {
    const { skrap, calls } = client([
      { text: '﻿Name,Email\nJane,jane@example.com', headers: { 'content-type': 'text/csv; charset=utf-8', 'x-skrap-suppressed': '2' } },
    ]);
    const r = await skrap.lists.export({ ids: ['l1', 'l2'], kind: 'prospect', includeSuppressed: true });
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/lists/export?ids=l1%2Cl2&kind=prospect&includeSuppressed=1`);
    expect(r.csv.startsWith('Name,Email')).toBe(true);
    expect(r.suppressed).toBe(2);
  });

  it('lists.export defaults to all lists', async () => {
    const { skrap, calls } = client([{ text: 'Name\n', headers: { 'content-type': 'text/csv' } }]);
    const r = await skrap.lists.export();
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/lists/export?ids=all`);
    expect(r.suppressed).toBe(0);
  });
});

describe('account and webhooks', () => {
  it('account.get', async () => {
    const { skrap, calls } = client([{ body: { id: 'u1', email: 'you@company.com', plan: 'pro', credits: 4210, team: null, apiKey: { id: 'k1', name: 'Zapier' } } }]);
    const a = await skrap.account.get();
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`${BASE}/api/v2/account`);
    expect(a.credits).toBe(4210);
  });

  it('webhooks.create / list / delete / sample', async () => {
    const { skrap, calls } = client([
      { status: 201, body: { id: 'w1', url: 'https://hooks.example/x', events: ['bulk_job.completed'], secret: 'whsec_1' } },
      { body: { webhooks: [{ id: 'w1', url: 'https://hooks.example/x', events: ['bulk_job.completed'], enabled: true }] } },
      { body: { ok: true } },
      { body: [{ id: 'evt_1', type: 'credits.low', created: '2026-11-03T09:12:44.120Z', data: {} }] },
    ]);
    const created = await skrap.webhooks.create({ url: 'https://hooks.example/x', events: ['bulk_job.completed'] });
    expect(created.secret).toBe('whsec_1');
    expect(calls[0]!.body).toEqual({ url: 'https://hooks.example/x', events: ['bulk_job.completed'] });
    const list = await skrap.webhooks.list();
    expect(list.webhooks).toHaveLength(1);
    const del = await skrap.webhooks.delete('w1');
    expect(del.ok).toBe(true);
    const sample = await skrap.webhooks.sample('credits.low');
    expect(sample[0]!.type).toBe('credits.low');
    expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'POST /api/v2/webhooks',
      'GET /api/v2/webhooks',
      'DELETE /api/v2/webhooks/w1',
      'GET /api/v2/webhooks/samples/credits.low',
    ]);
  });
});

describe('response metadata', () => {
  it('attaches lastResponse (non-enumerable) with request id and rate limits', async () => {
    const { skrap } = client([
      { body: { email: 'a@b.co', status: 'valid' }, headers: { 'x-request-id': 'rid_9', ratelimit: 'limit=120, remaining=119, reset=60' } },
    ]);
    const r = await skrap.verifyEmail('a@b.co');
    expect(r.lastResponse.requestId).toBe('rid_9');
    expect(r.lastResponse.status).toBe(200);
    expect(r.lastResponse.rateLimit).toEqual({ limit: 120, remaining: 119, reset: 60 });
    expect(Object.keys(r)).not.toContain('lastResponse');
    expect(JSON.parse(JSON.stringify(r))).toEqual({ email: 'a@b.co', status: 'valid' });
  });
});
