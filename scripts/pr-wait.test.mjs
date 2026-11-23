#!/usr/bin/env node
/**
 * pr-wait.test.mjs — fail-first tests for the PR watcher.
 *
 * Two layers, mirroring the incidents the script exists to kill:
 *  1. Pure verdict logic (imported): the empty-check-list trap, the pending
 *     trap, the conflict/closed/merged terminal states, bad args.
 *  2. Subprocess CLI with a STUBBED gh — the watcher must never depend on a
 *     parser binary the host lacks; the stub is a .mjs script invoked through
 *     node via PR_WAIT_GH/PR_WAIT_GH_PREFIX, so the test runs on every OS.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { classifyChecks, verdictFor } from './pr-wait.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'pr-wait.mjs');
let passed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { console.error(`FAIL ${name}`); process.exitCode = 1; }
};

// ---- pure verdict logic ----
ok('empty check list is NOT green (the not-started trap)',
  classifyChecks([]).status === 'no-checks');
ok('empty check list keeps waiting (null verdict)',
  verdictFor({ prState: 'OPEN', mergeable: 'MERGEABLE', checks: [], until: 'green' }) === null);
ok('pending check keeps waiting',
  verdictFor({ prState: 'OPEN', checks: [{ bucket: 'pending' }], until: 'green' }) === null);
ok('all-pass exits green',
  verdictFor({ prState: 'OPEN', checks: [{ bucket: 'pass' }], until: 'green' })?.event === 'checks-green');
ok('skipping-only still counts as green (>=1 completed check)',
  verdictFor({ prState: 'OPEN', checks: [{ bucket: 'skipping' }, { bucket: 'pass' }], until: 'green' })?.exit === 0);
ok('failed check is terminal red',
  verdictFor({ prState: 'OPEN', checks: [{ bucket: 'fail', name: 'ci' }], until: 'green' })?.exit === 1);
ok('cancelled check is terminal red',
  verdictFor({ prState: 'OPEN', checks: [{ bucket: 'cancel', name: 'ci' }], until: 'green' })?.exit === 1);
ok('MERGED is terminal green even with pending checks',
  verdictFor({ prState: 'MERGED', checks: [{ bucket: 'pending' }], until: 'green' })?.event === 'merged');
ok('CLOSED unmerged is terminal red',
  verdictFor({ prState: 'CLOSED', checks: [], until: 'green' })?.exit === 1);
ok('CONFLICTING is terminal red',
  verdictFor({ prState: 'OPEN', mergeable: 'CONFLICTING', checks: [], until: 'green' })?.event === 'conflict');
ok('any-change terminates on first observed checks',
  verdictFor({ prState: 'OPEN', checks: [{ bucket: 'pending' }], until: 'any-change' })?.event === 'checks-observed');
ok('any-change still waits on a truly empty rollup',
  verdictFor({ prState: 'OPEN', checks: [], until: 'any-change' }) === null);

// ---- subprocess CLI against a stubbed gh ----
// The stub answers `gh pr view` / `gh pr checks` from JSON files in its dir.
const dir = mkdtempSync(join(tmpdir(), 'prwait-'));
writeFileSync(join(dir, 'view.json'), JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }));
writeFileSync(join(dir, 'checks.json'), JSON.stringify([{ name: 'ci', state: 'FAILURE', bucket: 'fail' }]));
writeFileSync(join(dir, 'fake-gh.mjs'), `
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const d = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes('view')) process.stdout.write(readFileSync(join(d, 'view.json'), 'utf8'));
else if (args.includes('checks')) process.stdout.write(readFileSync(join(d, 'checks.json'), 'utf8'));
else { process.stderr.write('unknown gh call'); process.exit(1); }
`);

const env = { ...process.env, PR_WAIT_GH: process.execPath, PR_WAIT_GH_PREFIX: join(dir, 'fake-gh.mjs') };
const run = (args, e = env) => spawnSync(process.execPath, [SCRIPT, ...args], { env: e, encoding: 'utf8' });

{
  const r = run(['12', '--repo', 'o/n', '--once']);
  ok('CLI: failed check exits 1 with the failing name', r.status === 1 && /checks-failed.*ci/.test(r.stdout));
}
{
  writeFileSync(join(dir, 'checks.json'), JSON.stringify([{ name: 'ci', state: 'SUCCESS', bucket: 'pass' }]));
  const r = run(['12', '--repo', 'o/n', '--once']);
  ok('CLI: green check exits 0', r.status === 0 && /checks-green/.test(r.stdout));
}
{
  writeFileSync(join(dir, 'checks.json'), JSON.stringify([]));
  const r = run(['12', '--once']);
  ok('CLI: empty rollup exits 3 (pending), never 0', r.status === 3 && /no-checks/.test(r.stdout));
}
{
  writeFileSync(join(dir, 'view.json'), JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN' }));
  const r = run(['12', '--once']);
  ok('CLI: merged PR exits 0', r.status === 0 && /merged/.test(r.stdout));
}
{
  const r = run([]);
  ok('CLI: missing PR arg exits 2', r.status === 2);
}
{
  const r = run(['12', '--until', 'bogus']);
  ok('CLI: bad --until exits 2', r.status === 2);
}
{
  // gh absent entirely — the dead-gate class: must exit 2, never silent.
  const r = run(['12', '--once'], { ...env, PR_WAIT_GH: 'definitely-not-a-real-binary-xyz', PR_WAIT_GH_PREFIX: '' });
  ok('CLI: missing gh exits 2 with an error line', r.status === 2 && /pr-wait: error/.test(r.stdout));
}
{
  const r = run(['12', '--interval', '0', '--once']);
  ok('CLI: non-positive --interval exits 2', r.status === 2);
}

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
