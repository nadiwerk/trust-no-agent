#!/usr/bin/env node
/**
 * Fail-first test for RECORDER RUNNER COVERAGE on the canonical path.
 *
 * WHY THIS EXISTS — measured on a real adopter (ads-tracker, Claude Code,
 * plugin 0.1.50), 2026-10-26:
 *
 *   state file: {"command":"npm test 2>&1 | tail -15","updatedAt":"2026-10-23..."}
 *   the agent ran:  npx vitest run --config vitest.db-heavy.config.ts <file>   (green)
 *   then:           every `git commit` refused — "no fresh test evidence"
 *
 * The recorder only knew `*.test.mjs`, `npm test` and `bun test`. A vitest/jest/
 * pytest/cargo/go project could therefore never record evidence: the gate could
 * DENY but never OPEN — the wall this framework exists to prevent. Replaying a
 * real PostToolUse payload with `exitCode: 0` against the installed hook wrote
 * NOTHING, for all four response shapes.
 *
 * The three ADAPTERS already learned these runners (pi/omp/dsh, 2026-10-25); the
 * canonical path used by Claude Code and Codex had not. This pins it.
 *
 * Seam: observeAfter(dir, input, output) — the same seam gate-hook calls.
 * Zero dependencies. Run: node scripts/recorder-runners.test.mjs
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, fileURLToPath as fu } from 'node:url';
import { observeAfter, readState } from './tna-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const STATE_REL = join('.trust', 'tna-gate-state.json');

/** Run one PostToolUse-shaped call and report what the state file says. */
function record(command, response = { stdout: 'passed', exitCode: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'tna-runners-'));
  const out = observeAfter(dir, { tool: 'PowerShell', args: { command } }, response);
  const state = existsSync(join(dir, STATE_REL)) ? JSON.parse(readFileSync(join(dir, STATE_REL), 'utf8')) : null;
  rmSync(dir, { recursive: true, force: true });
  return { out, state };
}

