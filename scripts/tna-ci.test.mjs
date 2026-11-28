#!/usr/bin/env node
/**
 * Fail-first test for scripts/tna-ci.mjs — run ci.yml locally, verbatim.
 * Zero dependencies. Run: node scripts/tna-ci.test.mjs
 *
 * Seam: parseSteps(ciText) -> [{name, run}] and the CLI --list mode. The
 * class bug this kills is "green locally, red on CI" — the parity must be
 * mechanical, not aspirational.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSteps } from './tna-ci.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const CI_FIXTURE = `name: CI
jobs:
  validate:
    steps:
      - uses: actions/checkout@abc
      - name: Validate structure
        run: node scripts/validate.mjs
      - name: Eval consistency
        run: node scripts/eval.mjs
      - name: Broken step
        run: node scripts/does-not-exist.mjs
  other-job:
    steps:
      - name: Other step
        run: echo should-not-appear
`;

// ---- A. parseSteps extracts run steps in order, uses-steps skipped ----
{
  const steps = parseSteps(CI_FIXTURE);
  check('A1 three run steps found', steps.length === 3, JSON.stringify(steps.map((s) => s.name)));
  check('A2 order + commands preserved',
    steps[0].run === 'node scripts/validate.mjs' && steps[1].name === 'Eval consistency');
  check('A3 steps outside the validate job are excluded',
    steps.every((s) => s.name !== 'Other step'), JSON.stringify(steps));
}

// ---- B. The real ci.yml parses and contains the new gates ----
{
  const { readFileSync } = await import('node:fs');
  const real = parseSteps(readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8'));
  check('B1 real ci.yml yields run steps', real.length > 50, `found ${real.length}`);
  check('B2 coverage + secrets steps present',
    real.some((s) => s.run === 'node scripts/coverage.mjs')
    && real.some((s) => s.run === 'node scripts/secrets-scan.mjs --tree'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
