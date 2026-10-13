#!/usr/bin/env node
/**
 * Fail-first test for scripts/behavioral-eval.mjs — the offline validator for
 * the behavioral eval harness (cases + rubric + judge template).
 * Zero dependencies. Run: node scripts/behavioral-eval.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = validator behavior drift.
 *
 * Seam: validateBehavioralEval({ casesText, rubricText, judgeText }) — a pure
 * function over three file contents; the CLI wrapper reads the real files and
 * prints. Fixtures are hand-written literals (independent source of truth).
 *
 * Why it exists (ledger 2026-09-10): eval.mjs proves rules EXIST (markers,
 * wiring); it cannot prove rules CHANGE BEHAVIOR. The behavioral harness is
 * that second tier — but a harness whose fixtures are malformed silently
 * reports nothing, and a silent harness is worse than none. The validator
 * keeps the harness honest: cases parse, rubric weights sum to 1, every
 * case exercises at least one rubric dimension, the judge prompt is blind
 * (never reveals which text is baseline vs candidate).
 */
import { validateBehavioralEval } from './behavioral-eval.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Valid harness passes ----
const GOOD_CASES = `{"id":"multi-step-progress","split":"dev","prompt":"Step 2 of 5 just failed. Report state.","dimensions":["actionability","correctness"]}
{"id":"error-report","split":"test","prompt":"The test suite printed: 1 failing. Respond.","dimensions":["error-causal-honesty"]}
{"id":"haiku","split":"test","negative":true,"prompt":"Write a haiku about deploys.","dimensions":["tangent-suppression"]}
{"id":"smalltalk","split":"dev","negative":true,"prompt":"How is your day going? Just chatting.","dimensions":["tangent-suppression"]}`;
const GOOD_RUBRIC = `## Dimensions

| Dimension | Weight |
|---|---|
| correctness | 0.3 |
| actionability | 0.3 |
| error-causal-honesty | 0.2 |
| tangent-suppression | 0.2 |

error-causal-honesty: rewards stating uncertainty when evidence underdetermines the cause; penalizes inventing a definitive cause.`;
const GOOD_JUDGE = 'Blind judge: you receive RESPONSE_A and RESPONSE_B. Do not assume which condition produced either. Score each dimension 1-5.';

