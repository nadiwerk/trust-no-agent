#!/usr/bin/env node
/**
 * record-test-evidence — the EXPLICIT evidence path (Opsi B, 2026-10-26).
 *
 * WHY THIS EXISTS
 * ---------------
 * The automatic recorder listens for a `PostToolUse` / `tools/result` event. On
 * two harnesses that event is not delivered at all, measured the same day:
 *
 *   Claude Code 2.1.305   PreToolUse fired 3x for a green vitest run; PostToolUse 0x
 *   Codex 0.163.0         prints "hook: PostToolUse Completed", executes nothing
 *
 * So a green suite wrote no evidence, and every commit stayed refused: the gate
 * could DENY but never OPEN. An event that never arrives cannot be repaired from
 * inside the hook — the honest alternative is a command the agent runs itself,
 * which refuses to write anything it cannot VERIFY.
 *
 * THE RULE THIS MUST NEVER BREAK (from the report that proposed this option):
 *   "Menulis testPassFresh: true manual tanpa run test (itu pemalsuan receipt)."
 * There is no `--pass` flag. Evidence is written only when this script can see a
 * test runner's own output: a runner signature, a pass count, and no failure.
 *
 * Usage:
 *   node scripts/record-test-evidence.mjs --from-log <file> --command "<test command>"
 *   node scripts/record-test-evidence.mjs --run <command...>
 *
 * Exit 0 = evidence written. Exit 1 = refused, with the reason named.
 * Zero dependencies.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join('.trust', 'tna-gate-state.json');

/**
 * Runner signatures — the proof that a TEST FRAMEWORK produced this text, not a
 * human typing "all green". Deliberately specific: a bare "passed" is not a
 * signature, because anyone can write it.
 */
const RUNNER_SIGNATURES = [
  /Test Files\s+\d+\s+(passed|failed)/i,          // vitest
  /Tests:\s+.*\d+\s+passed/i,                      // jest
  /\d+\s+passed.*\n.*\d+\s+failed/i,               // jest (combined)
  /=====.*\d+\s+passed.*=====/i,                   // pytest
  /test result:\s+(ok|FAILED)/i,                   // cargo
  /^(ok|FAIL)\s+\S+\s+[\d.]+s$/m,                  // go test
  /\bALL PASS\b/i,                                 // node:test / project runners
  /# tests\s+\d+/i,                                // node --test summary
];

/** Failure markers that veto a pass even when a pass count is present. */
const FAILURE_MARKERS = [
  /\d+\s+failed/i,
  /test result:\s+FAILED/i,
  /^\s*FAIL\b/m,
  /\b[1-9]\d*\s+failing\b/i,
  /✗|✕|❯\s+\S+\.test\./,
];

/** A test runner must be NAMED by the command. */
const RUNNER_COMMAND = /(vitest|jest|pytest|cargo\s+test|go\s+test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+(run\s+)?test|bun\s+test|node\s+\S*\.test\.|deno\s+test|python\s+-m\s+pytest)/i;

/** Did the recorded command actually invoke a test runner? */
export function isTestCommand(command) {
  return RUNNER_COMMAND.test(String(command ?? ''));
}

/**
 * Verify a captured test-run log. Returns { ok, reason }.
 * Refuses when the text has no runner signature, when a failure marker is
 * present, or when there is no pass evidence at all.
 */
export function verifyLog(text) {
  const body = String(text ?? '');
  if (body.trim() === '') return { ok: false, reason: 'the log is empty' };

  const signature = RUNNER_SIGNATURES.find((re) => re.test(body));
  if (!signature) {
    return { ok: false, reason: 'no test-runner signature in the log (a runner prints its own summary; prose is not proof)' };
  }
  const failure = FAILURE_MARKERS.find((re) => re.test(body));
  if (failure) {
    return { ok: false, reason: `the log reports failures (${failure})` };
  }
  return { ok: true, reason: 'runner signature present, no failure marker' };
}

