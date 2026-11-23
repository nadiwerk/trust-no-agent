#!/usr/bin/env node
/* goals.test.mjs — fail-first contract for scripts/goals.mjs */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGoals, activeGoals } from './goals.mjs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name} :: ${extra}`); }
};

const GOOD = `
## Goal: faster cold start
Status: active
Accepts: node bench/start.mjs reports under 400ms
Scope: src/boot/**, src/server/**
Never: dependency upgrades, config schema changes

## Goal: stale cache cleanup
Status: paused
Accepts: npx vitest run test/cache.test.ts
Scope: src/cache/**
Never: schema migrations
`;

// --- parseGoals shape ---
{
  const { goals, findings } = parseGoals(GOOD);
  check('parses two goal blocks', goals.length === 2);
  check('no findings on well-formed file', findings.length === 0, findings.join('; '));
  check('fields captured', goals[0].fields.Scope === 'src/boot/**, src/server/**');
  check('activeGoals filters paused/done', activeGoals(GOOD).length === 1 && activeGoals(GOOD)[0].name === 'faster cold start');
}

// --- malformed input ---
{
  const { findings } = parseGoals(`## Goal: half-written\nStatus: active\nAccepts: x\n`);
  check('missing Scope+Never flagged', findings.some((f) => f.includes("'Scope:'")) && findings.some((f) => f.includes("'Never:'")), findings.join('; '));
}
{
  const { findings } = parseGoals(`## Goal: bad status\nStatus: whatever\nAccepts: x\nScope: s/**\nNever: n\n`);
  check('unknown Status flagged', findings.some((f) => f.includes('not in {active, paused, done}')), findings.join('; '));
}
{
  const { goals } = parseGoals('plain prose, no goal blocks');
  check('no blocks -> zero goals, zero findings', goals.length === 0);
}

// --- CLI ---
const dir = mkdtempSync(join(tmpdir(), 'tna-goals-'));
try {
  const file = join(dir, 'goals.md');
  writeFileSync(file, GOOD);
  const ok = spawnSync(process.execPath, ['scripts/goals.mjs', file], { encoding: 'utf8', cwd: process.cwd() });
  check('CLI exit 0 on valid file', ok.status === 0, ok.stdout + ok.stderr);
  writeFileSync(file, `## Goal: broken\nStatus: active\n`);
  const bad = spawnSync(process.execPath, ['scripts/goals.mjs', file], { encoding: 'utf8', cwd: process.cwd() });
  check('CLI exit 1 on malformed file', bad.status === 1 && bad.stdout.includes('malformed'), `status=${bad.status} out=${bad.stdout.slice(0, 120)}`);
  const absent = spawnSync(process.execPath, ['scripts/goals.mjs', join(dir, 'nope.md')], { encoding: 'utf8', cwd: process.cwd() });
  check('CLI exit 0 on absent file (fail-open)', absent.status === 0, `status=${absent.status}`);
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
