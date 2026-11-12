# Skrap.ai Node.js SDK

The official Node.js and TypeScript library for the [Skrap.ai API](https://skrap.ai/docs/api). Use it to verify email addresses, find work emails, enrich people and companies, run bulk jobs, manage lists and receive webhooks.

- TypeScript types for every request and response
- No runtime dependencies (uses the global `fetch` of Node.js 18+)
- ESM and CommonJS builds
- Automatic retries with exponential backoff that honour `Retry-After`
- Typed errors that carry the HTTP status, error code and retry hints

## Install

```bash
npm install skrap-ai
```

Requires Node.js 18 or later. You need an API key: create one in the app under **Settings → API keys & MCP** (paid plans).

## Quick start

```ts
import { Skrap } from 'skrap-ai';

const skrap = new Skrap({ apiKey: process.env.SKRAP_API_KEY });

// Verify an address
const verified = await skrap.verifyEmail('jane@example.com');
console.log(verified.status); // valid | risky | invalid | unknown

// Find a work email
const found = await skrap.findEmail({ firstName: 'Jane', lastName: 'Doe', domain: 'example.com' });
console.log(found.emails[0]?.email);
```

CommonJS works too:

```js
const { Skrap } = require('skrap-ai');
```

If you leave out `apiKey`, the client reads the `SKRAP_API_KEY` environment variable. Keep keys on the server and never ship them to a browser.

## Configuration

```ts
const skrap = new Skrap({
  apiKey: 'sk_...',           // default: process.env.SKRAP_API_KEY
  baseUrl: 'https://api.skrap.ai', // default: process.env.SKRAP_BASE_URL, then https://api.skrap.ai
  timeoutMs: 120_000,         // per attempt (verify and find can take up to about a minute)
  maxRetries: 2,              // retries after the first attempt; 0 turns retries off
  maxRetryDelayMs: 60_000,    // longest Retry-After the SDK will wait for
  fetch: customFetch,         // optional fetch implementation
  defaultHeaders: { 'x-my-trace': 'abc' },
});
```

Every method takes an optional last argument with per-request options:

```ts
await skrap.verifyEmail('jane@example.com', {
  signal: AbortSignal.timeout(30_000), // cancel
  timeoutMs: 30_000,
  maxRetries: 0,
  headers: { 'x-my-trace': 'abc' },
});
```

## Credits

Lookups that come back invalid, unknown or not found are free. If you repeat a verify or find that you already paid for, it is also free while inside your plan's repeat window, and the answer then carries `repeat: { free: true, firstChargedAt }`. See [pricing](https://skrap.ai/pricing) and the [credit table](https://skrap.ai/docs/api).

## Methods

### Verify an email

`POST /api/v2/verify-email`. Costs 1 credit when the result is valid or risky.

```ts
const r = await skrap.verifyEmail('jane@example.com'); // or verifyEmail({ email })
r.status;      // 'valid' | 'risky' | 'invalid' | 'unknown'
r.retryable;   // true: unknown for a temporary reason, try again later
r.score;       // 95 valid, 10-70 risky, 0 invalid, null unknown
r.checks;      // { syntax, mxFound, smtp, catchAll, disposable, roleAccount, freeProvider }
r.riskReasons; // risky only: catch_all, catch_all_unconfirmed, role_account, disposable
r.didYouMean;  // typo hint or null
```

### Find a work email

`POST /api/v2/find-email`. Costs 1 credit when a valid or risky email is found. Give a domain when you have one (best results). Otherwise give a company name.

```ts
const r = await skrap.findEmail({
  firstName: 'Jane',
  lastName: 'Doe',          // or fullName: 'Jane Doe'
  domain: 'example.com',    // or company: 'Example Inc' (+ optional location hint)
});
r.emails;        // [{ email, status }]
r.domainStatus;  // 'valid' | 'risky' | 'invalid' | 'unknown'
r.requestId;
```

Some mail servers answer slowly. In that case the first answer has `pendingRefinement: true` and is not charged yet. Wait for the final answer like this:

```ts
if (r.pendingRefinement) {
  const final = await skrap.waitForFindRefinement(r.requestId, { intervalMs: 2000, timeoutMs: 120_000 });
  final.email;  // final.status, final.domainStatus
}
// or poll yourself:
const state = await skrap.getFindRefinement(r.requestId); // { ready, email?, status?, ... }
```

Sometimes a company name matches several companies. Then the answer has `needsCompanyConfirmation: true` and `suggestions: [{ name, domain, employeeCount }]`. Resend with the domain you mean.

### Enrichment

You are charged only when something is found. Each account can spend up to 5,000 credits a day on enrichment, and the limit resets at midnight UTC. Over the limit, you get a `RateLimitError` with code `ENRICH_DAILY_LIMIT`.

```ts
// Who is behind a work email. 2 credits when found (+1 with includeCompany when the profile is found).
const who = await skrap.enrich.reverseEmail({ email: 'jane.doe@example.com', includeCompany: true });
who.found; who.person?.fullName; who.person?.currentJob?.title;
who.company;        // the person's current company: { name, domain, linkedinUrl }
who.companyProfile; // full company profile, only with includeCompany: true

// A LinkedIn profile, plus the work email at the current employer when on record. 1 credit (+1 with email).
const p = await skrap.enrich.person({ linkedinUrl: 'https://www.linkedin.com/in/jane-doe', includeEmail: true });
p.person; p.workEmail; // { address, status } | null

// A company from its domain or LinkedIn page. 1 credit (+1 with includeBreakdown).
const c = await skrap.enrich.company({ domain: 'example.com', includeBreakdown: true });
c.company?.industry; c.company?.employees; c.headcountBreakdown?.departments;

// People at a company. 1 credit per person returned (emails included).
const team = await skrap.enrich.companyContacts({
  domain: 'example.com',
  seniority: ['vp', 'director'],
  department: ['sales'],
  country: ['US'],
  limit: 10,
  page: 1,
});
team.people.forEach((x) => console.log(x.fullName, x.title, x.email?.address));
```

Every enrichment answer carries `creditsCharged` and `requestId`.

### Bulk jobs

A bulk job takes up to 25,000 rows and runs in the background. Each verify row is charged once, when it settles as valid or risky.

```ts
const job = await skrap.bulk.verify({ emails: ['jane@example.com', 'john@example.org'], listName: 'Q2' });
const job2 = await skrap.bulk.find({
  data: [
    { firstName: 'Jane', lastName: 'Doe', domain: 'example.com' },
    { firstName: 'Li', company: 'Acme' },
  ],
});

const task = await skrap.tasks.get(job.taskId);          // status + progress
const done = await skrap.tasks.wait(job.taskId, {        // poll until completed, failed, cancelled or paused
  intervalMs: 5000,
  onProgress: (t) => console.log(t.progress.percentage),
});

const page = await skrap.tasks.results(job.taskId, { offset: 0, limit: 50 }); // one page
for await (const row of skrap.tasks.iterResults(job.taskId)) {                // every row
  console.log(row.email, row.status);
}

const { csv, filename } = await skrap.tasks.download(job.taskId);   // results CSV
const { downloadUrl, expiresIn } = await skrap.tasks.downloadUrl(job.taskId); // signed link to the stored file

await skrap.tasks.pause(job.taskId);
await skrap.tasks.resume(job.taskId);
await skrap.tasks.cancel(job.taskId); // rows already processed stay charged; nothing else is
```

A job also pauses itself when credits run out (`metadata.pauseReason: 'insufficient_credits'`). Resume it after a top-up. While a job has no results yet, `tasks.download()` throws a `SkrapError` with code `TASK_PROCESSING` (status 202). Results are kept for 30 days. After that, results and downloads fail with status 410 and code `RESULTS_EXPIRED`. You can also subscribe to the `bulk_job.completed` webhook instead of polling.

### Lists

```ts
const { lists } = await skrap.lists.list({ kind: 'prospect' }); // [{ id, name, kind, leadCount }]
const { list } = await skrap.lists.create({ name: 'Q2 outbound', kind: 'prospect' }); // 'prospect' or 'company'

await skrap.lists.addLead(list.id, {
  id: 'lead-123',            // your id, unique in the list
  name: 'Jane Doe',
  company: 'Example Inc',
  email: 'jane@example.com', // required on prospect (people) lists
  emailStatus: 'valid',
  jobRole: 'CTO',
  domain: 'example.com',
});

await skrap.lists.transferLeads(list.id, { targetListId: 'other-list-id', leadIds: ['lead-123'], mode: 'move' });

const { csv, suppressed } = await skrap.lists.export({ ids: [list.id], kind: 'prospect' });
// ids defaults to 'all'; leads on your do-not-contact list are left out unless includeSuppressed: true
```

Adding a lead whose id or email is already in the list throws a `ConflictError` (409).

### Account

```ts
const me = await skrap.account.get(); // { id, email, plan, credits, team, apiKey }
```

This call is free, so it works well as a connection test.

### Webhooks

```ts
const hook = await skrap.webhooks.create({
  url: 'https://example.com/skrap-webhook',
  events: ['bulk_job.completed', 'credits.low'],
});
hook.secret; // signing secret, returned only once: store it

const { webhooks } = await skrap.webhooks.list();
await skrap.webhooks.delete(hook.id);
const [example] = await skrap.webhooks.sample('bulk_job.completed');
```

The events are `bulk_job.completed`, `bulk_job.failed`, `credits.low` and `list.lead_added`. Webhooks are available on paid plans. On a team, only owners and admins can subscribe or remove them.

#### Verify webhook signatures

Pass the raw request body exactly as received. A body you parsed and serialized again will not match the signature.

```ts
import { constructWebhookEvent, WebhookSignatureError } from 'skrap-ai';

app.post('/skrap-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = constructWebhookEvent(req.body, req.header('skrap-signature'), process.env.SKRAP_WEBHOOK_SECRET!);
    // de-duplicate with the Skrap-Event-Id header, then handle event.type / event.data
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return res.status(400).send(err.message);
    throw err;
  }
});
```

`verifyWebhookSignature(rawBody, header, secret)` returns a boolean instead of throwing. Both functions reject signatures older than 5 minutes by default; change that with `{ toleranceSec }`. The same functions are also available as `skrap.webhooks.verifySignature()` and `skrap.webhooks.constructEvent()`.

## Errors

Every failure throws a `SkrapError`. Specific cases use these subclasses:

| Class | HTTP | Typical `code` |
| --- | --- | --- |
| `ValidationError` | 400 | `VALIDATION_ERROR`, `UNSUPPORTED_EMAIL` |
| `AuthenticationError` | 401 | `INVALID_API_KEY`, `API_KEY_EXPIRED` |
| `InsufficientCreditsError` | 402 | `INSUFFICIENT_CREDITS`, `MEMBER_CREDIT_LIMIT`, `OVERAGE_LIMIT`, `OVERAGE_BLOCKED` |
| `PermissionDeniedError` | 403 | `PLAN_REQUIRED`, `IP_NOT_ALLOWED`, `FEATURE_NOT_AVAILABLE`, `ACCESS_DENIED`, `AUTHORIZATION_ERROR` |
| `NotFoundError` | 404 | `NOT_FOUND`, `TASK_NOT_FOUND` |
| `ConflictError` | 409 | (duplicate list or lead) |
| `RateLimitError` | 429 | `RATE_LIMITED`, `RATE_LIMIT_EXCEEDED`, `ENRICH_DAILY_LIMIT`, `FREE_ENRICH_LIMIT` |
| `ServerError` | 5xx | `INTERNAL_ERROR`, `ENRICH_UNAVAILABLE`, `CREDIT_CONTENTION` |
| `APIConnectionError` | none | `CONNECTION_ERROR` |
| `APITimeoutError` | none | `TIMEOUT` |

Other statuses, such as 410 `RESULTS_EXPIRED`, throw the base `SkrapError`.

```ts
import { InsufficientCreditsError, RateLimitError, SkrapError } from 'skrap-ai';

try {
  await skrap.verifyEmail('jane@example.com');
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.log(err.details); // { required, available, shortfall }
  } else if (err instanceof RateLimitError) {
    console.log(`retry in ${err.retryAfter}s`, err.body); // plan, planName, limitPerMinute, upgrade
  } else if (err instanceof SkrapError) {
    console.log(err.status, err.code, err.message, err.retryable, err.requestId);
  }
}
```

Every `SkrapError` has these fields:

- `status`: the HTTP status, or `null` when no response arrived.
- `code`: the API's error code. Some endpoints, such as list errors, send no code, so it can be `null`.
- `message`
- `retryable`: the API's `retryable` flag when it sends one. Otherwise it is true for 429, 5xx, connection errors and timeouts.
- `retryAfter`: in seconds.
- `details`, `body` and `headers`
- `requestId`: currently `null` for most errors, because error responses do not carry a request id.

Aborting through your `signal` throws the signal's abort reason (an `AbortError`), not a `SkrapError`.

## Retries

The SDK retries automatically (2 times by default):

- **429, 500 and 503:** always retried. The API did no work and charged nothing.
- **502, 504, network errors and timeouts:** retried only for calls that are safe to repeat. These are verify, find (a repeat is free) and all reads. Bulk job creation, enrichment, list writes, webhook changes and task controls are not retried after an unknown outcome, so they never run twice.
- **Waiting:** the SDK waits the `Retry-After` header (or `retryAfterSec`) when the API sends one. Otherwise it backs off exponentially with jitter, from 0.5 s up to 8 s.
- **Long waits:** if the API asks to wait longer than `maxRetryDelayMs` (60 s by default), the SDK throws right away with `error.retryAfter` set. This happens with the daily enrichment limit, for example.
- **No retry:** a response with `retryable: false` is never retried.

Plan rate limits are per key: Free 30, Professional 120 and Enterprise 600 requests a minute.

## Response details

Each result has a non-enumerable `lastResponse` property. It is left out of `JSON.stringify` and `Object.keys`.

```ts
const r = await skrap.verifyEmail('jane@example.com');
r.lastResponse.status;     // 200
r.lastResponse.requestId;  // x-request-id header, else the body's requestId (find and enrichment), else null
r.lastResponse.rateLimit;  // { limit, remaining, reset } from the RateLimit headers, or null
r.lastResponse.headers;
```

## Examples

The examples import the built package, so run `npm run build` first.

- [`examples/verify-then-find.mjs`](examples/verify-then-find.mjs): verify, then find, with error handling
- [`examples/bulk-verify.mjs`](examples/bulk-verify.mjs): bulk job, wait, results, CSV
- [`examples/webhook-server.mjs`](examples/webhook-server.mjs): receive webhooks and check their signatures

## Documentation

- API reference: https://skrap.ai/docs/api
- Webhooks: https://skrap.ai/docs/webhooks
- OpenAPI: https://skrap.ai/openapi.json

## License

MIT. See [LICENSE](LICENSE).
