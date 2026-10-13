#!/usr/bin/env node
/**
 * Fail-first test for scripts/local-judge.mjs — bounded judgment over closed
 * answer sets (coworker-adapt ticket 05, AC7; spec US7; corpus K6–K9:
 * "code for form, model judge ONLY for meaning", "groundedness pre-check
 * BEFORE the LLM judge", J4 "non-running check = inconclusive, never pass").
 * Zero deps. Run: node scripts/local-judge.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = judgment contract drift.
 *
 * Seam: judgeBounded({ question, choices, evidence, graders, modelJudge })
 * plus three grader factories. The contract under test:
 *
 *   1. ZERO-DEP / NO KEY  — the module reads no env, calls no network, and
 *      imports nothing outside node: builtins. Bounded decisions must stay
 *      free (spec constraint: "No model-judgment API keys anywhere").
 *   2. DETERMINISTIC FIRST — graders run in order, first decision wins, and
 *      a decided verdict means the model judge is NEVER called (the K6/K9
 *      ordering made executable).
 *   3. MODEL JUDGE LAST RESORT — called exactly once, only when every grader
 *      abstains, with ONE question + the evidence (K7).
 *   4. FAIL-CLOSED — no decision and no judge, an out-of-set model answer,
 *      or a throwing judge all yield `inconclusive`: a non-running check
 *      never passes (J4).
 *   5. BOUNDED — verdicts come from the declared closed set; an empty set or
 *      a grader returning outside it is a loud error, never a silent pass.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { judgeBounded, requiredSection, forbiddenPattern, outputLength } =
  await import('./local-judge.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Zero-dep / no API key (static scan of the module source) ----
{
  const src = readFileSync(join(HERE, 'local-judge.mjs'), 'utf8');
  check('A1 no fetch(/ network call in the module', !/fetch\s*\(/.test(src));
  check('A2 no process.env reads (a key cannot leak in)', !/process\.env/.test(src));
  check('A3 no provider token in source (ANTHROPIC/API_KEY/OPENAI)',
    !/ANTHROPIC|API_KEY|OPENAI/i.test(src), src.match(/.{0,40}(ANTHROPIC|API_KEY|OPENAI).{0,40}/i)?.[0]);
  const imports = [...src.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  check('A4 every import is a node: builtin (zero third-party deps)',
    imports.every((s) => s.startsWith('node:')), JSON.stringify(imports));
}

// ---- B. Deterministic graders first; a decided verdict never calls the model ----
{
  const order = [];
  const spyJudge = () => { order.push('model'); return 'pass'; };
  const g1 = { name: 'g1', decide: () => { order.push('g1'); return null; } };
  const g2 = { name: 'g2', decide: () => { order.push('g2'); return 'fail'; } };

  order.length = 0;
  const decided = judgeBounded({
    question: 'is this receipt complete?',
    choices: ['pass', 'fail'],
    evidence: '## Verdict\nall five booleans yes',
    graders: [g1, g2],
    modelJudge: spyJudge,
  });
  check('B1 a deciding grader yields its verdict with by = deterministic',
    decided.verdict === 'fail' && decided.by === 'deterministic', JSON.stringify(decided));
  check('B2 the model judge is NEVER called once a grader decides (deterministic-dulu)',
    !order.includes('model'), JSON.stringify(order));
  check('B3 graders run in declared order and stop at the first decision',
    order.join('>') === 'g1>g2', JSON.stringify(order));
  check('B4 the deciding grader is named in the verdict (evidence of who decided)',
    decided.grader === 'g2', JSON.stringify(decided));

  order.length = 0;
  const firstWins = judgeBounded({
    question: 'q', choices: ['yes', 'no'], evidence: 'e',
    graders: [
      { name: 'ga', decide: () => 'yes' },
      { name: 'gb', decide: () => 'no' },
    ],
    modelJudge: spyJudge,
  });
  check('B5 first decision wins — later graders never run',
    firstWins.verdict === 'yes' && firstWins.grader === 'ga', JSON.stringify(firstWins));
}

// ---- C. Model judge is last resort: once, after every grader, one question ----
{
  const order = [];
  const seen = [];
  const res = judgeBounded({
    question: 'does the claim cite its evidence?',
    choices: ['yes', 'no'],
    evidence: 'quoted text under review',
    graders: [{ name: 'abstain', decide: () => { order.push('abstain'); return null; } }],
    modelJudge: (payload) => { order.push('model'); seen.push(payload); return 'yes'; },
  });
  check('C1 undecidable → the model judge IS consulted (last resort, not never)',
    res.verdict === 'yes' && res.by === 'model', JSON.stringify(res));
  check('C2 exactly one judge call', order.filter((x) => x === 'model').length === 1, JSON.stringify(order));
  check('C3 the judge runs AFTER every grader (pre-check before judge, K9)',
    order.join('>') === 'abstain>model', JSON.stringify(order));
  check('C4 the judge receives ONE question + the evidence + the closed set',
    seen.length === 1 && seen[0].question === 'does the claim cite its evidence?'
      && seen[0].evidence === 'quoted text under review'
      && JSON.stringify(seen[0].choices) === '["yes","no"]', JSON.stringify(seen));
}

// ---- D. Fail-closed: nothing decided, nothing passes ----
{
  const base = { question: 'q', choices: ['pass', 'fail'], evidence: 'e' };
  const noJudge = judgeBounded({ ...base, graders: [] });
  check('D1 no grader + no judge → inconclusive, never a pass (J4)',
    noJudge.verdict === 'inconclusive' && noJudge.by === 'none', JSON.stringify(noJudge));

  const badAnswer = judgeBounded({ ...base, graders: [], modelJudge: () => 'maybe' });
  check('D2 a model answer outside the closed set → inconclusive (bounded)',
    badAnswer.verdict === 'inconclusive', JSON.stringify(badAnswer));

  const throws = judgeBounded({ ...base, graders: [], modelJudge: () => { throw new Error('endpoint down'); } });
  check('D3 a throwing judge → inconclusive, the error never becomes a verdict',
    throws.verdict === 'inconclusive', JSON.stringify(throws));

  let threw = null;
  try { judgeBounded({ ...base, choices: [], graders: [] }); } catch (e) { threw = e; }
  check('D4 an empty answer set is a loud error (bounded judgment needs a set)',
    threw !== null, 'no throw');

  let badGraderErr = null;
  try {
    judgeBounded({ ...base, graders: [{ name: 'rogue', decide: () => 'maybe-not-in-set' }], modelJudge: () => 'pass' });
  } catch (e) { badGraderErr = e; }
  check('D5 a grader deciding outside the closed set is a loud bug, never a verdict',
    badGraderErr !== null && !('verdict' in (badGraderErr || {})), 'no throw');
  check('D6 the loud bug names the offending grader',
    badGraderErr && /rogue/.test(badGraderErr.message), String(badGraderErr));
  check('D7 the model judge does NOT rescue a buggy deterministic grader',
    badGraderErr !== null, 'judge should not have been reached');
}

// ---- E. The K6 grader factories, both directions ----
{
  const sectionText = '## Verdict\nconstraints satisfied: yes';
  const pass = requiredSection(sectionText, 'pass');
  check('E1 requiredSection decides when the section is present',
    pass.decide(sectionText) === 'pass', String(pass.decide(sectionText)));
  check('E2 requiredSection abstains when the section is absent (null, not a guess)',
    pass.decide('no heading here') === null, String(pass.decide('no heading here')));

  const forb = forbiddenPattern(/API[_-]?KEY/i, 'fail');
  check('E3 forbiddenPattern decides when the pattern matches', forb.decide('contains API_KEY') === 'fail');
  check('E4 forbiddenPattern abstains when it does not match', forb.decide('clean text') === null);

  const len = outputLength({ min: 1, max: 10 }, 'fail');
  check('E5 outputLength decides when the bound is violated', len.decide('this is far longer than ten') === 'fail');
  check('E6 outputLength abstains inside the bounds', len.decide('ok') === null);

  check('E7 each factory carries a stable name (the verdict can name who decided)',
    pass.name.startsWith('required-section') && forb.name.startsWith('forbidden-pattern')
      && len.name.startsWith('output-length'), JSON.stringify([pass.name, forb.name, len.name]));
}

// ---- F. The AC7 line: verdict always in the closed set ∪ {inconclusive} ----
{
  const cases = [
    judgeBounded({ question: 'q', choices: ['pass', 'fail'], evidence: 'e', graders: [{ name: 'g', decide: () => 'pass' }] }),
    judgeBounded({ question: 'q', choices: ['pass', 'fail'], evidence: 'e', graders: [] }),
    judgeBounded({ question: 'q', choices: ['pass', 'fail'], evidence: 'e', graders: [], modelJudge: () => 'fail' }),
  ];
  check('F1 every verdict is in the declared set or inconclusive',
    cases.every((r) => ['pass', 'fail', 'inconclusive'].includes(r.verdict)),
    JSON.stringify(cases));
  check('F2 the question rides along (one question = one verdict, K7)',
    cases.every((r) => r.question === 'q'), JSON.stringify(cases.map((r) => r.question)));
  check('F3 by is a closed value: deterministic | model | none',
    cases.map((r) => r.by).join(',') === 'deterministic,none,model',
    JSON.stringify(cases.map((r) => r.by)));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `FAIL: ${failures} expectation(s) broken.`}`);
process.exit(failures === 0 ? 0 : 1);
