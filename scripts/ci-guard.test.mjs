#!/usr/bin/env node
/**
 * Fail-first test for scripts/ci-guard.mjs.
 *
 * The guard exists because CI went DARK for two releases (v0.1.25, v0.1.26)
 * without a single red X: the step added in v0.1.25 carried TWO `run:` keys in
 * one step item, which is invalid YAML, so GitHub never built the job. Every run
 * failed at 0s with "failed because of a workflow file issue" and `--log-failed`
 * answered "log not found" — no job existed to log. The local gate (pre-commit)
 * stayed green the whole time, so the receipt the owner read (the CI email) was
 * red while every claim I made about the gates was true. That is the
 * "verify the artifact the user reads, never a proxy" rule, repeating.
 *
 * Every case below reproduces a REAL broken shape — starting with the incident
 * verbatim — plus the counter-direction that a sound workflow passes and the
 * counter-direction that INVALID YAML is reported as invalid (a guard that
 * cannot fail on the incident's own shape is a rubber stamp).
 *
 * Run: node scripts/ci-guard.test.mjs   (exit 0 = all expectations hold)
 */
import { checkWorkflow } from './ci-guard.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// Every expectation drives the SAME pure function the CLI drives, and M5's
// script resolution is stubbed: these cases are about workflow SHAPE, so they
// must not fail because a case's fictional step names a script this repo does
// not ship.
const sound = () => checkWorkflow(SOUND, { resolveScript: () => null });
const on = (text) => checkWorkflow(text, { resolveScript: () => null });

// A minimal, structurally sound workflow: two jobs, two steps, standard keys.
const SOUND = [
  'name: CI',
  '',
  'on:',
  '  push:',
  '    branches: [master]',
  '',
  'jobs:',
  '  validate:',
  '    name: Structural validation',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5',
  '      - name: Validate structure',
  '        run: node scripts/validate.mjs',
  '  windows:',
  '    name: Validate on Windows',
  '    runs-on: windows-latest',
  '    steps:',
  '      - name: Validate structure',
  '        run: node scripts/validate.mjs',
  '',
].join('\n');

// A1/A2. Counter-direction: a sound workflow passes, and the guard reports what
// it saw. Without this, "always report" would satisfy every case below.
{
  const { errors, stats } = await sound();
  check('A1 a structurally sound workflow passes', errors.length === 0, JSON.stringify(errors));
  check(
    'A2 it counted the jobs and steps it saw',
    stats.jobs === 2 && stats.steps.length === 3,
    JSON.stringify(stats),
  );
}

// B1. The incident verbatim: one step item carrying `run:` TWICE. That is a
// duplicate key — invalid YAML — and GitHub then never builds the job at all.
{
  const broken = SOUND.replace(
    '      - name: Validate structure\n        run: node scripts/validate.mjs\n  windows:',
    '      - name: Validate structure\n        run: node scripts/validate.mjs\n        run: node scripts/changelog-guard.test.mjs\n  windows:',
  );
  const { errors, valid } = await on(broken);
  check('B1a the duplicated `run:` key is reported as invalid YAML', valid === false, JSON.stringify({ valid, errors }));
  check(
    'B1b the message names the duplicated key and where it is',
    errors.some((e) => /invalid YAML/i.test(e) && /run/.test(e) && /line \d+/.test(e)),
    JSON.stringify(errors),
  );
}

// B2. The other half of the incident's cost: no other local gate read ci.yml, so
// the shape had to be checkable WITHOUT a YAML parser on the machine. The same
// duplicate-key shape must therefore also be reported structurally.
{
  const broken = SOUND.replace(
    '      - name: Validate structure\n        run: node scripts/validate.mjs\n  windows:',
    '      - name: Validate structure\n        run: node scripts/validate.mjs\n        run: node scripts/changelog-guard.test.mjs\n  windows:',
  );
  const { errors } = await on(broken);
  check(
    'B2 the duplicated key is also caught structurally (no parser needed)',
    errors.some((e) => /duplicate/i.test(e) && /run/.test(e)),
    JSON.stringify(errors),
  );
}

