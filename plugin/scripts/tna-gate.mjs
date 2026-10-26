#!/usr/bin/env node
/**
 * tna-gate — the veto core behind the opencode plugin.
 * Spec: docs/specs/hardening-general.md (ticket 02-veto-opencode-state, AC1).
 *
 * Two halves with one seam between them:
 *
 *   observeAfter(dir, input, output) — records session evidence: a shell-tool test
 *     command (`.test.mjs`) that exits clean sets testPassFresh true; one
 *     that errors sets it false, explicitly (a stale true after a red run is
 *     the hole this exists to close). Anything else returns null and touches
 *     nothing. State lives in <project>/.trust/ (gitignored, private) —
 *     never in model memory.
 *
 *   decideBefore({ dir, tool, args }) — classifies via action-gate.mjs
 *     (ticket 01) against the recorded evidence. Returns { allow, reason };
 *     the plugin thin layer throws on allow:false (the opencode veto
 *     contract: deny by throwing). Absent/corrupt state reads as
 *     testPassFresh:false — no evidence means deny for irreversible actions
 *     (spec self-review decision), never silent allow.
 *
 * Zero dependencies (node builtins only). The opencode plugin itself is
 * .opencode/plugins/tna-gate.js — a thin adapter over these functions, so
 * the veto is fixture-testable here without a live opencode runtime.
 *
 * Attribution: original implementation. No external code or assets used.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyAction, SHELL_TOOLS } from './action-gate.mjs';

const STATE_FILE = 'tna-gate-state.json';
const LOG_FILE = 'tna-gate-log.jsonl';

/**
 * How long a green test run counts as evidence — ONE definition for every path
 * (canonical hook + all three adapters).
 *
 * Origin 2026-10-25 (audit-run-blockers #3, measured): `updatedAt` was written by
 * four recorders and read by NONE, so this repo's own 2026-10-23 state still
 * opened the gate on 2026-10-25. Trust decays with time, not only with failure.
 */
export const EVIDENCE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * @returns {{testPassFresh: boolean, command?: string, updatedAt?: string, stale?: boolean}}
 */
export function readState(dir) {
  try {
    const raw = readFileSync(join(String(dir), '.trust', STATE_FILE), 'utf8');
    const s = JSON.parse(raw);
    if (s && typeof s === 'object' && typeof s.testPassFresh === 'boolean') {
      // A stale or undated claim is NOT evidence (fail-closed to "no evidence").
      if (s.testPassFresh === true) {
        const age = Date.now() - Date.parse(s.updatedAt ?? '');
        if (!Number.isFinite(age) || age < 0 || age > EVIDENCE_MAX_AGE_MS) {
          return { ...s, testPassFresh: false, stale: true };
        }
      }
      return s;
    }
  } catch {
    /* absent or corrupt state is not evidence — fall through to deny */
  }
  return { testPassFresh: false };
}

