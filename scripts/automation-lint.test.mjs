#!/usr/bin/env node
/* automation-lint.test.mjs — fail-first contract for scripts/automation-lint.mjs */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { lintAutomation } from './automation-lint.mjs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name} :: ${extra}`); }
};

const NOW = new Date('2026-11-24T12:00:00');
const run = (o) => ({
  id: 'r', schedule: 'daily', harness: 'opencode', task: 'audit',
  rung: 'audit-only', proofDate: '2026-11-20',
  allowedActions: ['read', 'report'], receipt: '.trust/rep/r.md', escalate: ['push'], ...o,
});

// --- happy path ---
{
  const r = lintAutomation(JSON.stringify({ version: 1, runs: [run()] }), { now: NOW });
  check('valid audit-only run passes', r.ok, r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ rung: 'veto-proven', proofDate: '2026-11-20', allowedActions: ['read', 'write', 'test'] })] }), { now: NOW });
  check('veto-proven allows write-tier', r.ok, r.findings.join('; '));
}

// --- decay is the ceiling ---
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ rung: 'veto-proven', proofDate: '2026-09-01', allowedActions: ['write'] })] }), { now: NOW });
  check('stale proof decays rung -> write action flagged',
    r.findings.some((f) => f.includes('decays to audit-only')) && r.findings.some((f) => f.includes('exceeds effective rung')), r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ rung: 'trusted', proofDate: '2026-11-23', allowedActions: ['push'], escalate: ['deploy'] })] }), { now: NOW });
  check('fresh trusted allows push when listed', r.ok, r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ rung: 'audit-only', allowedActions: ['push'] })] }), { now: NOW });
  check('audit-only may never push', r.findings.some((f) => f.includes('exceeds effective rung')), r.findings.join('; '));
}

// --- shape defects ---
{
  const r = lintAutomation('not json', { now: NOW });
  check('malformed JSON fail-closed', !r.ok && r.findings[0].includes('not JSON'));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [{ id: 'x' }] }), { now: NOW });
  check('missing required fields flagged', r.findings.filter((f) => f.includes('missing')).length >= 6, r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ rung: 'god-mode' })] }), { now: NOW });
  check('unknown rung flagged + floored', r.findings.some((f) => f.includes('not in {')) , r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ allowedActions: ['read', 'push'], escalate: ['push'] })] }), { now: NOW });
  check('allowed∩escalate overlap flagged', r.findings.some((f) => f.includes('both allowed and escalated')), r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ receipt: '  ' })] }), { now: NOW });
  check('blank receipt path flagged', r.findings.some((f) => f.includes('receipt must name')), r.findings.join('; '));
}

// --- goal binding ---
const GOALS = `## Goal: live goal\nStatus: active\nAccepts: x\nScope: src/**\nNever: n\n\n## Goal: paused goal\nStatus: paused\nAccepts: y\nScope: s/**\nNever: n\n`;
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ goals: ['live goal'] })] }), { now: NOW, goalsText: GOALS });
  check('active goal binding passes', r.ok, r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ goals: ['paused goal'] })] }), { now: NOW, goalsText: GOALS });
  check('paused goal flagged', r.findings.some((f) => f.includes('only active goals')), r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ goals: ['ghost'] })] }), { now: NOW, goalsText: GOALS });
  check('unknown goal flagged', r.findings.some((f) => f.includes('not found in goals.md')), r.findings.join('; '));
}
{
  const r = lintAutomation(JSON.stringify({ runs: [run({ goals: ['anything'] })] }), { now: NOW, goalsText: null });
  check('no goals file -> goal refs unchecked, no flag', r.ok, r.findings.join('; '));
}

// --- CLI: absent file fail-open, malformed fail-closed ---
const dir = mkdtempSync(join(tmpdir(), 'tna-autolint-'));
try {
  mkdirSync(join(dir, '.trust'));
  const script = join(process.cwd(), 'scripts', 'automation-lint.mjs');
  const absent = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: dir });
  check('CLI exit 0 on absent file', absent.status === 0, `status=${absent.status}`);
  writeFileSync(join(dir, '.trust', 'automation.json'), JSON.stringify({ runs: [{ id: 'bad' }] }));
  const bad = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: dir });
  check('CLI exit 1 on malformed config', bad.status === 1, `status=${bad.status}`);
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
