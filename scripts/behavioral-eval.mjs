#!/usr/bin/env node
/**
 * Behavioral eval harness — offline validator for cases, rubric, and judge
 * template. Zero dependencies. Companion to scripts/eval.mjs (static tier).
 *
 * Run:  node scripts/behavioral-eval.mjs [dir]     (default: scripts/behavioral-eval/)
 * Exit 0 = harness files consistent. Exit 1 = drift found.
 *
 * Why it exists (ledger 2026-09-10): eval.mjs proves rules EXIST — markers,
 * wiring, literal strings. It cannot prove rules CHANGE BEHAVIOR. The
 * behavioral tier is that second proof: scored cases (baseline prompt vs
 * prompt-with-framework) graded by a blind judge on a weighted rubric.
 * A harness whose fixtures are malformed silently reports nothing, and a
 * silent harness is worse than none — so the offline validator keeps the
 * files honest: cases parse, ids are unique, rubric weights sum to 1, every
 * case exercises a known dimension, and the judge prompt stays blind.
 *
 * The LLM runner itself stays external (any CLI that can prompt a model);
 * this repo owns the contract, not the runner. See scripts/behavioral-eval/
 * README.md for the run protocol and an honest-limits note on sample sizes.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- core validator (exported; the test imports this seam) ----

export function validateBehavioralEval({ casesText, rubricText, judgeText }) {
  const errors = [];

  // Cases: JSONL, unique ids, each with prompt + dimensions.
  const seen = new Set();
  const dims = new Set();
  let caseCount = 0;
  for (const [i, line] of (casesText || '').split('\n').entries()) {
    const ln = line.trim();
    if (!ln) continue;
    let obj;
    try { obj = JSON.parse(ln); } catch { errors.push(`cases line ${i + 1}: not valid JSON`); continue; }
    caseCount++;
    if (!obj.id || typeof obj.id !== 'string') errors.push(`cases line ${i + 1}: missing string "id"`);
    else if (seen.has(obj.id)) errors.push(`cases: duplicate case id "${obj.id}"`);
    else seen.add(obj.id);
    if (!obj.prompt || typeof obj.prompt !== 'string') errors.push(`cases line ${i + 1}: missing string "prompt"`);
    if (!Array.isArray(obj.dimensions) || !obj.dimensions.length)
      errors.push(`cases line ${i + 1}: "dimensions" must be a non-empty array`);
  }

  // Rubric: weighted dimension table summing to 1, plus the anti-fabrication
  // dimension. Evidence (2026-09-10): a "cause, then fix" reporting rule
  // measurably pressured the model into asserting a definitive cause without
  // evidence — the reporting-format cousin of certifying the bug. The harness
  // scores that failure mode explicitly or it can regress invisibly.
  const ANTI_FAB = 'error-causal-honesty';
  const weightRe = /^\|\s*([a-z0-9-]+)\s*\|\s*(\d(?:\.\d+)?)\s*\|/gim;
  const weights = new Map();
  let m;
  while ((m = weightRe.exec(rubricText || ''))) weights.set(m[1].toLowerCase(), parseFloat(m[2]));
  if (!weights.size) errors.push('rubric: no weighted dimension table found (| dimension | weight | rows)');
  else {
    const sum = [...weights.values()].reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.01) errors.push(`rubric: weights sum to ${sum}, expected 1`);
  }
  if (!weights.has(ANTI_FAB))
    errors.push(`rubric: missing the anti-fabrication dimension "${ANTI_FAB}" (penalizes asserting a definitive cause without evidence)`);
  for (const d of weights.keys()) dims.add(d);

  // Judge: blind — must not assign condition identity to a labeled response.
  const judge = judgeText || '';
  if (!judge.trim()) errors.push('judge: prompt template missing');
  else {
    if (!/RESPONSE_[AB]/.test(judge)) errors.push('judge: prompt must reference the anonymized RESPONSE_A / RESPONSE_B placeholders');
    if (/candidate|baseline/i.test(judge.replace(/RESPONSE_[AB]/g, '')))
      errors.push('judge: not blind — the prompt must never tie RESPONSE_A/B to a condition (baseline/candidate); scoring must be condition-blind');
  }

  // Cross-wiring: every case dimension must exist in the rubric.
  for (const [i, line] of (casesText || '').split('\n').entries()) {
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    for (const d of obj.dimensions || [])
      if (!dims.has(String(d).toLowerCase()))
        errors.push(`cases line ${i + 1}: dimension "${d}" is not defined in the rubric`);
  }

  return { errors, caseCount, dimensionCount: dims.size };
}

// ---- CLI wrapper ----
if (process.argv[1] && process.argv[1].endsWith('behavioral-eval.mjs')) {

const dir = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), 'behavioral-eval');
const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');

const res = validateBehavioralEval({
  casesText: read('cases.jsonl'),
  rubricText: read('rubric.md'),
  judgeText: read('judge.md'),
});

for (const e of res.errors) console.log('ERROR ' + e);
console.log(`cases: ${res.caseCount}, dimensions: ${res.dimensionCount}`);
if (res.errors.length) {
  console.error(`\nFAIL: ${res.errors.length} harness error(s).`);
  process.exit(1);
}
console.log('\nBehavioral-eval harness files consistent.');
}
