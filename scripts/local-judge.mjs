#!/usr/bin/env node
/**
 * Local judgment — bounded decisions over a CLOSED answer set, deterministic
 * graders first, model judge last resort (coworker-adapt ticket 05, AC7;
 * spec US7; corpus K6–K9). Zero dependencies, no API key, no network: a
 * bounded decision stays fast and free, and the expensive judge is consulted
 * only when free code cannot answer.
 *
 * Use:  import { judgeBounded, requiredSection, forbiddenPattern, outputLength }
 *         from './local-judge.mjs'
 *
 *   judgeBounded({ question, choices, evidence, graders = [], modelJudge = null })
 *
 * Ordering (the K6/K9 pattern made executable):
 *   1. graders run IN ORDER; the first grader that returns a member of
 *      `choices` decides — by: 'deterministic', and the model judge is
 *      NEVER called (code answers form for free).
 *   2. every grader abstained (null) → the model judge is called EXACTLY
 *      ONCE, with one question + the evidence + the closed set (K7: one
 *      judge = one dimension, one binary question) — by: 'model'.
 *   3. no judge, a judge that throws, or an answer outside `choices`
 *      → verdict 'inconclusive', by: 'none'. A non-running check never
 *      passes (J4), and it never fails either: it says so.
 *
 * Fail-closed on misuse too: an empty `choices` is a loud error (bounded
 * judgment needs a declared set — "list every acceptable answer before the
 * call"), as is a grader deciding outside that set (a bug, not a verdict).
 *
 * Never downgrades anything — this returns a verdict; who acts on it is the
 * caller's (gated, scoped, reversible) decision.
 */
import { fileURLToPath } from 'node:url';

// ---- grader factories (K6: code for form — free, deterministic) ----

/** Decides `choice` when the evidence contains `section` (verbatim substring). */
export function requiredSection(section, choice) {
  return {
    name: `required-section:${JSON.stringify(section)}`,
    decide: (evidence) => (String(evidence).includes(section) ? choice : null),
  };
}

/** Decides `choice` when `pattern` matches the evidence (string or RegExp).
 * Trust boundary (roast 2026-10-13 ReDoS nit): `pattern` is caller-controlled
 * library input, not user input — callers here are repo code and tests with
 * fixed literals. A caller that ever feeds untrusted text here must pass a
 * pre-compiled RegExp or bound the pattern itself; this seam does not
 * sanitize it (a ReDoS guard would be the caller's decision, not this
 * module's). */
export function forbiddenPattern(pattern, choice) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return {
    name: `forbidden-pattern:${re}`,
    decide: (evidence) => (re.test(String(evidence)) ? choice : null),
  };
}

/** Decides `choice` when the evidence length is OUTSIDE [min, max] chars. */
export function outputLength({ min = 0, max = Infinity }, choice) {
  return {
    name: `output-length:${min}..${max}`,
    decide: (evidence) => {
      const n = String(evidence).length;
      return n < min || n > max ? choice : null;
    },
  };
}

// ---- the ordering ----

/**
 * @param {object} o
 * @param {string} o.question   ONE question, asked at most once (K7).
 * @param {Array<*>} o.choices  The closed answer set — required, non-empty.
 * @param {*} o.evidence        The text under judgment (quoted to the judge).
 * @param {Array<{name: string, decide: (e:*) => (*|null)}>} [o.graders]
 * @param {((p: {question: string, choices: Array<*>, evidence: *}) => *)} [o.modelJudge]
 * @returns {{verdict: *, by: 'deterministic'|'model'|'none', question: string, grader?: string}}
 */
export function judgeBounded({ question, choices, evidence, graders = [], modelJudge = null }) {
  if (!Array.isArray(choices) || choices.length === 0)
    throw new Error('judgeBounded: `choices` must be a non-empty closed answer set — list every acceptable answer before the call');
  if (typeof question !== 'string' || !question.trim())
    throw new Error('judgeBounded: `question` must be one non-empty question');

  for (const grader of graders) {
    let decision;
    try {
      decision = grader.decide(evidence);
    } catch {
      decision = null; // a broken grader abstains; it never decides
    }
    if (decision === null || decision === undefined) continue;
    if (!choices.includes(decision))
      throw new Error(`grader ${grader.name} decided ${JSON.stringify(decision)}, which is outside the closed set [${choices.map((c) => JSON.stringify(c)).join(', ')}] — a bug in the grader, not a verdict`);
    return { verdict: decision, by: 'deterministic', question, grader: grader.name };
  }

  if (typeof modelJudge === 'function') {
    let answer;
    try {
      answer = modelJudge({ question, choices, evidence });
    } catch {
      return { verdict: 'inconclusive', by: 'none', question };
    }
    if (choices.includes(answer))
      return { verdict: answer, by: 'model', question };
    return { verdict: 'inconclusive', by: 'none', question };
  }

  return { verdict: 'inconclusive', by: 'none', question };
}

// ---- CLI: judge one evidence file against a declared set, grader-config
// driven. Reading (not judging) from the shell: the caller still decides. ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.error('local-judge is a library seam (import it); there is no key to press here.');
  process.exit(2);
}