/** Write the evidence file. Refuses an unknown outcome (never a guessed pass). */
export function writeEvidence(dir, { command }) {
  if (!isTestCommand(command)) return { ok: false, reason: `the command does not name a test runner: ${JSON.stringify(command)}` };
  try {
    mkdirSync(join(dir, '.trust'), { recursive: true });
    writeFileSync(
      join(dir, STATE_FILE),
      `${JSON.stringify({ testPassFresh: true, command, updatedAt: new Date().toISOString(), source: 'record-test-evidence' }, null, 2)}\n`,
    );
    return { ok: true, reason: 'evidence written' };
  } catch (e) {
    return { ok: false, reason: `could not write the state file: ${e?.message ?? e}` };
  }
}

function usage() {
  console.error('usage:');
  console.error('  node scripts/record-test-evidence.mjs --from-log <file> --command "<test command>"');
  console.error('  node scripts/record-test-evidence.mjs --run <test command...>');
  console.error('');
  console.error('There is deliberately no --pass flag: evidence is written only from a');
  console.error('runner\'s own output, because a bare claim is a forged receipt.');
}

function main() {
  const args = process.argv.slice(2);
  const dir = process.cwd();

  // --pass must never be accepted; name it explicitly so the refusal is legible.
  if (args.includes('--pass') || args.includes('--force')) {
    console.error('refused: evidence cannot be asserted. There is no --pass/--force flag — run the test and let its output be verified.');
    process.exit(1);
  }

  const at = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const logPath = at('--from-log');
  const explicitCommand = at('--command');
  const runAt = args.indexOf('--run');

  if (logPath) {
    if (!existsSync(logPath)) {
      console.error(`refused: log not found: ${logPath}`);
      process.exit(1);
    }
    const command = explicitCommand ?? '';
    if (!isTestCommand(command)) {
      console.error(`refused: --command must name the test runner that produced the log (got ${JSON.stringify(command)})`);
      process.exit(1);
    }
    const verdict = verifyLog(readFileSync(logPath, 'utf8'));
    if (!verdict.ok) {
      console.error(`refused: ${verdict.reason}`);
      process.exit(1);
    }
    const written = writeEvidence(dir, { command });
    if (!written.ok) { console.error(`refused: ${written.reason}`); process.exit(1); }
    console.log(`evidence written: ${command}`);
    console.log(`verified: ${verdict.reason}`);
    process.exit(0);
  }

  if (runAt >= 0) {
    const argv = args.slice(runAt + 1).filter((a) => a !== '--');
    if (argv.length === 0) { usage(); process.exit(1); }
    const command = argv.join(' ');
    if (!isTestCommand(command)) {
      console.error(`refused: --run must invoke a test runner (got ${JSON.stringify(command)})`);
      process.exit(1);
    }
    // Run it through the shell so npm/npx resolve as the user expects.
    const r = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 30 * 60 * 1000 });
    const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    if (r.status !== 0) {
      console.error(`refused: the test run exited ${r.status}`);
      process.exit(1);
    }
    // In --run mode THIS SCRIPT observed the process: the exit status is first-hand
    // evidence, so a silent green run (a suite that prints nothing) is still valid.
    // That is the one case the signature check cannot cover — and the one case
    // where trusting the status is not a guess, because we watched it happen.
    // A failure marker in the output still vetoes.
    const failure = FAILURE_MARKERS.find((re) => re.test(text));
    if (failure) {
      console.error(`refused: the run exited 0 but its output reports failures (${failure})`);
      process.exit(1);
    }
    const written = writeEvidence(dir, { command });
    if (!written.ok) { console.error(`refused: ${written.reason}`); process.exit(1); }
    console.log(`evidence written: ${command}`);
    console.log(`verified: exit status 0 observed by this script${text.trim() ? ', no failure marker in the output' : ' (the run printed nothing)'}`);
    process.exit(0);
  }

  usage();
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('record-test-evidence.mjs')) main();