{
  const res = validateBehavioralEval({ casesText: GOOD_CASES, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('A1 valid harness passes with no errors', res.errors.length === 0, JSON.stringify(res.errors));
  check('A2 cases parsed (2 split sides, negatives present)', res.caseCount === 4, String(res.caseCount));
}

// ---- B. Malformed cases are rejected ----
{
  const res = validateBehavioralEval({
    casesText: '{"id":"only-one-field"}\nnot json at all',
    rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE,
  });
  check('B1 non-JSON lines are reported', res.errors.length > 0, JSON.stringify(res.errors));
  check('B2 error names the offending line', res.errors.some((e) => /line/i.test(e)), JSON.stringify(res.errors));
}

// ---- C. Duplicate case ids rejected ----
{
  const dup = GOOD_CASES + '\n' + GOOD_CASES.split('\n')[0];
  const res = validateBehavioralEval({ casesText: dup, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('C1 duplicate case id rejected', res.errors.some((e) => /duplicate/i.test(e)), JSON.stringify(res.errors));
}

// ---- D. Rubric weights must sum to 1 ----
{
  const bad = GOOD_RUBRIC.replace('| correctness | 0.3 |', '| correctness | 0.9 |');
  check('D0 the case actually unbalances the weights', bad !== GOOD_RUBRIC);
  const res = validateBehavioralEval({ casesText: GOOD_CASES, rubricText: bad, judgeText: GOOD_JUDGE });
  check('D1 weights not summing to 1 are rejected', res.errors.some((e) => /weight/i.test(e)), JSON.stringify(res.errors));
}

// ---- E. Every case references known rubric dimensions ----
{
  const res = validateBehavioralEval({
    casesText: GOOD_CASES.replace('"error-causal-honesty"', '"nonexistent-dimension"'),
    rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE,
  });
  check('E1 case referencing an unknown dimension is rejected',
    res.errors.some((e) => /nonexistent-dimension/.test(e) && /dimension/i.test(e)), JSON.stringify(res.errors));
}

// ---- F. Judge prompt must be blind ----
{
  const leaky = GOOD_JUDGE.replace('Do not assume which condition produced either', 'Response A is the candidate output');
  const res = validateBehavioralEval({ casesText: GOOD_CASES, rubricText: GOOD_RUBRIC, judgeText: leaky });
  check('F1 judge prompt revealing condition identity is rejected',
    res.errors.some((e) => /blind/i.test(e)), JSON.stringify(res.errors));
}

// ---- I. Must-not-fire negatives (coworker-adapt 01/AC3) ----
// A suite that only probes discipline-positive prompts cannot catch a gate
// that fires everywhere: half the suite must be prompts where the correct
// behavior is restraint (no ritual, no preaching). `negative: true` marks
// them; the floor is 40% — "~half" with room for growth, never zero.
{
  // First 3 GOOD_CASES lines: 1/3 negative (33%) — below the floor.
  const few = GOOD_CASES.split('\n').slice(0, 3).join('\n');
  const res = validateBehavioralEval({ casesText: few, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('I1 a suite below 40% negatives is rejected',
    res.errors.some((x) => /negative/i.test(x)), JSON.stringify(res.errors));
}
{
  const halfNeg = GOOD_CASES.split('\n').map((l) => {
    const o = JSON.parse(l); o.negative = true; return JSON.stringify(o);
  }).join('\n');
  const res = validateBehavioralEval({ casesText: halfNeg, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('I2 an all-negative suite passes the ratio (nothing to be silent about)',
    !res.errors.some((e) => /negative/i.test(e)), JSON.stringify(res.errors));
}

// ---- H. Dev/test split (coworker-adapt 01/AC1) ----
// "split": "dev" (tuning) or "test" (reporting), and both sides must be
// non-empty. A suite without the split lets tuning silently become the report.
{
  const noSplit = GOOD_CASES.split('\n').map((l) => {
    const o = JSON.parse(l); delete o.split; return JSON.stringify(o);
  }).join('\n');
  const res = validateBehavioralEval({ casesText: noSplit, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('H1 cases without a split are rejected',
    res.errors.some((e) => /split/i.test(e)), JSON.stringify(res.errors));
}
{
  const devOnly = GOOD_CASES.split('\n').map((l) => {
    const o = JSON.parse(l); o.split = 'dev'; return JSON.stringify(o);
  }).join('\n');
  const res = validateBehavioralEval({ casesText: devOnly, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('H2 a dev-only suite is rejected (nothing reportable)',
    res.errors.some((e) => /test/i.test(e)), JSON.stringify(res.errors));
}
{
  const badSplit = GOOD_CASES.split('\n').map((l, i) => {
    const o = JSON.parse(l); o.split = i === 0 ? 'staging' : 'test'; return JSON.stringify(o);
  }).join('\n');
  const res = validateBehavioralEval({ casesText: badSplit, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('H3 an unknown split value is rejected',
    res.errors.some((e) => /split/i.test(e)), JSON.stringify(res.errors));
}
// Evidence (upstream harness finding, ledger 2026-09-10): a "cause, then fix"
// reporting rule measurably pressured the model into asserting a definitive
// cause without evidence — the reporting-format cousin of certifying the bug.
// The harness must score that failure mode explicitly, or it can regress
// invisibly.
{
  const res = validateBehavioralEval({ casesText: GOOD_CASES, rubricText: '## Dimensions\n\n| Dimension | Weight |\n|---|---|\n| correctness | 1.0 |', judgeText: GOOD_JUDGE });
  check('G1 rubric without an anti-fabrication dimension is rejected',
    res.errors.some((e) => /error-causal-honesty|anti-fabrication|cause/i.test(e)), JSON.stringify(res.errors));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll behavioral-eval expectations hold.');
process.exit(failures ? 1 : 0);
