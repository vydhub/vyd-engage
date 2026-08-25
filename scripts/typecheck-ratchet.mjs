#!/usr/bin/env node
/**
 * Typecheck ratchet.
 *
 * The frontend accumulated ~333 latent type errors before any tsconfig existed.
 * Fixing them all at once is impractical, so this gate FREEZES the count: CI
 * fails only if the number of `tsc --noEmit` errors INCREASES above the baseline.
 * When you fix errors, lower BASELINE to lock the gain (the script tells you the
 * new number to use).
 *
 * Drive BASELINE toward 0 over time. See the tracking issue for the breakdown.
 */
import { execSync } from 'node:child_process';

const BASELINE = 263;

let output = '';
try {
  output = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  output = `${err.stdout || ''}${err.stderr || ''}`;
}

const count = (output.match(/error TS\d+/g) || []).length;
console.log(`TypeScript errors: ${count} (baseline: ${BASELINE})`);

if (count > BASELINE) {
  console.error(`\n❌ Type errors increased by ${count - BASELINE} above the baseline.`);
  console.error('   Fix the new type errors (run `npm run typecheck` to see them).');
  process.exit(1);
}

if (count < BASELINE) {
  console.log(`\n✅ Down ${BASELINE - count} from baseline. Lower BASELINE to ${count} in scripts/typecheck-ratchet.mjs to lock it in.`);
} else {
  console.log('\n✅ No new type errors.');
}
