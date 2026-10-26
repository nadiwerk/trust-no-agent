#!/usr/bin/env node
/**
 * Fail-first test for the EXPLICIT EVIDENCE PATH (Opsi B).
 *
 * WHY THIS EXISTS — measured 2026-10-26 on two harnesses:
 *
 *   Claude Code 2.1.305  PreToolUse fired 3x for a green vitest run, PostToolUse 0x.
 *   Codex 0.163.0        prints "hook: PostToolUse Completed" and executes nothing.
 *
 * In both, the recorder had no event to listen to, so a green suite wrote no
 * evidence and every commit stayed refused. The gate could DENY but never OPEN.
 * An event that is not delivered cannot be repaired from inside the hook.
 *
 * The honest alternative: an EXPLICIT command the agent runs after a test, which
 * REFUSES to write evidence unless it can verify that a test actually ran and
 * passed. The report that proposed this named the one thing it must never become:
 * "menulis testPassFresh: true manual tanpa run test (itu pemalsuan receipt)".
 *
 * Contract:
 *   record-test-evidence.mjs --from-log <file>   verify a captured run, then write
 *   record-test-evidence.mjs --run <command...>  run it, verify, then write
 *   never writes on: no test runner, red exit, missing log, unparseable output,
 *                    or a --pass flag with nothing behind it
 *
 * Seam: the CLI (a subprocess), asserting on the state file it writes.
 * Zero dependencies. Run: node scripts/record-evidence.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'record-test-evidence.mjs');
const STATE_REL = join('.trust', 'tna-gate-state.json');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const repo = () => {
  const d = mkdtempSync(join(tmpdir(), 'tna-evidence-'));
  mkdirSync(join(d, '.trust'), { recursive: true });
  return d;
};
const state = (d) => (existsSync(join(d, STATE_REL)) ? JSON.parse(readFileSync(join(d, STATE_REL), 'utf8')) : null);
const runCli = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000 });

// ---- E1. A verified green log writes evidence ----
{
  const d = repo();
  const log = join(d, 'run.log');
  writeFileSync(log, [
    ' RUN  v3.2.7 C:/Users/Lenovo/projects/ads-tracker',
    ' ✓ src/test/db-heavy/admin-login-audit.test.ts (3 tests) 2195ms',
    ' Test Files  1 passed (1)',
    '      Tests  3 passed (3)',
  ].join('\n'));
  const r = runCli(['--from-log', log, '--command', 'npx vitest run --config vitest.db-heavy.config.ts src/test/db-heavy/admin-login-audit.test.ts'], d);
  check('E1 exits 0 on a verified green log', r.status === 0, `${r.stdout}${r.stderr}`.slice(-200));
  check('E1b writes testPassFresh=true', state(d)?.testPassFresh === true, JSON.stringify(state(d)));
  check('E1c records the command that produced it', /vitest/.test(String(state(d)?.command ?? '')), String(state(d)?.command));
  rmSync(d, { recursive: true, force: true });
}

// ---- E2. A RED log writes nothing ----
{
  const d = repo();
  const log = join(d, 'run.log');
  writeFileSync(log, [
    ' ✓ src/a.test.ts (1 test)',
    ' ❯ src/b.test.ts (2 tests | 1 failed)',
    ' Test Files  1 failed | 1 passed (2)',
    '      Tests  1 failed | 2 passed (3)',
  ].join('\n'));
  const r = runCli(['--from-log', log, '--command', 'npx vitest run'], d);
  check('E2 a red log is refused (non-zero exit)', r.status !== 0, String(r.status));
  check('E2b nothing is written', state(d) === null, JSON.stringify(state(d)));
  rmSync(d, { recursive: true, force: true });
}

// ---- E3. A log with no test runner signature writes nothing ----
// This is the forgery hole: pasting arbitrary text and calling it a test run.
{
  const d = repo();
  const log = join(d, 'run.log');
  writeFileSync(log, 'everything is fine, trust me\nall good\n');
  const r = runCli(['--from-log', log, '--command', 'npx vitest run'], d);
  check('E3 an unverifiable log is refused', r.status !== 0, String(r.status));
  check('E3b nothing is written', state(d) === null, JSON.stringify(state(d)));
  rmSync(d, { recursive: true, force: true });
}

// ---- E4. A missing log file writes nothing ----
{
  const d = repo();
  const r = runCli(['--from-log', join(d, 'nope.log'), '--command', 'npm test'], d);
  check('E4 a missing log is refused', r.status !== 0, String(r.status));
  check('E4b nothing is written', state(d) === null);
  rmSync(d, { recursive: true, force: true });
}

// ---- E5. The command must actually be a test run ----
{
  const d = repo();
  const log = join(d, 'run.log');
  writeFileSync(log, ' Test Files  1 passed (1)\n      Tests  3 passed (3)\n');
  const r = runCli(['--from-log', log, '--command', 'git status'], d);
  check('E5 a non-test command is refused even with a green log', r.status !== 0, String(r.status));
  check('E5b nothing is written', state(d) === null);
  rmSync(d, { recursive: true, force: true });
}

// ---- E6. No --pass flag exists: a bare claim cannot write evidence ----
{
  const d = repo();
  const r = runCli(['--pass'], d);
  check('E6 --pass is not accepted', r.status !== 0, String(r.status));
  check('E6b nothing is written', state(d) === null);
  rmSync(d, { recursive: true, force: true });
}

// ---- E7. --run executes the test itself and records the real outcome ----
{
  const d = repo();
  writeFileSync(join(d, 'x.test.mjs'), 'process.exit(0);\n');
  const r = runCli(['--run', 'node', 'x.test.mjs'], d);
  check('E7 --run with a green test writes evidence', state(d)?.testPassFresh === true,
    `${r.stdout}${r.stderr}`.slice(-160) + ' state=' + JSON.stringify(state(d)));
  rmSync(d, { recursive: true, force: true });

  const d2 = repo();
  writeFileSync(join(d2, 'x.test.mjs'), 'console.error("boom"); process.exit(1);\n');
  const r2 = runCli(['--run', 'node', 'x.test.mjs'], d2);
  check('E7b --run with a red test is refused', r2.status !== 0, String(r2.status));
  check('E7c and writes nothing', state(d2) === null, JSON.stringify(state(d2)));
  rmSync(d2, { recursive: true, force: true });
}

// ---- E8. The written state is FRESH, so the gate can actually open ----
{
  const d = repo();
  const log = join(d, 'run.log');
  writeFileSync(log, ' Test Files  1 passed (1)\n      Tests  3 passed (3)\n');
  runCli(['--from-log', log, '--command', 'npm test'], d);
  const s = state(d);
  const age = Date.now() - Date.parse(s?.updatedAt ?? '');
  check('E8 the timestamp is current (not the stale 2026-10-23 value)', Number.isFinite(age) && age < 60_000, String(s?.updatedAt));
  rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
