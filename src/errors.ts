/**
 * Errors thrown by the SDK. Every error is a `SkrapError`; catch the subclasses for specific
 * cases (`InsufficientCreditsError`, `RateLimitError`, ...).
 */

export interface SkrapErrorInit {
  status?: number | null;
  code?: string | null;
  requestId?: string | null;
  retryable?: boolean;
  retryAfter?: number | null;
  details?: unknown;
  body?: unknown;
  headers?: Headers | null;
  cause?: unknown;
}

export class SkrapError extends Error {
  /** HTTP status, or null when no response was received (network error, timeout). */
  readonly status: number | null;
  /** Machine-readable code from the API, e.g. INSUFFICIENT_CREDITS. */
  readonly code: string | null;
  /** Request id, when the API returned one. Quote it when contacting support. */
  readonly requestId: string | null;
  /** true when the same request may succeed later (after `retryAfter` seconds when set). */
  readonly retryable: boolean;
  /** Seconds the API asked you to wait (Retry-After header or retryAfterSec), when given. */
  readonly retryAfter: number | null;
  /** The API's `details` field, e.g. `{ required, available }` for INSUFFICIENT_CREDITS. */
  readonly details: unknown;
  /** Parsed response body (JSON object or text), when there was one. */
  readonly body: unknown;
  /** Response headers, when there was a response. */
  readonly headers: Headers | null;

  constructor(message: string, init: SkrapErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.requestId = init.requestId ?? null;
    this.retryable = init.retryable ?? false;
    this.retryAfter = init.retryAfter ?? null;
    this.details = init.details;
    this.body = init.body;
    this.headers = init.headers ?? null;
  }
}

/** 400: a field is missing or malformed. */
export class ValidationError extends SkrapError {}
/** 401: missing, unknown, revoked or expired API key. */
export class AuthenticationError extends SkrapError {}
/** 402: not enough credits (INSUFFICIENT_CREDITS, MEMBER_CREDIT_LIMIT, ...). */
export class InsufficientCreditsError extends SkrapError {}
/** 403: plan required, IP not allowed, or not permitted. */
export class PermissionDeniedError extends SkrapError {}
/** 404: unknown id (task, list, webhook, refinement). */
export class NotFoundError extends SkrapError {}
/** 409: duplicate (list name, lead) or incompatible lists. */
export class ConflictError extends SkrapError {}
/** 429: rate limit, concurrency limit or daily enrichment limit. */
export class RateLimitError extends SkrapError {}
/** 5xx: the API had a problem. Nothing was charged. */
export class ServerError extends SkrapError {}
/** No response: DNS, TLS, connection reset, ... */
export class APIConnectionError extends SkrapError {}
/** No response within `timeoutMs`. */
export class APITimeoutError extends APIConnectionError {}

/** Pick the error class for an HTTP status. */
export function errorClassFor(status: number): typeof SkrapError {
  if (status === 400 || status === 422) return ValidationError;
  if (status === 401) return AuthenticationError;
  if (status === 402) return InsufficientCreditsError;
  if (status === 403) return PermissionDeniedError;
  if (status === 404) return NotFoundError;
  if (status === 409) return ConflictError;
  if (status === 429) return RateLimitError;
  if (status >= 500) return ServerError;
  return SkrapError;
}