// C1. A step that runs nothing: it has a name but neither `uses:` nor `run:`.
// GitHub fails this at build time too, and it is the shape a badly-split step
// leaves behind (the fix for the incident was exactly "split one step in two").
{
  const broken = SOUND.replace(
    '      - name: Validate structure\n        run: node scripts/validate.mjs\n  windows:',
    '      - name: Validate structure\n  windows:',
  );
  const { errors } = await on(broken);
  check(
    'C1 a step with neither `uses:` nor `run:` is reported',
    errors.some((e) => /neither/i.test(e)),
    JSON.stringify(errors),
  );
}

// C2. A step with BOTH `uses:` and `run:` — the mirror-image mistake, also a
// build-time failure.
{
  const broken = SOUND.replace(
    '      - name: Validate structure\n        run: node scripts/validate.mjs\n  windows:',
    '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5\n        run: node scripts/validate.mjs\n  windows:',
  );
  const { errors } = await on(broken);
  check(
    'C2 a step with both `uses:` and `run:` is reported',
    errors.some((e) => /both/i.test(e)),
    JSON.stringify(errors),
  );
}

// D1. No `jobs:` mapping at all — the file would be a no-op workflow that still
// reports "success" on the commit, which is a silent failure by another route.
{
  const broken = 'name: CI\n\non:\n  push:\n    branches: [master]\n';
  const { errors } = await on(broken);
  check('D1 a workflow with no jobs is reported', errors.some((e) => /no `jobs:`/i.test(e)), JSON.stringify(errors));
}

// D2. A job with no steps — same class: a job that cannot fail anything.
// The replacement ENDS the `validate` job's step block at the first step
// (`steps: []` immediately) and so also deletes the `windows:` job's steps key
// as a side effect; `validate` is what the case is about. The previous version
// of this case could not match its own anchor at all — the `name:`/`run:` pair
// sits one step later in SOUND than the pattern assumed — so it asserted against
// an unchanged string and failed on a guard that was already correct. Fixed in
// the TEST, not by bending the artifact (fifth occurrence of this pattern in
// this ledger: suspect the check before the artifact).
{
  const broken = SOUND.replace('    steps:\n      - uses: actions/checkout', '    steps: []\n      - uses: actions/checkout');
  check('D2 the case actually mutates the sound workflow', broken !== SOUND);
  const { errors } = await on(broken);
  check(
    'D2 a job with an empty step list is reported',
    errors.some((e) => /validate/.test(e) && /empty|no steps/i.test(e)),
    JSON.stringify(errors),
  );
}

// F1/F2. A TAB in indentation. YAML forbids tabs as indentation, so a workflow
// carrying one is not parseable — the same class as the duplicated `run:` key
// (the file does not build and no job log exists to read). It is the one member
// of that class the structural walk does NOT catch by construction, because a
// tab-indented step line still reads as a step line: the walk cannot fail on a
// shape it never examines, so the shape gets its own check. F2 is the
// counter-direction — a tab INSIDE a value is legal and must not be flagged.
{
  const broken = SOUND.replace('      - name: Validate structure', '\t- name: Validate structure');
  check('F1 the case actually inserts a tab', broken !== SOUND);
  const { errors, valid } = await on(broken);
  check(
    'F1a tab indentation is reported',
    errors.some((e) => /tab/i.test(e) && /line 1[0-9]/.test(e)),
    JSON.stringify(errors),
  );
  check('F1b a file with tab indentation is not reported as valid YAML', valid === false, JSON.stringify({ valid, errors }));
}
{
  const legal = SOUND.replace('run: node scripts/validate.mjs', 'run: echo "a\tb"');
  const { errors } = await on(legal);
  check(
    'F2 a tab inside a value is NOT reported (tabs are only illegal as indentation)',
    !errors.some((e) => /tab/i.test(e)),
    JSON.stringify(errors),
  );
}

// E1. The real artifact, dogfooded: the committed .github/workflows/ci.yml must
// pass. This is the case that would have caught the incident on the day it
// landed, and it is the one that keeps the guard honest about this repo.
{
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const target = resolve(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');
  const { errors, stats } = await checkWorkflow(readFileSync(target, 'utf8'));
  check(`E1 the committed ci.yml passes (${stats.jobs} job(s), ${stats.steps.length} step(s))`, errors.length === 0, JSON.stringify(errors));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failing expectation(s)`);
process.exit(failures === 0 ? 0 : 1);
