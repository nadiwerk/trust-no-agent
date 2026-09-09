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
import { buildCandidatePrefix, assignLabels, scoreResponse, parseWeights } from './run.mjs';

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

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll runner offline expectations hold.');
process.exit(failures ? 1 : 0);
