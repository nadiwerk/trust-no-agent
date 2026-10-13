#!/usr/bin/env node
/**
 * action-gate — mechanical action-gate over word-punishment.
 * Spec: docs/specs/hardening-general.md (ticket 01-action-gate-core, AC7).
 *
 * Seam: classifyAction({ tool, args, evidence, message }) — a PURE function
 * over a tool call. Returns { gated, reason }. No I/O, no probabilities.
 *
 * The load-bearing design decision: the gate NEVER reads `message`. Words
 * ("done", "selesai", "ship it") cannot close OR open it by construction, so
 * evasion-by-rephrasing buys nothing and humble phrasing excuses nothing.
 * The `message` parameter exists only to document that boundary — callers may
 * pass the surrounding prompt text to prove it was seen and ignored.
 *
 * v1 scope (Constraints: fail-closed is irreversible-only): bash commands
 * matching IRREVERSIBLE_PATTERNS without fresh test evidence
 * (evidence.testPassFresh === true, set by the session's own test run).
 * Ordinary writes/edits stay fail-open. Consumers (ticket 02 plugin veto,
 * ticket 03 audit): this module classifies, it never blocks or logs.
 *
 * Attribution: original implementation. Principle (gate the action, not the
 * word) is the framework's own — docs/specs/hardening-general.md. No external
 * code or assets used.
 */

/**
 * Irreversible-action patterns, matched case-insensitively against bash
 * command text. Literal substrings (not regexes) so the F1 consistency check
 * in action-gate.test.mjs can verify each one appears in a test case.
 */
export const IRREVERSIBLE_PATTERNS = [
  'git commit',
  'git push',
  'npm publish',
  'rm -rf',
];

/**
 * Shell-execution tool names, matched case-insensitively. `bash` is the
 * documented name; `shell` is the LIVE name opencode V2 sends (proven
 * 2026-10-12 by the tna-probe: keys=["tool","sessionID","agent","messageID",
 * "id","input"], tool="shell"). Since full-enforcement 04/AC7 the set is
 * advisory only: a `command` string matching the irreversible patterns gates
 * under ANY tool name (doubt blocks with its reason shown) — a future
 * harness renaming `shell` must not reopen the hole ticket 08 closed live.
 */
export const SHELL_TOOLS = new Set(['bash', 'shell']);

function matchesAnyCommand(command) {
  for (const p of IRREVERSIBLE_PATTERNS) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`, 'i').test(command)) return p;
  }
  return null;
}

/**
 * Classify a tool call against the irreversible-action boundary.
 * @param {object} input
 * @param {string} [input.tool] tool name (case-insensitive, e.g. 'bash'/'Bash')
 * @param {object} [input.args] tool args; bash commands read from args.command
 * @param {object} [input.evidence] session evidence; { testPassFresh: true }
 *   opens the gate for irreversible actions
 * @param {string} [input.message] surrounding prompt text — ACCEPTED AND
 *   IGNORED by design (words never gate)
 * @returns {{gated: boolean, reason: string}}
 */
export function classifyAction({ tool = '', args = {}, evidence = {} } = {}) {
  const name = String(tool ?? '').toLowerCase();
  const command = typeof args?.command === 'string' ? args.command : '';
  const hit = command ? matchesAnyCommand(command) : null;
  if (hit) {
    const via = SHELL_TOOLS.has(name) ? name : `${name || '(unnamed tool)'} (unknown shell name)`;
    if (evidence?.testPassFresh === true)
      return { gated: false, reason: `irreversible action (${hit}) via ${via} with fresh test evidence — gate open` };
    return { gated: true, reason: `irreversible action (${hit}) via ${via} without fresh test evidence — sign-off plus a fresh test pass required (docs/specs/hardening-general.md AC1)` };
  }
  return { gated: false, reason: 'no irreversible action in this tool call — gate open (words alone never gate)' };
}
