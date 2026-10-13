#!/usr/bin/env node
/**
 * Behavioral eval runner — Anthropic-compatible messages API (any endpoint via
 * env: ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL).
 * Zero dependencies. The LLM runner is external by design
 * (scripts/behavioral-eval/README.md); this file is the contract implementation.
 *
 * Run:  node scripts/behavioral-eval/run.mjs [--trials 3] [--dry]
 *       BEHAVIORAL_EVAL_OUT=<dir> to keep raw transcripts (default .tmp/behavioral-eval, gitignored)
 *
 * Protocol: per case, the responder runs twice — baseline (bare case prompt)
 * and candidate (case prompt prefixed with the framework core) — N trials
 * each. Each (case, trial) pair is graded by ONE blind judge call with A/B
 * labels shuffled per trial. The judge never sees condition identity.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- offline-computable pieces (unit-tested by run.test.mjs) ----

// Candidate prefix: the framework core the responder gets. Derived from the
// router via reinject (single source of truth) + the receipt shape.
export function buildCandidatePrefix(reinjectBlock, chatReceiptText) {
  const receiptShape = (chatReceiptText.match(/```md\n([\s\S]*?)```/) || [, ''])[1].trim();
  return [
    'You are an AI coding agent working in a repository. Follow these non-negotiable rules in your reply.',
    '',
    reinjectBlock.trim(),
    '',
    'When closing out a unit of work, reply in this 4-block shape (fill the placeholders):',
    '```md',
    receiptShape,
    '```',
    '',
    'Never assert a cause the evidence does not support: if the evidence underdetermines the cause, say what is uncertain.',
    '',
    'Side findings (issues you noticed but were not asked about): suppress them. Finish the asked task first, then surface a side finding ONCE at the very end as a separate one-line offer — never interleave it into the main answer, never do it unasked.',
    '',
    'A claim about a rendered artifact (page, UI, site) is verified by going to that artifact — open/curl the rendered page and check it. Never answer a rendered-claim question from memory of the source alone, and never refuse to verify: the verification action IS the answer.',
  ].join('\n');
}

// Deterministic shuffle for a trial: swaps A/B when (caseIndex + trial) is odd.
// The judge must not be able to infer condition from label position.
export function assignLabels(caseIndex, trial) {
  return (caseIndex + trial) % 2 === 0
    ? { A: 'baseline', B: 'candidate' }
    : { A: 'candidate', B: 'baseline' };
}

// Weighted mean across dimensions for one judged response.
export function scoreResponse(scores, weights) {
  let sum = 0, wsum = 0;
  for (const [dim, w] of Object.entries(weights)) {
    if (scores[dim] == null) continue;
    sum += scores[dim] * w; wsum += w;
  }
  return wsum ? sum / wsum : 0;
}

// Fault tag (findings-adaptation 01/AC2): a missing measurement is infrastructure,
// never the agent. Judge-failed rows and API-level aborts are infra; only a
// graded row attributes to the agent.
export function classifyFault({ judged = null, apiError = null } = {}) {
  if (apiError) return 'infra';
  if (!judged) return 'infra';
  return 'agent';
}

// Row seam (findings-adaptation 01/AC2; roast fix 2026-10-13): every trial becomes
// a row THROUGH THIS FUNCTION — graded rows carry fault: agent, ungraded
// (api error / judge failure) rows carry fault: infra and skipped: true.
// Main must never build rows inline; the wiring check (run.test G1-G2) pins
// the call sites. A dropped trial is an invisible one; an infra row is counted.
export function makeTrialRow({ id, trial, labels, judged = null, apiError = null }) {
  const fault = classifyFault({ judged, apiError });
  if (!judged) return { id, trial, labels, skipped: true, fault };
  return {
    id, trial, labels, fault,
    A: Object.fromEntries(Object.entries(judged.A || {}).map(([k, v]) => [k, v.score])),
    B: Object.fromEntries(Object.entries(judged.B || {}).map(([k, v]) => [k, v.score])),
    evidence: { A: judged.A, B: judged.B },
  };
}

// Trial summary per case (findings-adaptation 01/AC8): pass = candidate strictly
// above baseline on the weighted mean; flakiness = population variance of
// per-trial deltas. Scoreless (infra-skipped) trials count separately and
// never enter the rate — an unmeasured trial is not a failed trial.
export function summarizeTrials(rows, weights) {
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  const out = {};
  for (const [id, list] of byId) {
    const scored = list.filter((r) => !r.skipped);
    const deltas = scored.map((r) => scoreResponse(r.B, weights) - scoreResponse(r.A, weights));
    const pass = deltas.filter((d) => d > 0).length;
    const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const variance = deltas.length
      ? deltas.reduce((a, b) => a + (b - mean) * (b - mean), 0) / deltas.length
      : 0;
    // pass@k (capability) and pass^k (reliability) — corpus K12-K14.
    // pass@k = 1 − C(n−c, k)/C(n, k): the unbiased estimator of "at least
    // one of k tries passes". pass^k = (c/n)^k: the i.i.d. reliability of
    // "all k tries pass". The gap between them IS the flakiness story — a
    // case with high pass@k but low pass^k passes sometimes and is not
    // something to ship on. Ladder k = 1..3 (the default trial budget);
    // pass@k is null when k exceeds the scored count — a k beyond the
    // evidence would fabricate a number, so it stays absent (fail-closed).
    const passAtK = {}, passPowK = {};
    for (let k = 1; k <= 3; k++) {
      passAtK[k] = k <= scored.length
        ? Math.round((1 - comb(scored.length - pass, k) / comb(scored.length, k)) * 1000) / 1000
        : null;
      passPowK[k] = scored.length
        ? Math.round(Math.pow(pass / scored.length, k) * 1000) / 1000
        : null;
    }
    out[id] = {
      trials: list.length,
      scored: scored.length,
      infraSkips: list.length - scored.length,
      pass: pass,
      passRate: scored.length ? pass / scored.length : 0,
      passAtK,
      passPowK,
      meanDelta: Math.round(mean * 1000) / 1000,
      flakiness: Math.round(variance * 1000) / 1000,
    };
  }
  return out;
}

// Integer binomial C(n,k) for the pass@k estimator; 0 when k > n.
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

export function parseWeights(rubricText) {
  const weights = {};
  for (const m of rubricText.matchAll(/^\|\s*([a-z0-9-]+)\s*\|\s*(\d(?:\.\d+)?)\s*\|/gim))
    weights[m[1].toLowerCase()] = parseFloat(m[2]);
  return weights;
}

// ---- API ----

async function callApi(prompt, maxTokens) {
  const base = process.env.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  const model = process.env.ANTHROPIC_MODEL;
  if (!base || !token || !model) throw new Error('ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL must be set');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return text.trim();
}

// Judge: one call per (case, trial), blind, JSON out.
async function judgeResponse(judgeTemplate, casePrompt, respA, respB, dims) {
  const filled = judgeTemplate
    .replace('<case prompt inserted here>', casePrompt)
    .replace('RESPONSE_A:\n<text>', 'RESPONSE_A:\n' + respA)
    .replace('RESPONSE_B:\n<text>', 'RESPONSE_B:\n' + respB)
    .replace('Dimensions: correctness, actionability, state-restatement,\nerror-causal-honesty, completion-honesty, artifact-target,\ntangent-suppression, test-first, estimate-concreteness,\ncontext-confirmation, spec-gate.', '');
  const raw = await callApi(filled + `\nScore these dimensions: ${dims.join(', ')}. Output the JSON object only.`, 16000);
  return parseJudgeJson(raw);
}

// Lenient judge-JSON parser: the judge model may emit fences, prose, trailing
// commas, or single quotes. Throws only when no object can be recovered.
export function parseJudgeJson(raw) {
  let text = raw.replace(/```(?:json)?/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('judge returned no JSON: ' + raw.slice(0, 200));
  text = text.slice(start, end + 1)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(text);
  } catch {
    // Single-quoted keys/values fallback.
    const fixed = text.replace(/'([^'\\]*)'/g, '"$1"');
    return JSON.parse(fixed);
  }
}

// ---- main ----

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {

const args = process.argv.slice(2);
const TRIALS = parseInt(args[args.indexOf('--trials') + 1] || '3', 10) || 3;
const DRY = args.includes('--dry');
const SPLIT = (args[args.indexOf('--split') + 1] || 'test').toLowerCase();
if (SPLIT !== 'dev' && SPLIT !== 'test') { console.error('FAIL: --split must be dev or test'); process.exit(1); }
const DIR = join(dirname(fileURLToPath(import.meta.url)));
// The split is the DIRECTORY, not a field (findings-adaptation 01/AC1; spec
// "direktori dev/ vs test/ berbeda, bukan flag"): --split selects which
// side to run. A missing side fails loudly — never silently runs the other.
const splitFile = join(DIR, SPLIT, 'cases.jsonl');
if (!existsSync(splitFile)) { console.error(`FAIL: ${SPLIT}/cases.jsonl missing — the split is the directory, not a field`); process.exit(1); }
const OUT = process.env.BEHAVIORAL_EVAL_OUT || join(ROOT, '.tmp', 'behavioral-eval');

const cases = readFileSync(splitFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log('split=' + SPLIT + ' cases=' + cases.length);
const rubric = readFileSync(join(DIR, 'rubric.md'), 'utf8');
const judgeTemplate = readFileSync(join(DIR, 'judge.md'), 'utf8');
const weights = parseWeights(rubric);
const dims = Object.keys(weights);
// Both router files: the laws live in WORKFLOW.md, the MANDATORY section in
// AGENTS.md. Passing AGENTS.md alone yields a half floor (2026-09-21 finding).
const reinjectSrc = readFileSync(join(ROOT, 'scripts', 'reinject.mjs'), 'utf8');
const reinjectBlock = reinjectSrc && (await import('../reinject.mjs')).buildReinject(
  readFileSync(join(ROOT, 'WORKFLOW.md'), 'utf8') + '\n\n' + readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
);
const chatReceiptText = readFileSync(join(ROOT, 'docs', 'chat-receipt.md'), 'utf8');
const candidatePrefix = buildCandidatePrefix(reinjectBlock, chatReceiptText);

if (DRY) {
  console.log(`dry: ${cases.length} cases, trials=${TRIALS}, dims=${dims.length}, prefix=${candidatePrefix.length} chars`);
  console.log(candidatePrefix.slice(0, 400));
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [ci, c] of cases.entries()) {
  for (let t = 0; t < TRIALS; t++) {
    const labels = assignLabels(ci, t);
    let baseline = null, candidate = null, apiError = null;
    try {
      baseline = await callApi(c.prompt, 16000);
      candidate = await callApi(candidatePrefix + '\n\n---\n\n' + c.prompt, 16000);
    } catch (e) {
      apiError = e;
      console.error(`api fail ${c.id} trial ${t}: ${e.message}`);
    }
    if (apiError) {
      // API-level abort: infra row, kept and counted — never charged to the agent.
      rows.push(makeTrialRow({ id: c.id, trial: t, labels, apiError }));
      writeFileSync(join(OUT, 'rows.json'), JSON.stringify(rows, null, 1));
      continue;
    }
    const textA = labels.A === 'baseline' ? baseline : candidate;
    const textB = labels.B === 'baseline' ? baseline : candidate;
    // Archive responder transcripts BEFORE judging — a judge failure must not
    // burn the responder output (each call costs a full thinking budget).
    const transcript = `# ${c.id} trial ${t}\n\n## prompt\n\n${c.prompt}\n\n## baseline (as ${labels.A})\n\n${baseline}\n\n## candidate (as ${labels.B})\n\n${candidate}\n`;
    let judged = null;
    for (let attempt = 0; attempt < 2 && !judged; attempt++) {
      try { judged = await judgeResponse(judgeTemplate, c.prompt, textA, textB, dims); }
      catch (e) {
        console.error(`judge fail ${c.id} trial ${t} attempt ${attempt + 1}: ${e.message}`);
        if (attempt === 1) writeFileSync(join(OUT, `${c.id}-t${t}.md`), transcript + '\n(JUDGE FAILED)\n');
      }
    }
    if (!judged) {
      // Judge failure: infra row, kept and counted — never dropped, never the agent.
      rows.push(makeTrialRow({ id: c.id, trial: t, labels, judged: null }));
      writeFileSync(join(OUT, 'rows.json'), JSON.stringify(rows, null, 1));
      console.log(`${c.id} t${t}: judge failed -> infra skip`);
      continue;
    }
    const row = makeTrialRow({ id: c.id, trial: t, labels, judged });
    rows.push(row);
    writeFileSync(join(OUT, 'rows.json'), JSON.stringify(rows, null, 1));
    const sA = scoreResponse(row.A, weights), sB = scoreResponse(row.B, weights);
    console.log(`${c.id} t${t}: A=${labels.A} ${sA.toFixed(2)} | B=${labels.B} ${sB.toFixed(2)}`);
    // transcript archive (append the judge output to the pre-judge transcript)
    writeFileSync(join(OUT, `${c.id}-t${t}.md`), transcript + `\n## judge\n\n\`\`\`json\n${JSON.stringify(judged, null, 1)}\n\`\`\`\n`);
  }
}
const infraRows = rows.filter((r) => r.skipped).length;
console.log(`\n${rows.length} rows written to ${OUT}/rows.json (${infraRows} infra-skipped)`);
const summary = summarizeTrials(rows, weights);
const infraTotal = rows.filter((r) => r.fault === 'infra').length;
const fmt = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(2));
for (const [id, s] of Object.entries(summary))
  console.log(`  ${id}: trials=${s.trials} scored=${s.scored} passRate=${s.passRate.toFixed(2)} pass@3=${fmt(s.passAtK[3])} rel^3=${fmt(s.passPowK[3])} meanDelta=${s.meanDelta} flakiness=${s.flakiness} infraSkips=${s.infraSkips}`);
console.log(`faults: infra=${infraTotal} agent=${rows.length - infraTotal}`);
}
