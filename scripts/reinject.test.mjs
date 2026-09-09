#!/usr/bin/env node
/**
 * Fail-first test for scripts/reinject.mjs — the router re-injection module.
 * Zero dependencies. Run: node scripts/reinject.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = re-injection behavior drift.
 *
 * Seam: buildReinject(routerText) — a pure function taking the router's text
 * and returning the block to re-inject after compaction/resume. Fixtures are
 * hand-written literals (independent source of truth), never copied from
 * implementation output.
 *
 * Why it exists (ledger 2026-09-10): AGENTS.md re-injection after compaction
 * is harness-dependent — a harness that drops it leaves the Iron Laws and the
 * MANDATORY skill contract out of context, and the ledger compensation relies
 * on the agent's initiative to re-read (evals: initiative-based components
 * fail silently). A written artifact the harness can print mechanically is
 * the closure: the block is derived from the router itself, so it cannot
 * drift from what it re-injects.
 */
import { buildReinject } from './reinject.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// Fixture: a minimal router-shaped text carrying the three things the block
// must preserve. Hand-written, independent of the real AGENTS.md wording —
// only the structural markers are shared by contract.
const ROUTER = `# Router

Some preamble that must NOT be re-injected verbatim as-is.

## Iron Laws

\`\`\`
NO ACTING until the user confirms shared understanding.
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.
NO EXPENSIVE, IRREVERSIBLE, OR SHARED-SYSTEM ACTION WITHOUT EXPLICIT HUMAN SIGN-OFF.
\`\`\`

## MANDATORY discipline skills

- expect-fail — load before writing any test.
- root-cause — load before proposing any fix.
- receipts — load before any done claim.
`;

// ---- A. The block carries the Iron Laws ----
{
  const out = buildReinject(ROUTER);
  check('A1 output contains the Iron Laws fence body',
    out.includes('NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST') &&
    out.includes('NO "DONE" CLAIM WITHOUT FRESH VERIFICATION EVIDENCE'),
    out);
  check('A2 all four laws survive extraction',
    /NO ACTING until the user confirms/.test(out) &&
    /WITHOUT EXPLICIT HUMAN SIGN-OFF/.test(out),
    out);
}

// ---- B. The block carries the MANDATORY contract ----
{
  const out = buildReinject(ROUTER);
  check('B1 the three MANDATORY skills are named',
    out.includes('expect-fail') && out.includes('root-cause') && out.includes('receipts'),
    out);
  check('B2 the MANDATORY framing survives (not just a skill list)',
    /MANDATORY/.test(out),
    out);
}

// ---- C. Drift resistance: the block is derived, not a hardcoded copy ----
{
  const mutated = ROUTER.replace('NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.',
    'NO SHIPPED CODE WITHOUT A FAILING TEST FIRST.');
  const out = buildReinject(mutated);
  check('C1 editing the router changes the block (derived, not cached)',
    out.includes('NO SHIPPED CODE WITHOUT A FAILING TEST FIRST') &&
    !out.includes('NO PRODUCTION CODE WITHOUT'),
    out);
}

// ---- D. Graceful degradation ----
{
  const out = buildReinject('no laws here, no mandatory section');
  check('D1 router without the sections yields an empty block (caller skips the inject)',
    out.trim() === '',
    JSON.stringify(out));
  check('D2 empty router text does not throw',
    typeof buildReinject('') === 'string');
}

// ---- E. Size guard: the block stays small (context is a budget, AGENTS.md §8) ----
{
  const long = ROUTER + '\n'.repeat(1) + 'filler\n'.repeat(400);
  const out = buildReinject(long);
  check('E1 block is bounded regardless of router size (< 4000 chars)',
    out.length > 0 && out.length < 4000,
    String(out.length));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll reinject expectations hold.');
process.exit(failures ? 1 : 0);
