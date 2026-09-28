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
 *
 * A deliberate false negative lives in the root-cause table: "the tests are
 * red" is a genuine bug report and is NOT matched, because "red" is ordinary
 * English outside CI ("red shirt", "the red button"). The gate is a signal to
 * verify, never proof, so a miss here costs one un-flagged prompt; a false
 * positive on the word "red" would fire on every UI prompt in the project.
 * Closing it properly needs a context-aware rule, not another keyword.
 */
export const KEYWORD_TABLES = {
  'expect-fail': ['write a test', 'write tests', 'unit test', 'write a spec', 'tulis test', 'buat test', 'add unit tests', 'test-first'],
  'root-cause': ['bug', 'error', 'failing', 'failure', 'regression', 'perbaiki bug', 'debug', 'crash', 'why does', 'broke', 'broken', 'why is this'],
  receipts: ['commit', 'push', 'shipped', 'ship', 'merge', 'merged', 'pr', 'release', 'done', 'selesai', 'beres', 'catat', 'log it', 'deploy'],
};

/**
 * Negation markers, EN + ID. A keyword preceded by one of these (within the
 * token window below) is a DECLINED mention, not a domain match: "no commit
 * yet", "jangan tulis test dulu", "tanpa commit", "dont ship it yet".
 *
 * This table encodes the relation the gate actually means — the user asking
 * FOR the gated work — instead of matching the bare vocabulary. Same lesson as
 * ledger-audit M3 (.trust/lessons.md 2026-09-19): a trigger that matches a WORD
 * rather than the RELATION it means fires on the inverse of its own signal.
 *
 * Deliberately absent: bare "no" as a standalone token, because it is the
 * commonest EN denial-answer AND the commonest ID sentence starter ("no, the
 * tests are failing"). A complaint is a positive signal, and losing it would
 * blind the gate exactly where it is needed.
 *
 * Present instead: the attached-particle forms. "no commit", "no tests",
 * "no bug" and ID "jangan"/"tanpa"/"belum" all name the thing being withheld,
 * so they are precise (they cannot fire on a bare "no,") while still covering
 * the everyday phrasings. The list is checked both as a phrase inside the word
 * window and as a particle directly attached to the keyword.
 */
const NEGATION_MARKERS = [
  'no need', 'no commit', 'no commits', 'no test', 'no tests', 'no spec', 'no bug', 'no bugs', 'no error',
  'no errors', 'no fix', 'no fixes',
  'not', 'dont', "don't", 'do not', 'without', 'never', 'nothing to',
  'jangan', 'tanpa', 'belum', 'tidak perlu', 'ga perlu', 'gak perlu', 'nggak perlu',
];

/**
 * How many word tokens a negation marker can reach forward to suppress. Six is
 * set by the longest real phrasing in the suite — "no need to write a test"
 * puts five tokens between the denier and the keyword — and stays inside one
 * clause, which is what keeps it from reaching past a comma into a new request.
 */
const NEGATION_WINDOW_WORDS = 6;

/**
 * Clause boundaries. A negation does not reach past one, so "not sure, but
 * there is a bug" stays a root-cause signal. Commas are included because both
 * natural disclaimers ("not sure, but …") and ID "tidak apa-apa, tapi …" rely
 * on them.
 */
const CLAUSE_BOUNDARY = /[.,;:!?()\n]|\s(?:but|tapi|however|namun|though|meskipun)\s/;

/** Split text into clause spans, so a negation cannot suppress across one. */
function clauseSpans(text) {
  const spans = [];
  let start = 0;
  // Walk boundaries in order; each boundary ends the span before it and the
  // next span begins after it.
  const re = new RegExp(CLAUSE_BOUNDARY.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    spans.push([start, m.index]);
    start = m.index + m[0].length;
  }
  spans.push([start, text.length]);
  return spans;
}

function matchIndex(text, kw) {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\b${esc}\\b`, 'i').exec(text);
  return m ? m.index : -1;
}

/** True when a negation marker suppresses the match at `at` inside its clause. */
function isNegated(text, at, kw, spans) {
  const span = spans.find(([s, e]) => at >= s && at < e);
  if (!span) return false;
  const [s] = span;
  // The window is the text from the clause start THROUGH the keyword, because a
  // marker may end with the keyword itself: "no commit" is a denier whose last
  // word IS the thing being gated. Testing the prefix alone ("no ") can never
  // match it, which is how the first version of this rule passed every case
  // except the ones it existed for.
  const through = text.slice(s, at + kw.length);
  const words = through.split(/\s+/).filter(Boolean);
  const tail = words.slice(-NEGATION_WINDOW_WORDS).join(' ');
  return NEGATION_MARKERS.some((marker) => {
    const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Inside the word window ("not sure about the bug"), or directly attached to
    // the keyword ("no bug", "jangan tulis", "no commit") — the attached form is
    // checked on the raw text up to and including the keyword, so intervening
    // punctuation ("no, commit") does not count as attachment.
    if (new RegExp(`(^|\\s)${esc}(\\s|$)`, 'i').test(tail)) return true;
    return new RegExp(`(^|\\s)${esc}$`, 'i').test(through);
  });
}

function matchesAny(text, keywords) {
  const spans = clauseSpans(text);
  return keywords.some((kw) => {
    // Plain words match on word boundaries; multi-word phrases match as-is.
    // A keyword counts only when at least one un-negated occurrence exists —
    // "no commit yet, but here is the commit message" is still a commit task.
    let from = 0;
    for (;;) {
      const idx = matchIndex(text.slice(from), kw);
      if (idx === -1) return false;
      const at = from + idx;
      if (!isNegated(text, at, kw, spans)) return true;
      from = at + kw.length;
    }
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
