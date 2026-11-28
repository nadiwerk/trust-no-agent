#!/usr/bin/env node
/**
 * dep-lint.mjs — dependency-touch lint (process pack item 4).
 *
 * A new third-party dependency is the cheapest supply-chain risk an agent can
 * add — this makes the touch visible and, in gate mode, requires the commit
 * to acknowledge it with a `dep-ok:` trailer. skills-lock.json is a skill
 * hash lock, NOT a third-party dep — never flagged.
 *
 * CLI:
 *   node scripts/dep-lint.mjs [--staged | --base <ref>]   report mode (exit 0)
 *   node scripts/dep-lint.mjs --staged --gate             require dep-ok marker
 * Report mode prints touched manifests; gate mode exits 1 without the marker.
 */
import { basename } from 'node:path';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DEP_FILES = [
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'requirements-dev.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock', 'setup.py',
  'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum',
  'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock',
];

const DEP_SET = new Set(DEP_FILES);

export function checkDeps(files, { gate = false, commitMsg = '' } = {}) {
  const depFiles = [...new Set(files)].filter((f) => DEP_SET.has(basename(f)));
  const marked = /dep-ok\s*:/i.test(commitMsg);
  const ok = !gate || depFiles.length === 0 || marked;
  return { depFiles, ok };
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const gate = args.includes('--gate');
  const baseIdx = args.indexOf('--base');
  const gitDiff = baseIdx >= 0 ? ['diff', '--name-only', `${args[baseIdx + 1]}...HEAD`] : ['diff', '--name-only', '--staged'];
  let files = [];
  let commitMsg = '';
  let degraded = false;
  try {
    files = execFileSync('git', gitDiff, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).split('\n').filter(Boolean);
    commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: ROOT, encoding: 'utf8' });
  } catch { degraded = true; }
  if (degraded) {
    // A gate that cannot see its input must say so — silent empty is the
    // absence-class bug coverage.mjs exists to kill. Warn, never pretend.
    console.log(`WARN: git range unresolvable (${gitDiff.join(' ')}) — dep check degraded, no files examined`);
    if (!gate) console.log('OK: no dependency manifests touched.');
    process.exit(0);
  }
  const { depFiles, ok } = checkDeps(files, { gate, commitMsg });
  for (const f of depFiles) console.log(`DEP-TOUCH ${f}`);
  if (depFiles.length === 0) console.log('OK: no dependency manifests touched.');
  else if (!ok) {
    console.error(`FAIL: ${depFiles.length} dependency manifest(s) touched without a dep-ok: trailer — acknowledge the supply-chain touch in the commit message or drop it`);
    process.exit(1);
  } else if (gate) console.log('OK: dependency touch acknowledged with dep-ok:');
}
