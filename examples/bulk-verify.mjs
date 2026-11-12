// Verify a list of addresses as a bulk job, wait for it, then read the results.
//
//   npm run build
//   SKRAP_API_KEY=... node examples/bulk-verify.mjs emails.txt     (one address per line)
//
// Each row is charged once, when it settles as valid or risky.
import { readFile, writeFile } from 'node:fs/promises';
import { Skrap } from 'skrap-ai';

const file = process.argv[2];
const emails = file
  ? (await readFile(file, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  : ['jane@example.com', 'john@example.org'];

const skrap = new Skrap();

const job = await skrap.bulk.verify({ emails, listName: 'SDK example' });
console.log(`Started ${job.taskId} with ${job.progress.total} rows`);

const task = await skrap.tasks.wait(job.taskId, {
  intervalMs: 5000,
  onProgress: (t) => console.log(`  ${t.status} ${t.progress.processed}/${t.progress.total}`),
});
console.log(`Job ${task.status}`);

const counts = { valid: 0, risky: 0, invalid: 0, unknown: 0 };
for await (const row of skrap.tasks.iterResults(job.taskId)) {
  counts[row.status] = (counts[row.status] ?? 0) + 1;
}
console.log('Results:', counts);

const { csv } = await skrap.tasks.download(job.taskId);
await writeFile(`results-${job.taskId}.csv`, csv);
console.log(`Saved results-${job.taskId}.csv`);
