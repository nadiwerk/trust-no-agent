#!/usr/bin/env node
/**
 * tna-ci.mjs — run the CI validate job locally, verbatim (process pack item 5).
 *
 * The bug class this kills is "green locally, red on CI" — parity must be
 * mechanical, not aspirational. Parses .github/workflows/ci.yml's validate
 * job, extracts every `run:` step in order, and executes them sequentially
 * in the repo root, stopping at the first failure with the step's name.
 * Only the validate job — update/deploy steps are never run locally.
 *
 * CLI:
 *   node scripts/tna-ci.mjs          run every validate run: step in order
 *   node scripts/tna-ci.mjs --list   print the steps without running
 *   node scripts/tna-ci.mjs --from "step name substring"   resume from a step
 * Exit 1 on the first failing step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CI_FILE = join(ROOT, '.github', 'workflows', 'ci.yml');

/**
 * Extract {name, run} steps from the `validate:` job of a ci.yml text.
 * YAML-lite parsing — the steps block is line-oriented; `uses:` steps and
 * other jobs are skipped by indentation + section tracking.
 */
export function parseSteps(ciText, job = 'validate') {
  const lines = String(ciText).split('\n');
  const steps = [];
  let inJob = false;
  let pendingName = null;
  for (const line of lines) {
    // Job boundary: "  <name>:" at two-space indent under jobs:
    const jobMatch = /^  ([\w-]+):\s*$/.exec(line);
    if (jobMatch) { inJob = jobMatch[1] === job; continue; }
    if (!inJob) continue;
    const nameMatch = /^\s+- name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch) { pendingName = nameMatch[1]; continue; }
    const runMatch = /^\s+run:\s*(.+?)\s*$/.exec(line);
    if (runMatch) { steps.push({ name: pendingName ?? '(unnamed)', run: runMatch[1] }); pendingName = null; }
  }
  return steps;
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!existsSync(CI_FILE)) {
    console.error('FAIL: .github/workflows/ci.yml not found');
    process.exit(2);
  }
  let steps = parseSteps(readFileSync(CI_FILE, 'utf8'));
  const fromIdx = args.indexOf('--from');
  if (fromIdx >= 0) {
    const needle = args[fromIdx + 1].toLowerCase();
    const i = steps.findIndex((s) => s.name.toLowerCase().includes(needle));
    if (i < 0) { console.error(`FAIL: no step matching "${needle}"`); process.exit(2); }
    steps = steps.slice(i);
  }
  if (args.includes('--list')) {
    for (const [i, s] of steps.entries()) console.log(`${String(i + 1).padStart(2)}. ${s.name}\n    ${s.run}`);
    process.exit(0);
  }
  console.log(`Running ${steps.length} CI step(s) verbatim...\n`);
  for (const [i, s] of steps.entries()) {
    console.log(`[${i + 1}/${steps.length}] ${s.name}`);
    const r = spawnSync(s.run, { cwd: ROOT, shell: true, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`\nFAIL: step "${s.name}" exited ${r.status} — this is what CI would see`);
      process.exit(1);
    }
  }
  console.log(`\nOK: all ${steps.length} CI step(s) pass locally.`);
}
