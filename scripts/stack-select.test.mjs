#!/usr/bin/env node
/**
 * Fail-first test for scripts/stack-select.mjs — the prompt-admission stack
 * selector that attaches skills to matching prompts (spec:
 * docs/specs/slice-it.md, ticket 01-stack-select-signal).
 *
 * Zero dependencies. Run: node scripts/stack-select.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = rule drift.
 *
 * Seam: stackSkillsForPrompt(text) — a pure function taking prompt text and
 * returning the skill names to attach. Expected verdicts are hand-written
 * literals derived from the spec's intent (spec §AC8), never from running
 * the code.
 */
import { stackSkillsForPrompt } from './stack-select.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Split/breakdown prompts emit slice-it (spec §AC8) ----
{
  const cases = [
    'split this work into tickets and branches',
    'pecah pekerjaan ini jadi tiket dan PR',
    'break this down into reviewable chunks',
    'usulkan pemecahan kerja berdasarkan tiket, branch, worktree',
  ];
  for (const prompt of cases) {
    check(`A emits slice-it for: "${prompt.slice(0, 48)}..."`,
      stackSkillsForPrompt(prompt).includes('slice-it'),
      JSON.stringify(stackSkillsForPrompt(prompt)));
  }
}

// ---- B. slice-it attaches alongside the small-PRs stack, never duplicated ----
{
  const v = stackSkillsForPrompt('split this PR into reviewable chunks');
  check('B1 slice-it present with engineering-small-prs',
    v.includes('slice-it') && v.includes('engineering-small-prs'),
    JSON.stringify(v));
  check('B2 no duplicate slice-it entries',
    v.filter((n) => n === 'slice-it').length === 1, JSON.stringify(v));
}

// ---- C. Unrelated prompts do not emit slice-it ----
{
  const negatives = [
    'fix the typo in the README',
    'babysit this PR',
    'write a failing test for the parser',
  ];
  for (const prompt of negatives) {
    check(`C no slice-it for: "${prompt}"`,
      !stackSkillsForPrompt(prompt).includes('slice-it'),
      JSON.stringify(stackSkillsForPrompt(prompt)));
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
