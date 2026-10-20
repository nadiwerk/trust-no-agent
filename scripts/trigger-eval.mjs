#!/usr/bin/env node
/**
 * trigger-eval.mjs — the trigger-eval floor for TNA's own skill registry.
 *
 * Origin: research-external-workflows (2026-10-20, Master adoption ruling
 * "jalankan semua 3 jalur", candidate #6 adopted from agent-skills' Tier 2):
 * TNA checked its 12 skill descriptions by prose rules only (trigger-pure,
 * eval check #3) — the last prose-only layer in the registry. This script
 * adds the deterministic half: a lexical trigger/vocabulary check over the
 * descriptions, keyless and CI-safe (no tokens, no network, no model).
 *
 * What it checks (deterministic, not semantic — the model judges semantics;
 * this catches the two failure modes that dominate real trigger bugs):
 *   1. VOCAB FLOOR   each skill's description carries the vocabulary of the
 *                    situations that must load it (its declared trigger terms).
 *   2. COLLISION     no two descriptions are near-identical lexically (the
 *                    agent-skills collision check, same 75%/50% thresholds).
 *   3. TRIGGER-SHAPE model-invoked skills state a "Use when/Use if" clause.
 *
 * Exit 0 = all hold. Any failure names the skill and the defect.
 * Vocabulary lives here as data (TRIGGERS) — it is the eval's test input,
 * separate from the router's trigger matrix by design: the matrix binds
 * routing, this binds description wording.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The vocabulary users actually say per skill, per domain (bilingual EN/ID —
// the router's trigger matrix and live sessions both carry both).
const TRIGGERS = {
  'breakpoint': ['plan', 'feature', 'stress-test', 'interview'],
  'expect-fail': ['test', 'fail', 'verify', 'prove'],
  'root-cause': ['bug', 'error', 'broken', 'fail', 'why'],
  'receipts': ['done', 'shipped', 'fixed', 'commit', 'pr', 'verification'],
  'no-thanks': ['review feedback', 'verify'],
  'roast-my-code': ['review', 'changes', 'branch', 'pr'],
  'ship-log': ['log', 'ledger', 'finished', 'completed'],
  'breakpoint-variants': [],
  'save-as': ['spec', 'converged', 'written'],
  'fork-it': ['spec', 'tickets', 'breakdown'],
  'make-it-so': ['tickets', 'approved', 'build'],
  'scribe': ['decisions', 'adr', 'glossary', 'recorded'],
  'setup-tna': ['setup', 'onboard', 'install', 'trust-no-agent'],
};

const tokenize = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);

const terms = (text, phrase) => {
  // A phrase (multi-word trigger) holds if all its words appear (order-free);
  // a single word holds if the description contains it as a substring.
  if (phrase.includes(' ')) {
    const words = phrase.split(/\s+/);
    return words.every((w) => text.includes(w));
  }
  return text.includes(phrase);
};

const jaccard = (a, b) => {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
};

const errors = [];
const warns = [];
const skills = [];
for (const cat of readdirSync(join(ROOT, 'skills'))) {
  const dir = join(ROOT, 'skills', cat);
  for (const name of readdirSync(dir)) {
    const f = join(dir, name, 'SKILL.md');
    if (!existsSync(f)) continue;
    const t = readFileSync(f, 'utf8');
    const m = t.match(/^description:\s*(.+)$/m);
    if (!m) { errors.push(`${name}: no description line`); continue; }
    skills.push({ name, desc: m[1], isUserInvoked: /disable-model-invocation:\s*true/.test(t) });
  }
}

// 1. Vocabulary floor
for (const { name, desc } of skills) {
  const wanted = TRIGGERS[name];
  if (!wanted) { errors.push(`${name}: no trigger vocabulary declared in trigger-eval.mjs (add it — the floor cannot check what it does not know)`); continue; }
  const lower = desc.toLowerCase();
  const missing = wanted.filter((w) => !terms(lower, w));
  if (missing.length)
    errors.push(`${name}: description missing trigger vocabulary: ${missing.join(', ')} (users saying these words must route here)`);
}

// 2. Pairwise collision (agent-skills thresholds: error >= 0.75, warn >= 0.50)
for (let i = 0; i < skills.length; i++)
  for (let j = i + 1; j < skills.length; j++) {
    const sim = jaccard(skills[i].desc, skills[j].desc);
    if (sim >= 0.75) errors.push(`${skills[i].name} <-> ${skills[j].name}: descriptions collide (similarity ${(sim * 100).toFixed(0)}% >= 75%) — a prompt matching one may route to the other`);
    else if (sim >= 0.50) warns.push(`${skills[i].name} <-> ${skills[j].name}: descriptions near-collide (${(sim * 100).toFixed(0)}%)`);
  }

// 3. Trigger-shape on model-invoked skills (the loadable ones NEED a "when")
for (const { name, desc, isUserInvoked } of skills)
  if (!isUserInvoked && !/\buse when\b|\buse if\b|\bwhenever\b/i.test(desc))
    errors.push(`${name}: model-invoked skill description carries no "Use when" clause (the trigger is the contract)`);

if (warns.length) console.log(`warnings:\n  ${warns.join('\n  ')}`);
if (errors.length) { console.error(`FAIL: ${errors.length} trigger-eval error(s)\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`OK: trigger-eval floor holds for ${skills.length} skills (vocab floor, collision, trigger-shape)`);
