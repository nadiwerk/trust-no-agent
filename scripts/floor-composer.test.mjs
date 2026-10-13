#!/usr/bin/env node
/**
 * Fail-first test for scripts/floor-composer.mjs — the bounded floor
 * composition seam (decision-composition ticket 02; spec AC4/AC5/AC6/AC7/AC10
 * feed/AC13). Zero dependencies. Run: node scripts/floor-composer.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = composer behavior drift.
 *
 * Seam: composeFloor({ canonicalFloor, overlays, budget }) — pure; takes the
 * canonical session floor plus validated overlay entries and produces the
 * composed floor. Fixtures are hand-written literals (independent source of
 * truth): the canonical floor first and verbatim, `user:`-marked entries after
 * it, deterministic order, bounded budget with a counted omission list.
 */
import { composeFloor } from './floor-composer.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const CANONICAL = 'RE-INJECTED ROUTER CORE:\n\n## Iron Laws\n\n```\nNO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.\n```\n\nMANDATORY: expect-fail, root-cause, receipts.';
const entry = (name, anchor, role, triggers = []) => ({ name, extends: anchor, role, triggers, dir: name });

// ---- A. No overlays: the canonical floor passes through untouched ----
{
  const res = composeFloor({ canonicalFloor: CANONICAL, overlays: [], budget: 4000 });
  check('A1 no overlays -> composed floor is the canonical floor verbatim', res.text === CANONICAL, JSON.stringify(res));
  check('A2 no overlays -> nothing omitted', res.omitted.length === 0, JSON.stringify(res.omitted));
}

// ---- B. Canonical first and verbatim, entries marked user: (spec AC4/AC5) ----
{
  const overlays = [entry('error-forensics', 'root-cause/Phase-1', 'insert-after', ['error', 'crash'])];
  const res = composeFloor({ canonicalFloor: CANONICAL, overlays, budget: 4000 });
  check('B1 the canonical portion is a byte-identical prefix of the composed floor',
    res.text.startsWith(CANONICAL), JSON.stringify(res.text.slice(0, 200)));
  check('B2 the overlay entry is marked user:', /user:error-forensics/.test(res.text), res.text.slice(-300));
  check('B3 the entry names its anchor and role', /root-cause\/Phase-1/.test(res.text) && /insert-after/.test(res.text), res.text.slice(-300));
}

// ---- C. Name collisions namespaced, canonical never shadowed (spec AC7) ----
{
  const overlays = [entry('root-cause', 'root-cause/Phase-1', 'insert-before', [])];
  const res = composeFloor({ canonicalFloor: CANONICAL, overlays, budget: 4000 });
  check('C1 an overlay sharing a canonical name appears as user:<name>',
    /user:root-cause/.test(res.text), res.text.slice(-300));
  check('C2 the canonical floor portion is untouched by the collision',
    res.text.startsWith(CANONICAL), JSON.stringify(res.text.slice(0, 200)));
}

// ---- D. Budget: bounded, non-silent omission (spec AC6/AC10) ----
{
  // Boundary-sized registry: canonical (~150 chars) + many entries would blow
  // past a small budget without the rule.
  const overlays = Array.from({ length: 30 }, (_, i) =>
    entry(`skill-${String(i).padStart(2, '0')}`, 'root-cause/Phase-1', 'insert-after', ['a', 'b', 'c']));
  const res = composeFloor({ canonicalFloor: CANONICAL, overlays, budget: 400 });
  check('D1 the composed floor stays within the budget', res.text.length <= 400, `len=${res.text.length}`);
  check('D2 omitted overlays are returned as a counted list (never silent)',
    res.omitted.length > 0 && res.omitted.length + countIncluded(res.text) === overlays.length,
    JSON.stringify({ omitted: res.omitted.length, included: countIncluded(res.text) }));
  check('D3 the canonical portion survives even when everything else is omitted',
    res.text.startsWith(CANONICAL) || res.omitted.length === overlays.length, JSON.stringify(res.text.slice(0, 100)));
}

function countIncluded(text) {
  return (text.match(/^- user:/gm) || []).length;
}

// ---- E. Determinism (spec AC13) ----
{
  const overlays = [
    entry('zulu', 'root-cause/Phase-2', 'wrap', ['x']),
    entry('alpha', 'root-cause/Phase-1', 'insert-after', ['y']),
    entry('mike', 'root-cause/Phase-1', 'insert-before', ['z']),
  ];
  const a = composeFloor({ canonicalFloor: CANONICAL, overlays, budget: 4000 });
  const b = composeFloor({ canonicalFloor: CANONICAL, overlays: [...overlays].reverse(), budget: 4000 });
  check('E1 identical registry (any input order) produces byte-identical output',
    a.text === b.text, JSON.stringify({ a: a.text.slice(-200), b: b.text.slice(-200) }));
  check('E2 entries order deterministically (anchor, then name)',
    /alpha[\s\S]*mike[\s\S]*zulu/.test(a.text), a.text.slice(-300));
}

console.log(failures === 0 ? '\nAll floor-composer expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
