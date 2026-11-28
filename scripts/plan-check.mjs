#!/usr/bin/env node
/**
 * plan-check.mjs — plan-vs-actual checker (process pack item 3).
 *
 * slice-it serializes every approved split to .trust/<slug>/plan.md, but
 * nothing checked the execution followed the plan — scope creep is where
 * unreviewed code hides. This checks mechanically what can be checked:
 *
 *   - every ticket row carries a Verify cell that is a declared repo gate
 *     (the ci.yml allowlist via repoGateCommands) — never "run the tests"
 *   - the named branch resolves, or is reported (a landed+deleted branch is
 *     legitimate: warn, never error — deletion is the plan's Cleanup column)
 *   - when an issues dir exists, each row expects a ticket file (warn only —
 *     `full`-class plans legitimately skip ticket files)
 *   - a plan.md with no proposal table is a structural error
 *
 * Drift is reported, never blocked: the roast hook consumes this output and a
 * reviewer decides (propose-not-gate).
 *
 * CLI: node scripts/plan-check.mjs [--plan <path>]  — exit 1 on any error.
 * No --plan → scans every .trust dir for a plan.md; none found exits 0
 * (fresh checkouts have no .trust — it is gitignored).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { repoGateCommands } from './receipt-enforcement.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const cellCmd = (cell) => {
  const m = /`([^`]+)`/.exec(cell);
  return m ? m[1].trim() : null;
};

export function checkPlan(planPath, { root = ROOT } = {}) {
  const errors = [];
  const warns = [];
  const allow = repoGateCommands({ root });
  const text = readFileSync(planPath, 'utf8');
  const lines = text.split('\n');

  const headerIdx = lines.findIndex((l) => l.trimStart().startsWith('|') && l.includes('Ticket') && l.includes('Verify'));
  if (headerIdx < 0) {
    errors.push(`${basename(planPath)}: no proposal table found`);
    return { errors, warns };
  }
  const cols = lines[headerIdx].split('|').map((c) => c.trim()).filter(Boolean);
  const col = (name) => cols.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  const iTicket = col('Ticket');
  const iBranch = col('Branch');
  const iVerify = col('Verify');

  const rows = lines.slice(headerIdx + 1)
    .filter((l) => l.trimStart().startsWith('|') && !/^[\s|:-]+$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

  const issuesDir = join(dirname(planPath), 'issues');
  const hasIssues = existsSync(issuesDir);

  for (const cells of rows) {
    const n = cells[0] ?? '?';
    const ticket = cells[iTicket] ?? '(unnamed)';
    const label = `ticket ${n} (${ticket})`;

    const verify = iVerify >= 0 ? cellCmd(cells[iVerify] ?? '') : null;
    if (!verify) errors.push(`${label}: Verify cell has no command — a ticket without a measurable end is not a ticket`);
    else if (!allow.has(verify)) errors.push(`${label}: Verify "${verify}" is not a declared repo gate`);

    const branch = iBranch >= 0 ? cellCmd(cells[iBranch] ?? '') : null;
    if (branch) {
      try {
        execFileSync('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: root, stdio: 'pipe' });
      } catch {
        warns.push(`${label}: branch "${branch}" does not resolve — landed+deleted (Cleanup column) or never created`);
      }
    }

    if (hasIssues) {
      const expected = String(n).padStart(2, '0');
      const found = readdirSync(issuesDir).some((f) => f.startsWith(`${expected}-`) && f.endsWith('.md'));
      if (!found) warns.push(`${label}: no issues/${expected}-*.md under ${basename(dirname(planPath))}/issues`);
    }
  }

  return { errors, warns };
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argIdx = process.argv.indexOf('--plan');
  let plans;
  if (argIdx >= 0) {
    plans = [resolve(process.argv[argIdx + 1])];
  } else {
    const trust = join(ROOT, '.trust');
    plans = existsSync(trust)
      ? readdirSync(trust, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => join(trust, d.name, 'plan.md'))
          .filter(existsSync)
      : [];
  }
  if (plans.length === 0) {
    console.log('OK: no plans under .trust/ — nothing to check.');
    process.exit(0);
  }
  let errCount = 0;
  for (const p of plans) {
    const { errors, warns } = checkPlan(p, { root: ROOT });
    for (const w of warns) console.log(`WARN  ${w}`);
    for (const e of errors) { errCount++; console.error(`ERROR ${e}`); }
  }
  if (errCount) {
    console.error(`FAIL: ${errCount} plan drift error(s)`);
    process.exit(1);
  }
  console.log(`OK: ${plans.length} plan(s) hold — every ticket has a gated Verify, drift reported as warnings only.`);
}
