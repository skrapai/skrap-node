// Verify an address, then find a work email.
//
//   npm run build
//   SKRAP_API_KEY=... node examples/verify-then-find.mjs jane@example.com Jane Doe example.com
//
// Costs: 1 credit per valid or risky answer; invalid, unknown and not-found answers are free.
import { InsufficientCreditsError, RateLimitError, Skrap, SkrapError } from 'skrap-ai';

const [email = 'jane@example.com', firstName = 'Jane', lastName = 'Doe', domain = 'example.com'] = process.argv.slice(2);

const skrap = new Skrap(); // reads SKRAP_API_KEY

try {
  // 1. Verify
  const verified = await skrap.verifyEmail(email);
  console.log(`${verified.email}: ${verified.status} (score ${verified.score ?? 'n/a'})`);
  if (verified.riskReasons.length) console.log('  risk reasons:', verified.riskReasons.join(', '));
  if (verified.didYouMean) console.log('  did you mean:', verified.didYouMean);
  if (verified.status === 'unknown' && verified.retryable) console.log('  temporary: try again later');

  // 2. Find
  let found = await skrap.findEmail({ firstName, lastName, domain });
  if (found.needsCompanyConfirmation) {
    console.log('Several companies match; resend with one of these domains:', found.suggestions);
  } else if (found.pendingRefinement) {
    console.log('A slow mail server is still answering, waiting...');
    const final = await skrap.waitForFindRefinement(found.requestId);
    console.log(`${firstName} ${lastName}: ${final.email ?? 'not found'} (${final.status})`);
  } else {
    const best = found.emails[0];
    console.log(`${firstName} ${lastName}: ${best ? `${best.email} (${best.status})` : 'not found'}`);
  }
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.error('Out of credits:', err.details);
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited, retry in ${err.retryAfter ?? '?'} s`);
  } else if (err instanceof SkrapError) {
    console.error(`Skrap error ${err.status ?? ''} ${err.code ?? ''}: ${err.message}`);
  } else {
    throw err;
  }
  process.exitCode = 1;
}
