#!/usr/bin/env node
/**
 * mandatory-gate — mechanical pre-gate classifier for MANDATORY skill routing.
 * Spec: docs/specs/mandatory-gate.md (ticket 01-classifier-core).
 *
 * Seam: classifyTask(text) — a PURE function over a task's text. Returns one
 * boolean verdict per MANDATORY skill domain: does this text touch the
 * domain that obligates loading that skill? No I/O, no probabilities
 * (variant B, deferred — the interface is already the pure seam it needs).
 *
 * Consumers (tickets 02/03): ledger-audit.mjs adds a warn-level "flagged
 * without Loaded:" finding; doctor verifies this script exists and passes.
 * The gate never mutates anything and never fails an audit by itself —
 * a keyword matcher is a signal to verify, not evidence (spec §Constraints).
 *
 * Attribution: original implementation. Principle (mechanical enforcement
 * over model initiative) is the framework's own — docs/design.md §Self-trigger
 * is unreliable; internal evaluation origin, ledger 2026-09-20. No external
 * code or assets used.
 */

export const MANDATORY_DOMAINS = ['expect-fail', 'root-cause', 'receipts'];

/**
 * Keyword tables, EN + ID (owner decision: bilingual — real sessions mix
 * both). Word-boundary matched, case-insensitive. Keywords are chosen to
 * separate true domain work from incidental mentions: 'test' alone would
 * match "the test runner documentation", so test-writing words are verb-y
 * (write/build/add/tulis/buat + test); 'fix/perbaiki' alone would match
 * "perbaiki ejaan", so bug words pair fix/perbaiki with bug context or use
 * unambiguous failure words (bug, error, failing, regression).
 */
export const KEYWORD_TABLES = {
  'expect-fail': ['write a test', 'write tests', 'unit test', 'write a spec', 'tulis test', 'buat test', 'add unit tests', 'test-first'],
  'root-cause': ['bug', 'error', 'failing', 'failure', 'regression', 'perbaiki bug', 'debug', 'crash', 'why does'],
  receipts: ['commit', 'push', 'shipped', 'ship', 'merge', 'merged', 'pr', 'release', 'done', 'selesai', 'beres', 'catat', 'log it', 'deploy'],
};

function matchesAny(text, keywords) {
  return keywords.some((kw) => {
    // Plain words match on word boundaries; multi-word phrases match as-is.
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i').test(text);
  });
}

/**
 * Classify a task's text against the MANDATORY domains.
 * @param {string} text - the task/prompt/ledger-entry text to inspect
 * @returns {Record<'expect-fail'|'root-cause'|'receipts', boolean>}
 */
export function classifyTask(text) {
  const t = String(text ?? '').toLowerCase();
  const v = {};
  for (const skill of MANDATORY_DOMAINS) {
    v[skill] = matchesAny(t, KEYWORD_TABLES[skill]);
  }
  return v;
}
