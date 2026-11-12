// Load the built package both ways (ESM import and CJS require) and check the public surface.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');
const esm = await import('../dist/index.js');

for (const [name, mod] of [['cjs', cjs], ['esm', esm]]) {
  for (const key of ['Skrap', 'SkrapError', 'RateLimitError', 'InsufficientCreditsError', 'verifyWebhookSignature', 'constructWebhookEvent', 'VERSION']) {
    assert.ok(mod[key] !== undefined, `${name}: missing export ${key}`);
  }
  const skrap = new mod.Skrap({ apiKey: 'sk_check', fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) });
  for (const method of ['verifyEmail', 'findEmail', 'getFindRefinement', 'waitForFindRefinement']) {
    assert.equal(typeof skrap[method], 'function', `${name}: skrap.${method}`);
  }
  for (const ns of ['enrich', 'bulk', 'tasks', 'lists', 'account', 'webhooks']) {
    assert.equal(typeof skrap[ns], 'object', `${name}: skrap.${ns}`);
  }
}
assert.equal(cjs.VERSION, esm.VERSION);
console.log(`dist OK (ESM + CJS), version ${esm.VERSION}`);