function writeState(dir, state) {
  mkdirSync(join(String(dir), '.trust'), { recursive: true });
  writeFileSync(join(String(dir), '.trust', STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  return state;
}

/**
 * Append one denial to the veto-fire log (the meter's first source). Returns
 * true when the line landed, false otherwise — logging must NEVER break the
 * veto it records, so every failure is silent by contract.
 *
 * Origin 2026-10-25 (audit-run-blockers #14, measured): `join(String(dir), …)`
 * turned a non-string `cwd` from a hook payload into the literal directory
 * `[object Object]`, CREATED it in the process cwd, and returned `true` — so the
 * meter believed the denial was recorded while it landed in a junk folder. The
 * repo still carries the evidence of that run. A path that is not a non-empty
 * string is now refused instead of coerced.
 */
export function logVeto(dir, { harness = 'unknown', tool = '', command = '' } = {}) {
  if (typeof dir !== 'string' || dir.trim() === '') return false;
  try {
    mkdirSync(join(dir, '.trust'), { recursive: true });
    appendFileSync(
      join(dir, '.trust', LOG_FILE),
      JSON.stringify({ ts: new Date().toISOString(), harness, tool, command }) + '\n',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify a pending tool call against the recorded evidence.
 * @returns {{allow: boolean, reason: string}} fresh object per call
 */
export function decideBefore({ dir, tool = '', args = {} } = {}) {
  const state = readState(dir);
  const v = classifyAction({ tool, args, evidence: { testPassFresh: state.testPassFresh === true } });
  return v.gated ? { allow: false, reason: v.reason } : { allow: true, reason: v.reason };
}

/**
 * Store-backed variants for runtimes where hook FS-writes vanish (opencode
 * V2, proven live 2026-10-12). Same boundary, same deny-safe defaults —
 * the store only changes WHERE evidence persists, never what gates.
 */
export async function decideBeforeWith(store, { tool = '', args = {} } = {}) {
  let state = { testPassFresh: false };
  try {
    state = await store.readState();
  } catch {
    /* unreadable store is not evidence */
  }
  const v = classifyAction({ tool, args, evidence: { testPassFresh: state.testPassFresh === true } });
  return v.gated ? { allow: false, reason: v.reason } : { allow: true, reason: v.reason };
}

export async function logVetoWith(store, entry = {}) {
  try {
    return await store.logVeto(entry);
  } catch {
    return false;
  }
}

/**
 * Store-backed test-evidence recorder for runtimes where hook FS-writes
 * vanish (opencode V2, proven live 2026-10-12). Same TEST_RUN boundary as
 * observeAfter; `pass` must be an explicit boolean — an unknown outcome
 * records nothing (a guessed pass is the forgery hole again).
 * @returns {boolean|null} recorded pass/fail, or null when not a test run
 */
export async function observeAfterWith(store, { tool = '', command = '', pass = null } = {}) {
  if (!SHELL_TOOLS.has(String(tool ?? '').toLowerCase())) return null;
  if (!recordedTestRun(command)) return null;
  if (typeof pass !== 'boolean') return null;
  try {
    await store.writeState({ testPassFresh: pass, command: String(command) });
    return pass;
  } catch {
    return null;
  }
}

/**
 * Read the exit signal from a finished tool call. true / false / null (unknown).
 *
 * Origin 2026-10-25 (audit-run-blockers #2, measured on gate-hook): the canonical
 * recorder derived `pass` from `!output.metadata.error`, i.e. from the ABSENCE of
 * an error marker — so a red run that carried no error metadata was recorded as
 * green. The signal is now read positively:
 *   1. a numeric `exitCode`/`exit`/`code` in the output or its metadata;
 *   2. an `[exit code: N]` marker in the output text;
 *   3. an explicit `metadata.error` / `isError` boolean.
 * No signal = null = record NOTHING (a guessed pass is the forgery hole).
 *
 * @param {object} output hook payload output
 * @returns {boolean|null}
 */
export function passFromOutput(output) {
  const meta = output?.metadata ?? {};
  const explicit = [output?.exitCode, output?.exit, output?.code, meta.exitCode, meta.exit, meta.code]
    .find((v) => typeof v === 'number' && Number.isFinite(v));
  if (typeof explicit === 'number') return explicit === 0;

  const text = typeof output?.stdout === 'string' ? output.stdout
    : typeof output?.output === 'string' ? output.output
      : Array.isArray(output?.content)
        ? output.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
        : '';
  const marker = /\[exit code: (-?\d+)\]/.exec(text);
  if (marker) return Number(marker[1]) === 0;

  if (typeof meta.error === 'boolean') return meta.error === false;
  if (typeof output?.isError === 'boolean') return output.isError === false;
  if (meta.error) return false; // an error object/string is still an error
  return null;
}

/**
 * A test run is an EXACT runner invocation, never a substring: node|bun
 * running a .test.mjs file, or npm|bun test. Submitted 2026-10-12 after the
 * roast proved `echo .test.mjs` recorded a pass (substring matcher) — the
 * threat actor here is the model itself, so absent-error-means-pass on a
 * loose match is an insecure default. Residual, stated openly: a harness
 * that omits error metadata still defaults a matched run to pass — confusion
 * stays fail-open by doctrine (locking legitimate users out on an unknown
 * shape would be the worse failure), and Iron Law 4 sign-off still gates the
 * irreversible act itself.
 */
/**
 * A test run is a RUNNER INVOCATION at a segment head — never a substring.
 *
 * History of this boundary:
 *   2026-10-12  a substring matcher let `echo .test.mjs` record a pass; it became
 *               an EXACT invocation.
 *   2026-10-26  the exact set was only `*.test.mjs` / `npm test` / `bun test`, so
 *               a vitest/jest/pytest/cargo/go project could NEVER record
 *               evidence. Measured on a real adopter (ads-tracker, Claude Code):
 *               a green `npx vitest run ...` wrote nothing, the state stayed
 *               dated 2026-10-23, and every commit was refused forever — the gate
 *               could deny but never open. Replaying a real PostToolUse payload
 *               with exitCode 0 wrote NOTHING for all four response shapes.
 *
 * The three ADAPTERS learned these runners on 2026-10-25; the canonical path
 * (Claude Code + Codex) had not. Kept as one table so the two cannot drift again.
 */
const TEST_RUN =
  /^\s*(node|bun|deno)\s+[^\s]*\.test\.(mjs|js|ts|cjs|mts)(\s|$)|^\s*(npm|pnpm|yarn)\s+(run\s+)?test(:[\w.:-]+)?(\s|$)|^\s*(npx\s+|pnpm\s+|yarn\s+)?(vitest|jest)(\s|$)|^\s*(python\s+-m\s+)?pytest(\s|$)|^\s*cargo\s+test(\s|$)|^\s*go\s+test(\s|$)|^\s*(bun|deno)\s+test(\s|$)/;

/**
 * Did this command line's EXIT STATUS come from the test?
 *
 * A shell reports the LAST command's status, so the rule is positional:
 *   `cd repo && npx vitest run x`      -> test is last -> trustworthy
 *   `npx vitest run x; echo done`      -> echo is last -> NOT trustworthy
 *   `npx vitest run x && git commit`   -> commit is last -> NOT trustworthy
 *
 * The first form MUST stay accepted: in a BB thread the session cwd is the
 * workspace root, so a path-based runner is only reachable behind a `cd` prefix
 * (the pi recorder report's central finding). The trailing forms are how a red
 * suite was once certified green (measured 2026-10-25).
 */
export function recordedTestRun(command) {
  const text = String(command ?? '').trim();
  if (text === '') return false;
  // Command substitution and newlines break the positional argument.
  if (/\$\(|`|\r|\n/.test(text)) return false;
  const parts = text.split(/;|&&|\|\||\|/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return TEST_RUN.test(parts[parts.length - 1]);
}

/**
 * Record evidence from a finished tool call. Returns the written state, or
 * null when the call was not a test run (nothing recorded, nothing touched).
 */
export function observeAfter(dir, input = {}, output = {}) {
  const name = String(input?.tool ?? '').toLowerCase();
  const command = typeof input?.args?.command === 'string' ? input.args.command : '';
  if (!SHELL_TOOLS.has(name) || !recordedTestRun(command)) return null;
  // Positive exit signal only; unknown records NOTHING (audit-run-blockers #2).
  const pass = passFromOutput(output);
  if (pass === null) return null;
  return writeState(dir, { testPassFresh: pass, command, updatedAt: new Date().toISOString() });
}
