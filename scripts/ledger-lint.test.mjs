#!/usr/bin/env node
/**
 * ledger-lint.test.mjs — fail-first tests for the ledger integrity lint.
 * Fixtures are minimal canonical entries plus the three measured drift shapes:
 * byte-identical duplicates, `|- `/bold marker drift, and entries with no date.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lintLedger } from './ledger-lint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'ledger-lint.mjs');
let passed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { console.error(`FAIL ${name}`); process.exitCode = 1; }
};

const ENTRY = `### Session Summary - fix the gate
- Modified 'scripts/x.mjs' - patched
- Harness: devin
- Loaded: receipts
- Verification: node x.test.mjs 10/10
- Next: none
`;

const CLEAN = `## 2026-11-20

${ENTRY}
### Self-Review (4 Dimensions)
- [x] **Readability**: ok
`;

// ---- clean fixture: no findings, full coverage ----
{
  const { findings, stats } = lintLedger(CLEAN);
  ok('clean ledger: zero findings', findings.length === 0);
  ok('clean ledger: 1 entry, 100% harness+loaded', stats.entries === 1 && stats.harness === 1 && stats.loaded === 1);
}

// ---- byte-identical duplicate is a finding ----
{
  const dup = `## 2026-11-20\n\n${ENTRY}\n${ENTRY}`;
  const { findings } = lintLedger(dup);
  const d = findings.filter((f) => f.kind === 'duplicate-entry');
  ok('duplicate entry detected once, names the earlier line', d.length === 1 && /line 3/.test(d[0].message));
}

// ---- same heading, different body is NOT a duplicate ----
{
  const two = `## 2026-11-20\n\n${ENTRY}\n### Session Summary - fix the gate\n- Modified 'scripts/y.mjs' - different work\n- Next: none\n`;
  const { findings } = lintLedger(two);
  ok('same title, different body: no duplicate finding', !findings.some((f) => f.kind === 'duplicate-entry'));
}

// ---- marker drift: |- and **Field:** are unreadable to the audit ----
{
  const drift = `## 2026-11-20\n\n### Session Summary - drifted\n|- Harness: devin\n|- Loaded: receipts\n**Next:** none\n- Next: none\n`;
  const { findings } = lintLedger(drift);
  const nc = findings.filter((f) => f.kind === 'noncanonical-marker');
  ok('|- marker drift flagged', nc.some((f) => /\|- Harness/.test(f.message)));
  ok('**Next:** bold drift flagged', nc.some((f) => /\*\*Next:\*\*/.test(f.message)));
  ok('canonical - Next: line NOT flagged', !nc.some((f) => /^marker drift — "- Next:"/.test(f.message)));
}

// ---- entry before any date header ----
{
  const nodate = `${ENTRY}\n## 2026-11-20\n\n${ENTRY}`;
  const { findings } = lintLedger(nodate);
  const nd = findings.filter((f) => f.kind === 'entry-without-date');
  ok('entry before first date header flagged once', nd.length === 1);
}

// ---- coverage metrics never produce findings ----
{
  const bare = `## 2026-11-20\n\n### Session Summary - bare\n- Next: none\n`;
  const { findings, stats } = lintLedger(bare);
  ok('missing Harness/Loaded: metric only, no finding', findings.length === 0 && stats.harness === 0 && stats.loaded === 0);
}

// ---- CLI contract ----
const dir = mkdtempSync(join(tmpdir(), 'ledgerlint-'));
const run = (args, cwd = dir) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

writeFileSync(join(dir, 'progress.txt'), `## 2026-11-20\n\n${ENTRY}\n${ENTRY}`);
{
  const r = run([]);
  ok('CLI: findings exit 1 and list duplicate-entry', r.status === 1 && /duplicate-entry/.test(r.stdout));
  ok('CLI: metrics line always printed', /Harness coverage 100%/.test(r.stdout));
}
{
  const r = run(['--warn-only']);
  ok('CLI: --warn-only exits 0 with findings still listed', r.status === 0 && /duplicate-entry/.test(r.stdout));
}
{
  const r = run([], mkdtempSync(join(tmpdir(), 'ledgerlint-empty-')));
  ok('CLI: no ledger exits 2', r.status === 2);
}
{
  const clean = mkdtempSync(join(tmpdir(), 'ledgerlint-clean-'));
  writeFileSync(join(clean, 'progress.txt'), CLEAN);
  const r = run([], clean);
  ok('CLI: clean ledger exits 0', r.status === 0 && /clean/.test(r.stdout));
}

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
