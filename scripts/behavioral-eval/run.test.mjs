#!/usr/bin/env node
/**
 * Fail-first test for scripts/behavioral-eval/run.mjs offline pieces — the
 * candidate prefix, label assignment, and scoring. Zero dependencies.
 * Run: node scripts/behavioral-eval/run.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = runner offline-logic drift.
 *
 * The API path is deliberately NOT unit-tested — it is a thin fetch wrapper
 * whose correctness is observable only against a live endpoint (honest limits,
 * scripts/behavioral-eval/README.md).
 */
import { buildCandidatePrefix, assignLabels, scoreResponse, parseWeights, classifyFault, makeTrialRow, summarizeTrials } from './run.mjs';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Candidate prefix is built from real inputs ----
{
  const block = 'RE-INJECTED ROUTER CORE:\n\n## Iron Laws\n\n```\nNO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.\n```';
  const receipt = '```md\n✅ DONE <id> | <cmd>: <result>\nEvidence: ...\nOpen: ...\nNext: ...\n```';
  const prefix = buildCandidatePrefix(block, receipt);
  check('A1 prefix carries the reinject block verbatim', prefix.includes('NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST'), prefix);
  check('A2 prefix carries the receipt shape', prefix.includes('✅ DONE <id>'), prefix);
  check('A3 prefix carries the anti-fabrication instruction', /never assert a cause/i.test(prefix), prefix);
  check('A4 prefix does not carry the receipt doc prose (shape only)', !prefix.includes('Skim test'), prefix.slice(0, 200));
  // Regression fixes from the first recorded run (RESULTS.md §regressions):
  // tangent-suppression and artifact-target must be taught in the prefix,
  // or the receipt shape keeps winning over the behaviors.
  check('A5 prefix carries the tangent-suppression rule', /suppress them/i.test(prefix) && /once at the very end/i.test(prefix), prefix);
  check('A6 prefix carries the artifact-target action rule', /open\/curl the rendered page/i.test(prefix), prefix);
}

// ---- B. Label assignment shuffles and balances ----
{
  const counts = { baselineA: 0, candidateA: 0 };
  for (let ci = 0; ci < 4; ci++) for (let t = 0; t < 3; t++) {
    const l = assignLabels(ci, t);
    if (l.A === 'baseline') counts.baselineA++; else counts.candidateA++;
    check(`B${ci}.${t} labels are a valid bijection`, (l.A === 'baseline' && l.B === 'candidate') || (l.A === 'candidate' && l.B === 'baseline'), JSON.stringify(l));
  }
  check('B-balance both orders occur', counts.baselineA > 0 && counts.candidateA > 0, JSON.stringify(counts));
}

// ---- C. Scoring is the weighted mean over present dimensions only ----
{
  const w = { correctness: 0.5, actionability: 0.3, state: 0.2 };
  check('C1 full scores weight correctly', Math.abs(scoreResponse({ correctness: 4, actionability: 2, state: 5 }, w) - (4 * .5 + 2 * .3 + 5 * .2)) < 1e-9);
  check('C2 missing dimension renormalizes over present ones',
    Math.abs(scoreResponse({ correctness: 4, actionability: 2 }, w) - (4 * .5 + 2 * .3) / .8) < 1e-9);
  check('C3 empty scores yield 0 (caller decides how to treat)', scoreResponse({}, w) === 0);
}

// ---- D. Weight parsing from the real rubric ----
{
  const w = parseWeights('| correctness | 0.15 |\n| actionability | 0.30 |\n');
  check('D1 parses lowercase keys', w.correctness === 0.15 && w.actionability === 0.3, JSON.stringify(w));
  const sum = Object.values(parseWeights('| a | 0.6 |\n| B | 0.4 |\n')).reduce((x, y) => x + y, 0);
  check('D2 case-insensitive keys, sum intact', Math.abs(sum - 1) < 1e-9);
}

// ---- E. Fault tags (coworker-adapt 01/AC2) ----
{
  check('E1 API-level abort tags infra', classifyFault({ apiError: new Error('boom') }) === 'infra');
  check('E2 missing measurement tags infra, never the agent', classifyFault({ judged: null }) === 'infra');
  check('E3 a graded row attributes to the agent', classifyFault({ judged: { A: {}, B: {} } }) === 'agent');
}

