# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- `Skrap` client: API key from the `apiKey` option or `SKRAP_API_KEY`, `baseUrl`, `timeoutMs`, `maxRetries`, `maxRetryDelayMs`, custom `fetch` and default headers.
- Verify and find: `verifyEmail`, `findEmail`, `getFindRefinement`, `waitForFindRefinement`.
- Enrichment: `enrich.reverseEmail`, `enrich.person`, `enrich.company`, `enrich.companyContacts`.
- Bulk jobs:
  - `bulk.verify` and `bulk.find`
  - `tasks.get`, `tasks.results`, `tasks.iterResults` and `tasks.wait`
  - `tasks.download` and `tasks.downloadUrl`
  - `tasks.pause`, `tasks.resume` and `tasks.cancel`
- Lists: `lists.list`, `lists.create`, `lists.addLead`, `lists.transferLeads`, `lists.export`.
- Account: `account.get`.
- Webhooks: `webhooks.create`, `webhooks.list`, `webhooks.delete`, `webhooks.sample`, plus `verifyWebhookSignature` and `constructWebhookEvent`.
- Automatic retries with exponential backoff and jitter that honour `Retry-After`. Calls that could run twice are not retried after an unknown outcome.
- Typed errors (`SkrapError` and its subclasses) with `status`, `code`, `requestId`, `retryable`, `retryAfter` and `details`.
- `lastResponse` on every result, with status, request id, headers and rate-limit info.
- ESM and CommonJS builds with TypeScript types. No runtime dependencies.

[0.1.0]: https://github.com/skrapai/skrap-node/releases/tag/v0.1.0
