import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Skrap, WebhookSignatureError, constructWebhookEvent, verifyWebhookSignature } from '../src';

const secret = 'whsec_test_secret';
const body = JSON.stringify({ id: 'evt_1', type: 'bulk_job.completed', created: '2026-11-03T09:12:44.120Z', data: { jobId: 'j1', total: 2 } });
const now = Date.parse('2026-11-03T09:12:45Z');
const t = Math.floor(now / 1000);

function sign(payload: string, ts: number, key = secret) {
  return `t=${ts},v1=${createHmac('sha256', key).update(`${ts}.${payload}`).digest('hex')}`;
}

describe('webhook signatures', () => {
  it('accepts a valid signature (string and bytes)', () => {
    const header = sign(body, t);
    expect(verifyWebhookSignature(body, header, secret, { now })).toBe(true);
    expect(verifyWebhookSignature(new TextEncoder().encode(body), header, secret, { now })).toBe(true);
  });

  it('rejects a wrong secret, a changed body and a malformed header', () => {
    expect(verifyWebhookSignature(body, sign(body, t, 'other'), secret, { now })).toBe(false);
    expect(verifyWebhookSignature(`${body} `, sign(body, t), secret, { now })).toBe(false);
    expect(verifyWebhookSignature(body, 'garbage', secret, { now })).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret, { now })).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, t), '', { now })).toBe(false);
  });

  it('rejects old signatures (replay window) unless the tolerance is off', () => {
    const old = sign(body, t - 600);
    expect(verifyWebhookSignature(body, old, secret, { now })).toBe(false);
    expect(verifyWebhookSignature(body, old, secret, { now, toleranceSec: 900 })).toBe(true);
    expect(verifyWebhookSignature(body, old, secret, { now, toleranceSec: 0 })).toBe(true);
  });

  it('accepts any of several v1 signatures (secret rotation)', () => {
    const good = sign(body, t).split(',v1=')[1];
    expect(verifyWebhookSignature(body, `t=${t},v1=deadbeef,v1=${good}`, secret, { now })).toBe(true);
  });

  it('constructWebhookEvent parses a verified event and throws otherwise', () => {
    const evt = constructWebhookEvent<{ jobId: string }>(body, sign(body, t), secret, { now });
    expect(evt.type).toBe('bulk_job.completed');
    expect(evt.data.jobId).toBe('j1');
    expect(() => constructWebhookEvent(body, sign(body, t, 'x'), secret, { now })).toThrow(WebhookSignatureError);
    try {
      constructWebhookEvent(body, 'nope', secret, { now });
    } catch (e) {
      expect((e as WebhookSignatureError).code).toBe('INVALID_SIGNATURE');
    }
  });

  it('is available on the client as skrap.webhooks', () => {
    const skrap = new Skrap({ apiKey: 'k', fetch: async () => new Response('{}') });
    expect(skrap.webhooks.verifySignature(body, sign(body, t), secret, { now })).toBe(true);
    expect(skrap.webhooks.constructEvent(body, sign(body, t), secret, { now }).id).toBe('evt_1');
  });
});
