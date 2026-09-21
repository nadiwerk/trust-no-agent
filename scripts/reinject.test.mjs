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

// Fixture: the shape of the repo's own AGENTS.md — the MANDATORY section with
// the laws referenced only in passing ("Iron Law 4"), which is exactly what
// the live install hands the extractor. Structural markers only.
const AGENTS_SHAPED_NO_LAWS = `# trust-no-agent — AGENTS.md (the router)

Rules every agent session follows.

## 2. Trigger matrix

| Situation | Load |
|---|---|
| Writing tests | \`expect-fail\` **MANDATORY** |

### MANDATORY discipline skills — no self-trigger, no exception

- **\`expect-fail\`** — load before writing any test.
- **\`root-cause\`** — load before proposing any fix.
- **\`receipts\`** — load before accepting any "done" claim.

Re-running the install without an explicit "yes" is an unauthorized write to a
shared skill dir (Iron Law 4); detection is mechanical.
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

// ---- D. Graceful degradation, without silent half-blocks ----
// D1 originally asserted "no sections in, empty block out". That contract is
// what let the 2026-09-21 gap hide: a caller handed a router with only one half
// got a block that looked complete. The degradation contract is now *stronger*
// and stated positively — text in, non-empty block out, every missing half
// named — while empty input still yields nothing, so no caller is forced to
// inject an empty husk. AGENTS.md §8 governs here: references degrade and
// execution continues; the block never fabricates a floor it could not find.
{
  const out = buildReinject('no laws here, no mandatory section');
  check('D1 router with neither section still yields a block that names what is missing',
    out.trim() !== '' && /NOT FOUND/.test(out),
    JSON.stringify(out));
  check('D1b the missing-half block names both source files (actionable, not just a flag)',
    /WORKFLOW\.md/.test(out) && /AGENTS\.md/.test(out),
    out);
  check('D2 empty router text does not throw',
    typeof buildReinject('') === 'string');
  check('D3 empty router text yields an empty block (nothing to degrade to)',
    buildReinject('').trim() === '',
    JSON.stringify(buildReinject('')));
}

// ---- E. Size guard: the block stays small (context is a budget, AGENTS.md §8) ----
{
  const long = ROUTER + '\n'.repeat(1) + 'filler\n'.repeat(400);
  const out = buildReinject(long);
  check('E1 block is bounded regardless of router size (< 4000 chars)',
    out.length > 0 && out.length < 4000,
    String(out.length));
}

// ---- F. The laws' real shape: no fence, and outside the file that is passed ----
// Regression fixture for the 2026-09-21 gap: the suite above only ever fed
// buildReinject a fenced ## Iron Laws section, a shape NO file in this repo
// has. The four laws live in WORKFLOW.md as a nested list item under
// "3. **The four Iron Laws**:" inside "## The four principles" — no fence, no
// heading. Against the real repo the extractor returned the MANDATORY section
// alone (len 2545, Iron Laws absent) and every expectation above still passed,
// because they all shared the same fictional assumption. These checks use the
// real shapes.
{
  const LIST_FORM = `# WORKFLOW.md — core rules

Non-negotiable. Procedure detail lives in AGENTS.md and the skills.

## The four principles

1. **Surface assumptions before building.** Hidden assumptions get surfaced.

2. **Simplicity first.** The simplest implementation that solves today's problem.

3. **The four Iron Laws**:
   - No acting until the user confirms shared understanding.
   - No production code without a failing test first.
   - No completion claims without fresh verification evidence.
   - No expensive, irreversible, or shared-system action (commit, push, publish, delete, destructive migration) without the user's explicit sign-off. The agent proposes; the user authorizes.

4. **Facts are the agent's, decisions are the user's.** Self-made decisions get a Ruling line.
`;
  const out = buildReinject(LIST_FORM);
  check('F1 the four laws are extracted from list form (no fence, no heading)',
    /No acting until the user confirms shared understanding/.test(out) &&
    /No production code without a failing test first/.test(out) &&
    /No completion claims without fresh verification evidence/.test(out) &&
    /No expensive, irreversible, or shared-system action/.test(out),
    out);
  check('F2 extracting the laws does not swallow the surrounding principles',
    !/Surface assumptions before building/.test(out) &&
    !/Facts are the agent's, decisions are the user's/.test(out),
    out);
}

// ---- G. A router that is not where the laws are (the real 2-file split) ----
// The live install passes AGENTS.md, which carries the MANDATORY section but
// the laws only as passing references ("Iron Law 4"). Extraction and the
// "degrade, never hard-fail" contract (AGENTS.md §8) collide here by design:
// the block must be non-empty (degrade) but must NOT fabricate laws it cannot
// find, and the real gap must stay visible rather than silently absorbed.
{
  const out = buildReinject(AGENTS_SHAPED_NO_LAWS);
  check('G1 one-source router: MANDATORY section still extracted, no fabricated laws',
    /expect-fail/.test(out) && !/NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST/.test(out),
    out);
  check('G2 the extracted block names which half it could not find',
    /Iron Laws/.test(out) && /WORKFLOW\.md/.test(out),
    out);
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll reinject expectations hold.');
process.exit(failures ? 1 : 0);
