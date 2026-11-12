// Receive Skrap webhooks and check their signatures.
//
//   SKRAP_WEBHOOK_SECRET=whsec_... node examples/webhook-server.mjs
//
// Add the endpoint in the app (Integrations -> Webhooks) or with skrap.webhooks.create().
// Answer 2xx within 10 seconds; anything else is retried.
import { createServer } from 'node:http';
import { WebhookSignatureError, constructWebhookEvent } from 'skrap-ai';

const secret = process.env.SKRAP_WEBHOOK_SECRET;
if (!secret) throw new Error('Set SKRAP_WEBHOOK_SECRET');

const seen = new Set(); // de-duplicate by Skrap-Event-Id (use a database in production)

createServer((req, res) => {
  if (req.method !== 'POST') return res.writeHead(405).end();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks); // the raw body, exactly as received
    try {
      const event = constructWebhookEvent(raw, req.headers['skrap-signature'], secret);
      const eventId = req.headers['skrap-event-id'] ?? event.id;
      if (!seen.has(eventId)) {
        seen.add(eventId);
        if (event.type === 'bulk_job.completed') console.log('Bulk job done:', event.data);
        else if (event.type === 'credits.low') console.log('Credits low:', event.data);
        else console.log(event.type, event.data);
      }
      res.writeHead(200).end('ok');
    } catch (err) {
      if (err instanceof WebhookSignatureError) return res.writeHead(400).end(err.message);
      throw err;
    }
  });
}).listen(3000, () => console.log('Listening on http://localhost:3000'));