// ---- E2. Row seam (coworker-adapt 01/AC2; roast fix 2026-10-13) ----
// makeTrialRow is the single seam every row passes through: a graded row is
// charged to the agent, an api-abort or missing judgment becomes a skipped
// infra row (kept, counted separately) — never dropped, never agent's fault.
// This is the behavioral half of the G wiring proof.
{
  const labels = { A: 'baseline', B: 'candidate' };
  const graded = makeTrialRow({ id: 'x', trial: 0, labels,
    judged: { A: { correctness: { score: 3 } }, B: { correctness: { score: 5 } } } });
  check('E4 graded row is tagged agent and carries scores',
    graded.fault === 'agent' && !graded.skipped && graded.A.correctness === 3 && graded.B.correctness === 5,
    JSON.stringify(graded));
  const judged0 = makeTrialRow({ id: 'x', trial: 1, labels, judged: null });
  check('E5 judge-failed trial becomes a skipped infra row, not dropped',
    judged0.skipped === true && judged0.fault === 'infra', JSON.stringify(judged0));
  const apiErr = makeTrialRow({ id: 'x', trial: 2, labels, apiError: new Error('boom') });
  check('E6 API abort becomes a skipped infra row',
    apiErr.skipped === true && apiErr.fault === 'infra', JSON.stringify(apiErr));
}

// ---- F. Trial summary (coworker-adapt 01/AC8) ----
{
  const w = { correctness: 1 };
  const rows = [
    { id: 'c1', trial: 0, A: { correctness: 3 }, B: { correctness: 4 } },
    { id: 'c1', trial: 1, A: { correctness: 3 }, B: { correctness: 2 } },
    { id: 'c1', trial: 2, skipped: true, fault: 'infra' },
    { id: 'c2', trial: 0, A: { correctness: 5 }, B: { correctness: 5 } },
  ];
  const s = summarizeTrials(rows, w);
  check('F1 pass rate counts scored trials only (2 scored, 1 pass)',
    s.c1.passRate === 0.5 && s.c1.scored === 2 && s.c1.trials === 3, JSON.stringify(s.c1));
  check('F2 mean delta is signed (regression shows negative)',
    s.c1.meanDelta === 0, JSON.stringify(s.c1));
  check('F3 infra skips counted apart, never in the rate',
    s.c1.infraSkips === 1 && s.c2.infraSkips === 0, JSON.stringify(s));
  check('F4 flakiness is the variance of deltas (1, -1 -> variance 1)',
    s.c1.flakiness === 1, JSON.stringify(s.c1));
}

// ---- G. Wiring proof: every row goes through the fault seam (call site) ----
// The old G1 regex matched classifyFault's OWN definition line — a tautology
// (the dead-code finding it was meant to catch still passed: zero call sites).
// A call-site assertion names the actual calls: main pushes rows built by
// makeTrialRow, and makeTrialRow consults classifyFault. Neither pattern can
// match a function declaration. Behavioral half: E4-E6 above.
{
  const src = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  check('G1 main pushes rows built by makeTrialRow (call site, not definition)',
    /rows\.push\(makeTrialRow\(/.test(src));
  check('G2 makeTrialRow consults classifyFault (call site, not definition)',
    /const fault = classifyFault\(/.test(src));
}

// ---- I. pass@k / pass^k (coworker-adapt 01/AC8) ----
// Hand-computed from the estimator, never from the code:
// c1: n=2 scored, c=1 pass → pass@1 = 1 − C(1,1)/C(2,1) = 0.5;
// pass@2 = 1 − C(1,2)/C(2,2) = 1 − 0 = 1; pass@3 undefined (k > scored) → null.
// pass^1 = (1/2)^1 = 0.5; pass^2 = 0.25; pass^3 = 0.125 (i.i.d. extrapolation).
// c2: n=1 scored, c=0 pass → pass@1 = 0; pass^k = 0; pass@2 null (k > scored).
{
  const w = { correctness: 1 };
  const rows = [
    { id: 'c1', trial: 0, A: { correctness: 3 }, B: { correctness: 4 } },
    { id: 'c1', trial: 1, A: { correctness: 3 }, B: { correctness: 2 } },
    { id: 'c1', trial: 2, skipped: true, fault: 'infra' },
    { id: 'c2', trial: 0, A: { correctness: 5 }, B: { correctness: 5 } },
  ];
  const s = summarizeTrials(rows, w);
  check('I1 pass@k ladder (c1): 1 − C(n−c,k)/C(n,k), null beyond scored',
    s.c1.passAtK[1] === 0.5 && s.c1.passAtK[2] === 1 && s.c1.passAtK[3] === null,
    JSON.stringify(s.c1.passAtK));
  check('I2 pass^k reliability (c1): (c/n)^k',
    Math.abs(s.c1.passPowK[1] - 0.5) < 1e-9 && Math.abs(s.c1.passPowK[2] - 0.25) < 1e-9 && Math.abs(s.c1.passPowK[3] - 0.125) < 1e-9,
    JSON.stringify(s.c1.passPowK));
  check('I3 zero-pass case: pass@k = 0, never a null-fabricated number',
    s.c2.passAtK[1] === 0 && s.c2.passAtK[2] === null && s.c2.passPowK[1] === 0,
    JSON.stringify(s.c2));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll runner offline expectations hold.');
process.exit(failures ? 1 : 0);