// ---- R1. The runners that real projects use must record evidence ----
{
  const RUNNERS = [
    ['npx vitest run src/x.test.ts', 'vitest (the ads-tracker command)'],
    // A `cd X; test` chain is deliberately absent: after the roast-r1 F7
    // evidence-binding fix, a `;` separator means the runner executes whether
    // or not the cd succeeded — the execution dir is unprovable, and an
    // unprovable dir certifies NOTHING (records nowhere). The `&&` form is
    // pinned below as its own case.
    ['vitest run', 'bare vitest'],
    ['npx jest src/x.test.ts', 'jest'],
    ['jest --ci', 'bare jest'],
    ['pytest -q', 'pytest'],
    ['python -m pytest tests/', 'python -m pytest'],
    ['cargo test', 'cargo test'],
    ['go test ./...', 'go test'],
    ['npm test', 'npm test (already worked)'],
    ['npm run test:unit', 'npm run test:*'],
    ['pnpm test', 'pnpm test'],
    ['yarn test', 'yarn test'],
    ['node x.test.mjs', 'node *.test.mjs (already worked)'],
    ['bun test', 'bun test (already worked)'],
  ];
  for (const [command, label] of RUNNERS) {
    const { out, state } = record(command);
    // observeAfter returns the written state object (not `true`), or null.
    check(`R1 records evidence: ${label}`, state?.testPassFresh === true && out !== null,
      `out=${JSON.stringify(out)} state=${JSON.stringify(state)}`);
  }
  // A cd prefix followed by `&&` binds the evidence to the RESOLVED dir —
  // the dest must exist for the binding to be provable (roast r1 F7). The
  // evidence lands in `repo`, and the payload dir keeps nothing.
  {
    const dir = mkdtempSync(join(tmpdir(), 'tna-runners-'));
    mkdirSync(join(dir, 'repo'));
    const out = observeAfter(dir, { tool: 'PowerShell', args: { command: 'cd repo && npx vitest run src/x.test.ts' } }, { stdout: 'passed', exitCode: 0 });
    const destState = existsSync(join(dir, 'repo', STATE_REL)) ? JSON.parse(readFileSync(join(dir, 'repo', STATE_REL), 'utf8')) : null;
    check('R1 records evidence: vitest behind a cd prefix (binds to the resolved dir)',
      destState?.testPassFresh === true && out !== null && !existsSync(join(dir, STATE_REL)),
      `out=${JSON.stringify(out)} dest=${JSON.stringify(destState)}`);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- R2. A RED run must record false, not nothing and not true ----
{
  const { state } = record('npx vitest run src/x.test.ts', { stdout: 'FAIL 1', exitCode: 1 });
  check('R2 a red vitest run records testPassFresh=false', state?.testPassFresh === false, JSON.stringify(state));
}

// ---- R3. Non-test commands still record NOTHING (no false evidence) ----
{
  const NOT_TESTS = [
    'git status',
    'npm run build',
    'node deploy.mjs',
    'npx tsc --noEmit',
    'echo "npm test"',
    'cat vitest.config.ts',
    'npm install',
  ];
  for (const command of NOT_TESTS) {
    const { out, state } = record(command);
    check(`R3 records nothing: ${command}`, out === null && state === null,
      `out=${out} state=${JSON.stringify(state)}`);
  }
}

// ---- R4. A mention is not a run ----
{
  const { out } = record('git commit -m "run npx vitest run before this"');
  check('R4 a quoted mention records nothing', out === null, String(out));
}

// ---- R5. A compound line only counts when the TEST is last ----
// A shell reports the LAST command's status; anything after the test makes the
// exit code unattributable (the dsh round found this the hard way).
{
  const AFTER = record('npx vitest run; echo done');
  check('R5a a trailing non-test command records nothing', AFTER.out === null, String(AFTER.out));

  // A leading `cd repo &&` moves the evidence WITH the resolved dir (the
  // BB-thread shape): the dest exists so the binding is provable — evidence
  // lands in `repo`, never in the payload dir it was recorded under.
  {
    const dir = mkdtempSync(join(tmpdir(), 'tna-runners-'));
    mkdirSync(join(dir, 'repo'));
    const out = observeAfter(dir, { tool: 'PowerShell', args: { command: 'cd repo && npx vitest run src/x.test.ts' } }, { stdout: 'passed', exitCode: 0 });
    const destState = existsSync(join(dir, 'repo', STATE_REL)) ? JSON.parse(readFileSync(join(dir, 'repo', STATE_REL), 'utf8')) : null;
    check('R5b a leading cd still records evidence, bound to the resolved dir',
      destState?.testPassFresh === true && out !== null && !existsSync(join(dir, STATE_REL)),
      `dest=${JSON.stringify(destState)}`);
    rmSync(dir, { recursive: true, force: true });
  }

  const CHAIN = record('npx vitest run && git commit -m x');
  check('R5c a trailing commit records nothing', CHAIN.out === null, String(CHAIN.out));
}

// ---- R6. The ads-tracker scenario end to end ----
// The report's exact command used a `;` separator. Under the roast-r1 F7
// evidence-binding contract that shape is honestly UNPROVABLE — the runner
// executes regardless of the cd's fate, so nothing is recorded anywhere
// (crediting either dir would be the laundering hole F7 closed). The `&&`
// form is the provable spelling: the resolved dest owns the evidence.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-adstracker-'));
  const project = join(dir, 'ads-tracker');
  mkdirSync(project);
  const semicolon = `cd ${project}; npx vitest run --config vitest.db-heavy.config.ts src/test/db-heavy/import-replace-owner-only.test.ts`;
  observeAfter(dir, { tool: 'PowerShell', args: { command: semicolon } }, { stdout: 'Test Files 1 passed', exitCode: 0 });
  check('R6a a `cd X; test` chain records nothing (execution dir unprovable)',
    readState(dir).testPassFresh !== true && !existsSync(join(project, STATE_REL)),
    `dir=${JSON.stringify(readState(dir))}`);

  const anded = `cd ${project} && npx vitest run --config vitest.db-heavy.config.ts src/test/db-heavy/import-replace-owner-only.test.ts`;
  const out = observeAfter(dir, { tool: 'PowerShell', args: { command: anded } }, { stdout: 'Test Files 1 passed', exitCode: 0 });
  const destState = existsSync(join(project, STATE_REL)) ? JSON.parse(readFileSync(join(project, STATE_REL), 'utf8')) : null;
  check('R6b the `cd X && test` spelling writes fresh evidence to the resolved dir',
    destState?.testPassFresh === true && out !== null && !existsSync(join(dir, STATE_REL)),
    `dest=${JSON.stringify(destState)}`);
  check('R6c the state records the command that produced it', /vitest/.test(String(destState?.command)), String(destState?.command));
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
