import { createHmac, timingSafeEqual } from 'node:crypto';
import { SkrapError } from './errors';
import type { WebhookEvent } from './types';

/** Thrown by `constructWebhookEvent` when a delivery's signature does not check out. */
export class WebhookSignatureError extends SkrapError {}

export interface VerifyWebhookOptions {
  /** Oldest accepted signature age, in seconds (default 300). 0 turns the check off. */
  toleranceSec?: number;
  /** Current time in ms (for tests). */
  now?: number;
}

function parseHeader(header: string): { t: string | null; v1: string[] } {
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  return { t, v1 };
}

function toText(payload: string | Uint8Array): string {
  return typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
}

function check(payload: string | Uint8Array, header: string | null | undefined, secret: string, opts: VerifyWebhookOptions): string | null {
  if (!header) return 'Missing Skrap-Signature header';
  if (!secret) return 'Missing webhook secret';
  const { t, v1 } = parseHeader(header);
  if (!t || !/^\d+$/.test(t) || v1.length === 0) return 'Malformed Skrap-Signature header';
  const tolerance = opts.toleranceSec ?? 300;
  const nowSec = (opts.now ?? Date.now()) / 1000;
  if (tolerance > 0 && Math.abs(nowSec - Number(t)) > tolerance) return 'Signature timestamp is outside the tolerance window';
  const expected = createHmac('sha256', secret).update(`${t}.${toText(payload)}`).digest('hex');
  const exp = Buffer.from(expected, 'utf8');
  for (const sig of v1) {
    const got = Buffer.from(sig, 'utf8');
    if (got.length === exp.length && timingSafeEqual(got, exp)) return null;
  }
  return 'Signature does not match';
}

/**
 * true when `header` (the Skrap-Signature request header) is a valid signature of the raw
 * request body with your endpoint secret. Pass the body exactly as received (not re-serialized JSON).
 */
export function verifyWebhookSignature(
  payload: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  opts: VerifyWebhookOptions = {},
): boolean {
  return check(payload, header, secret, opts) === null;
}

/** Verify the signature and parse the event. Throws `WebhookSignatureError` when it does not verify. */
export function constructWebhookEvent<T = Record<string, unknown>>(
  payload: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  opts: VerifyWebhookOptions = {},
): WebhookEvent<T> {
  const problem = check(payload, header, secret, opts);
  if (problem) throw new WebhookSignatureError(problem, { code: 'INVALID_SIGNATURE' });
  try {
    return JSON.parse(toText(payload)) as WebhookEvent<T>;
  } catch (err) {
    throw new WebhookSignatureError('Webhook payload is not valid JSON', { code: 'INVALID_PAYLOAD', cause: err });
  }
}
