#!/usr/bin/env node
/**
 * tna-gate — the veto core behind the opencode plugin.
 * Spec: docs/specs/hardening-general.md (ticket 02-veto-opencode-state, AC1).
 *
 * Two halves with one seam between them:
 *
 *   observeAfter(dir, input, output) — records session evidence: a bash test
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
import { classifyAction } from './action-gate.mjs';

const STATE_FILE = 'tna-gate-state.json';
const LOG_FILE = 'tna-gate-log.jsonl';

/** @returns {{testPassFresh: boolean, command?: string, updatedAt?: string}} */
export function readState(dir) {
  try {
    const raw = readFileSync(join(String(dir), '.trust', STATE_FILE), 'utf8');
    const s = JSON.parse(raw);
    if (s && typeof s === 'object' && typeof s.testPassFresh === 'boolean') return s;
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
 */
export function logVeto(dir, { harness = 'unknown', tool = '', command = '' } = {}) {
  try {
    mkdirSync(join(String(dir), '.trust'), { recursive: true });
    appendFileSync(
      join(String(dir), '.trust', LOG_FILE),
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
const TEST_RUN =
  /^\s*(node|bun)\s+[^\s]*\.test\.mjs(\s|$)|^\s*npm\s+test(\s|$)|^\s*bun\s+test(\s|$)/;

/**
 * Record evidence from a finished tool call. Returns the written state, or
 * null when the call was not a test run (nothing recorded, nothing touched).
 */
export function observeAfter(dir, input = {}, output = {}) {
  const name = String(input?.tool ?? '').toLowerCase();
  const command = typeof input?.args?.command === 'string' ? input.args.command : '';
  if (name !== 'bash' || !TEST_RUN.test(command)) return null;
  const pass = !output?.metadata?.error;
  return writeState(dir, { testPassFresh: pass, command, updatedAt: new Date().toISOString() });
}
