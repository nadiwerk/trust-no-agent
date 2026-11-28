#!/usr/bin/env node
/**
 * Fail-first test for scripts/plan-check.mjs — the plan-vs-actual checker.
 * Zero dependencies. Run: node scripts/plan-check.test.mjs
 *
 * Seam: checkPlan(planPath, { root }) over .trust/<slug>/plan.md files.
 * What can be checked mechanically, is checked mechanically: every ticket row
 * carries a Verify command that is a declared repo gate (never "run the
 * tests"), the named branch resolves or is reported (landed+deleted is
 * legitimate — warn, never error), and declared issue files exist when an
 * issues dir is present. A plan with no proposal table is a structural error.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPlan } from './plan-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const planDir = () => {
  const root = mkdtempSync(join(tmpdir(), 'plan-check-'));
  const dir = join(root, '.trust', 'x');
  mkdirSync(dir, { recursive: true });
  return { root, file: join(dir, 'plan.md') };
};

const GOOD = `| # | Ticket | Branch | Worktree | PR | Cleanup | Undo | Verify |
|---|--------|--------|----------|----|---------|------|--------|
| 1 | coverage checker | \`feat/coverage-check\` | — (serial) | — | after push | \`git revert <sha>\` | \`node scripts/coverage.test.mjs\` |
| 2 | plan checker | \`feat/plan-check\` | — (serial) | — | after push | \`git revert <sha>\` | \`node scripts/slice-it.test.mjs\` |
`;

// ---- A. A well-formed plan produces no errors ----
{
  const { root, file } = planDir();
  writeFileSync(file, GOOD);
  const { errors } = checkPlan(file, { root: ROOT });
  check('A well-formed plan reports no errors', errors.length === 0, JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- B. A Verify cell that is not a repo gate is an error naming the row ----
{
  const { root, file } = planDir();
  writeFileSync(file, GOOD.replace('`node scripts/coverage.test.mjs`', 'run the tests'));
  const { errors } = checkPlan(file, { root: ROOT });
  check('B unverifiable Verify cell reported by ticket',
    errors.some((e) => /coverage checker|ticket 1|row 1/i.test(e)), JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- C. A plan with no proposal table is a structural error ----
{
  const { root, file } = planDir();
  writeFileSync(file, '# plan\n\nno table here\n');
  const { errors } = checkPlan(file, { root: ROOT });
  check('C missing table reported', errors.some((e) => /table/i.test(e)), JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- D. An unresolvable branch name warns, never errors (landed+deleted is legitimate) ----
{
  const { root, file } = planDir();
  writeFileSync(file, GOOD.replace('`feat/plan-check`', '`feat/never-existed`'));
  const { errors, warns } = checkPlan(file, { root: ROOT });
  check('D missing branch warns not errors',
    errors.length === 0 && warns.some((w) => w.includes('feat/never-existed')),
    `errors=${JSON.stringify(errors)} warns=${JSON.stringify(warns)}`);
  rmSync(root, { recursive: true, force: true });
}

// ---- E. Issues dir present + ticket file missing → warn naming the ticket ----
{
  const { root, file } = planDir();
  mkdirSync(join(root, '.trust', 'x', 'issues'), { recursive: true });
  writeFileSync(file, GOOD);
  const { errors, warns } = checkPlan(file, { root: ROOT });
  check('E missing issue file warns naming the ticket',
    errors.length === 0 && warns.length > 0, `errors=${JSON.stringify(errors)} warns=${JSON.stringify(warns)}`);
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
