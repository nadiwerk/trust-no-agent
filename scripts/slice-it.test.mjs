#!/usr/bin/env node
/**
 * Fail-first test for skills/engineering/slice-it/SKILL.md — the pre-chain
 * split-suggestion skill (spec: docs/specs/slice-it.md, ticket
 * 02-slice-it-skill).
 *
 * Zero dependencies. Run: node scripts/slice-it.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = skill content drift.
 *
 * Seam: the SKILL.md text itself — the contract a loading agent reads.
 * Assertions name the phrasing the spec fixes (AC3–AC7), not implementation
 * detail: expected substrings are hand-written literals from the spec, never
 * derived from the file's own output.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills', 'engineering', 'slice-it', 'SKILL.md');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

check('A1 skills/engineering/slice-it/SKILL.md exists', existsSync(SKILL));
const text = existsSync(SKILL) ? readFileSync(SKILL, 'utf8') : '';

// ---- A. Invocation axis: model-invoked (spec §Decisions — automatic suggestion) ----
{
  check('A2 frontmatter names the skill slice-it', /^name:\s*slice-it/m.test(text));
  check('A3 skill is model-invoked (no disable-model-invocation)',
    !/disable-model-invocation:\s*true/.test(text));
}

// ---- B. Full-stack proposal table (spec §Solution, AC1) ----
{
  const header = text.split('\n').find((l) => l.trimStart().startsWith('|') && l.includes('Ticket'));
  const cols = ['Ticket', 'Branch', 'Worktree', 'PR', 'Cleanup', 'Verify'];
  check('B1 proposal table carries the six columns',
    !!header && cols.every((c) => header.includes(c)), header ?? 'no table line');
}

// ---- C. Branch + worktree rules (spec §AC3, AC4) ----
{
  check('C1 names plain git worktree for parallel writers', /git worktree/.test(text));
  check('C2 no orca reference anywhere', !/orca/i.test(text));
  check('C3 blocked tickets stack on the blocker\'s branch',
    /blocker'?s branch|stack.*blocker|branch of its blocker/i.test(text));
  check('C4 a PR on an open PR targets that PR\'s branch',
    /targets that PR'?s branch|target.*that PR'?s branch/i.test(text));
}

// ---- D. Teardown contract (spec §AC5) ----
{
  check('D1 teardown uses git worktree remove', /git worktree remove/.test(text));
  check('D2 teardown deletes merged branches', /git branch -d|branch.*delet/i.test(text));
  check('D3 teardown executes via pr-flow post-merge',
    /pr-flow/.test(text) && /post-merge|after merge|once merged/i.test(text));
}

// ---- E. State serialization + authority (spec §AC6, AC7) ----
{
  check('E1 proposal serializes to .trust/<slug>/plan.md',
    /\.trust\/<slug>\/plan\.md/.test(text));
  check('E2 loop proposal is marked provisional', /provisional/i.test(text));
  check('E3 fork-it is named the authoritative decomposition',
    /fork-it/.test(text) && /authoritative/i.test(text));
}

// ---- F. Gate shape: propose & wait, never a hard gate (spec §Constraints) ----
{
  check('F1 user may approve, override, or skip',
    /approve/i.test(text) && /override/i.test(text) && /skip/i.test(text));
  check('F2 fast class is untouched', /fast/i.test(text));
}

// ---- H. Spec delta: preflight step-0 + Undo column (coverage-check pack item 2) ----
{
  check('H1 a preflight step runs before the slices are drafted',
    /preflight|before .{0,40}(draft|first file|proposal)/i.test(text));
  check('H2 preflight checks a clean tree',
    /git status|clean (tree|checkout|working)/i.test(text));
  const header = text.split('\n').find((l) => l.trimStart().startsWith('|') && l.includes('Ticket'));
  check('H3 proposal table carries the Undo column',
    !!header && header.includes('Undo'), header ?? 'no table line');
  check('H4 Undo column names the retreat command per ticket',
    /Undo[^\n]*(revert|retreat|undo|roll ?back)/i.test(text));
}

// ---- G. Router wiring (spec §AC2 — ticket 03) ----
{
  const AGENTS = join(ROOT, 'AGENTS.md');
  const agents = existsSync(AGENTS) ? readFileSync(AGENTS, 'utf8') : '';
  check('G1 trigger matrix maps full/loop work-start to slice-it',
    /\|[^\n]*full[^\n]*loop[^\n]*\|\s*`?slice-it`?/i.test(agents));
  check('G2 §1 names the split proposal after classify',
    /classify[\s\S]{0,2000}slice-it/i.test(agents));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
