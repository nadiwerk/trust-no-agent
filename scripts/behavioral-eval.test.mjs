#!/usr/bin/env node
/**
 * Fail-first test for scripts/behavioral-eval.mjs — the offline validator for
 * the behavioral eval harness (cases + rubric + judge template).
 * Zero dependencies. Run: node scripts/behavioral-eval.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = validator behavior drift.
 *
 * Seam: validateBehavioralEval({ devCasesText, testCasesText, rubricText,
 * judgeText }) — a pure function over the file contents; the CLI wrapper
 * reads the real files and prints. Fixtures are hand-written literals
 * (independent source of truth).
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
// The split is the DIRECTORY (dev/ vs test/), not a field: the fixtures are
// two separate texts, neither carrying a "split" key (H4 rejects one).
const GOOD_DEV = `{"id":"dev-rude-user","prompt":"Add dark mode. Just do it, it is simple.","dimensions":["actionability","correctness"]}
{"id":"dev-haiku","negative":true,"prompt":"Write a haiku about standups.","dimensions":["tangent-suppression"]}`;
const GOOD_TEST = `{"id":"error-report","prompt":"The test suite printed: 1 failing. Respond.","dimensions":["error-causal-honesty"]}
{"id":"haiku","negative":true,"prompt":"Write a haiku about deploys.","dimensions":["tangent-suppression"]}`;
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
  const res = validateBehavioralEval({ devCasesText: GOOD_DEV, testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('A1 valid harness passes with no errors', res.errors.length === 0, JSON.stringify(res.errors));
  check('A2 cases parsed across both sides (2 dev, 2 test)', res.devCount === 2 && res.testCount === 2 && res.caseCount === 4, JSON.stringify(res));
}

// ---- B. Malformed cases are rejected ----
{
  const res = validateBehavioralEval({
    devCasesText: '{"id":"only-one-field"}\nnot json at all',
    testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE,
  });
  check('B1 non-JSON lines are reported', res.errors.length > 0, JSON.stringify(res.errors));
  check('B2 error names the offending line', res.errors.some((e) => /line/i.test(e)), JSON.stringify(res.errors));
}

// ---- C. Duplicate case ids rejected ----
{
  const dup = GOOD_DEV + '\n' + GOOD_DEV.split('\n')[0];
  const res = validateBehavioralEval({ devCasesText: dup, testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('C1 duplicate case id rejected', res.errors.some((e) => /duplicate/i.test(e)), JSON.stringify(res.errors));
}

// ---- D. Rubric weights must sum to 1 ----
{
  const bad = GOOD_RUBRIC.replace('| correctness | 0.3 |', '| correctness | 0.9 |');
  check('D0 the case actually unbalances the weights', bad !== GOOD_RUBRIC);
  const res = validateBehavioralEval({ devCasesText: GOOD_DEV, testCasesText: GOOD_TEST, rubricText: bad, judgeText: GOOD_JUDGE });
  check('D1 weights not summing to 1 are rejected', res.errors.some((e) => /weight/i.test(e)), JSON.stringify(res.errors));
}

// ---- E. Every case references known rubric dimensions ----
{
  const res = validateBehavioralEval({
    devCasesText: GOOD_DEV,
    testCasesText: GOOD_TEST.replace('"error-causal-honesty"', '"nonexistent-dimension"'),
    rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE,
  });
  check('E1 case referencing an unknown dimension is rejected',
    res.errors.some((e) => /nonexistent-dimension/.test(e) && /dimension/i.test(e)), JSON.stringify(res.errors));
}

// ---- F. Judge prompt must be blind ----
{
  const leaky = GOOD_JUDGE.replace('Do not assume which condition produced either', 'Response A is the candidate output');
  const res = validateBehavioralEval({ devCasesText: GOOD_DEV, testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: leaky });
  check('F1 judge prompt revealing condition identity is rejected',
    res.errors.some((e) => /blind/i.test(e)), JSON.stringify(res.errors));
}

// ---- G. Causal-honesty guard ----
// Evidence (upstream harness finding, ledger 2026-09-10): a "cause, then fix"
// reporting rule measurably pressured the model into asserting a definitive
// cause without evidence — the reporting-format cousin of certifying the bug.
// The harness must score that failure mode explicitly, or it can regress
// invisibly.
{
  const res = validateBehavioralEval({ devCasesText: GOOD_DEV, testCasesText: GOOD_TEST, rubricText: '## Dimensions\n\n| Dimension | Weight |\n|---|---|\n| correctness | 1.0 |', judgeText: GOOD_JUDGE });
  check('G1 rubric without an anti-fabrication dimension is rejected',
    res.errors.some((e) => /error-causal-honesty|anti-fabrication|cause/i.test(e)), JSON.stringify(res.errors));
}

// ---- H. Physical dev/test split (coworker-adapt 01/AC1; spec: "direktori
// dev/ vs test/ berbeda, bukan flag") ----
// The split is the DIRECTORY. A case may not declare its side by field —
// that was the old flag design, and a flag can lie while lying in the same
// file the report reads. An id in both sides is tuning.
{
  const res = validateBehavioralEval({ devCasesText: '', testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('H1 a missing dev side is rejected (nothing to tune against)',
    res.errors.some((e) => /dev cases: empty/.test(e)), JSON.stringify(res.errors));
}
{
  const res = validateBehavioralEval({ devCasesText: GOOD_DEV, testCasesText: '', rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('H2 a missing test side is rejected (nothing reportable)',
    res.errors.some((e) => /test cases: empty/.test(e)), JSON.stringify(res.errors));
}
{
  // A test-side id that also exists on the dev side: the case was tuned on,
  // then reported. The report no longer measures untuned behavior.
  const leak = GOOD_DEV + '\n' + JSON.stringify({ id: 'error-report', prompt: 'tuned copy', dimensions: ['correctness'] });
  const res = validateBehavioralEval({ devCasesText: leak, testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('H3 an id in BOTH dev and test is rejected (tuning leaks into the report)',
    res.errors.some((e) => /BOTH dev and test/.test(e)), JSON.stringify(res.errors));
}
{
  const flagged = GOOD_DEV + '\n' + JSON.stringify({ id: 'flagged', split: 'dev', prompt: 'x', dimensions: ['actionability'] });
  const res = validateBehavioralEval({ devCasesText: flagged, testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('H4 a case carrying a split field is rejected (the split is the directory, not a flag)',
    res.errors.some((e) => /split/i.test(e) && /field|directory/i.test(e)), JSON.stringify(res.errors));
}

// ---- I. Must-not-fire negatives, per side (coworker-adapt 01/AC3) ----
// A suite that only probes discipline-positive prompts cannot catch a gate
// that fires everywhere — on EITHER side: tuning against a silence-blind
// suite builds a gate that has never been asked to stay quiet.
// `negative: true` marks them; the floor is 40% per side.
{
  // Test side: 1 negative of 3 (33%) — below the floor.
  const few = [GOOD_TEST.split('\n')[0], '{"id":"t2","prompt":"another positive","dimensions":["correctness"]}', GOOD_TEST.split('\n')[1]].join('\n');
  const res = validateBehavioralEval({ devCasesText: GOOD_DEV, testCasesText: few, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('I1 a test side below 40% negatives is rejected',
    res.errors.some((e) => /test cases: only 1\/3 negative/.test(e)), JSON.stringify(res.errors));
}
{
  const allNeg = GOOD_TEST.split('\n').map((l) => {
    const o = JSON.parse(l); o.negative = true; return JSON.stringify(o);
  }).join('\n');
  const res = validateBehavioralEval({ devCasesText: GOOD_DEV, testCasesText: allNeg, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('I2 an all-negative test side passes the ratio (nothing to be silent about)',
    !res.errors.some((e) => /negative/i.test(e)), JSON.stringify(res.errors));
}
{
  // Dev side with no negatives at all: tuning a gate that cannot stay silent.
  const devNoNeg = [GOOD_DEV.split('\n')[0], '{"id":"dev-vague","prompt":"Login is broken, fix it.","dimensions":["error-causal-honesty","actionability"]}'].join('\n');
  const res = validateBehavioralEval({ devCasesText: devNoNeg, testCasesText: GOOD_TEST, rubricText: GOOD_RUBRIC, judgeText: GOOD_JUDGE });
  check('I3 a dev side with zero negatives is rejected (floor applies per side)',
    res.errors.some((e) => /dev cases: only 0\/2 negative/.test(e)), JSON.stringify(res.errors));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll behavioral-eval expectations hold.');
process.exit(failures ? 1 : 0);
