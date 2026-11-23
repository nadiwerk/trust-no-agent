#!/usr/bin/env node
/**
 * goals — validator for `.trust/goals.md`, the standing-goals file.
 *
 * Why mechanical: a goal that outlives one session is a file, not a memory
 * (fork-it §Standing goals). Automation runs and resumed sessions re-read it
 * — a malformed block is worse than no file, because a half-parsed scope is a
 * silent authorization. Fail-closed on shape, fail-open on absence: no file
 * means no standing goals, which is a valid state.
 *
 * Contract per `## Goal: <name>` block (all four lines required):
 *   Status: active | paused | done
 *   Accepts: <executable criterion>[, <executable criterion>...]
 *   Scope: <paths/systems this goal may touch>
 *   Never: <actions this goal never authorizes>
 *
 * Usage:
 *   node scripts/goals.mjs [path-to-goals.md] [--json]
 * Exit 0 = absent or valid. Exit 1 = malformed (findings listed).
 * Pure parse exported for tests + the automation contract (unattended-runs).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const GOAL_FIELDS = ['Status', 'Accepts', 'Scope', 'Never'];
export const VALID_STATUS = new Set(['active', 'paused', 'done']);

/**
 * Parse goals.md text into blocks. A block runs from its `## Goal:` header
 * to the next `## Goal:` or EOF. Returns { goals, findings } — findings are
 * strings naming the defect; goals carry name, fields, and the 1-based line
 * of their header for reporting.
 */
export function parseGoals(text) {
  const goals = [];
  const findings = [];
  const lines = String(text ?? '').split(/\r?\n/);
  let cur = null;
  const flush = () => {
    if (!cur) return;
    for (const f of GOAL_FIELDS) {
      if (!cur.fields[f]) findings.push(`${cur.name}: missing '${f}:' line (line ${cur.line})`);
    }
    if (cur.fields.Status && !VALID_STATUS.has(cur.fields.Status.trim().toLowerCase())) {
      findings.push(`${cur.name}: Status '${cur.fields.Status.trim()}' not in {active, paused, done} (line ${cur.line})`);
    }
    goals.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const g = line.match(/^##\s+Goal:\s*(.+?)\s*$/);
    if (g) { flush(); cur = { name: g[1], line: i + 1, fields: {} }; continue; }
    if (!cur) continue;
    const f = line.match(/^(Status|Accepts|Scope|Never):\s*(.+?)\s*$/);
    if (f) cur.fields[f[1]] = f[2];
  }
  flush();
  return { goals, findings };
}

/** Goals an unattended run may work: active, and the task inside Scope. */
export function activeGoals(text) {
  return parseGoals(text).goals.filter((g) => g.fields.Status?.trim().toLowerCase() === 'active');
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--')) ?? join(process.env.DEVIN_PROJECT_DIR || process.cwd(), '.trust', 'goals.md');
  if (!existsSync(file)) {
    if (json) console.log(JSON.stringify({ ok: true, goals: [], findings: [] }));
    else console.log(`no goals file at ${file} — nothing to validate`);
    process.exit(0);
  }
  const { goals, findings } = parseGoals(readFileSync(file, 'utf8'));
  if (json) console.log(JSON.stringify({ ok: findings.length === 0, goals: goals.length, findings }, null, 2));
  else if (findings.length === 0) console.log(`goals OK — ${goals.length} goal(s), ${goals.filter((g) => g.fields.Status?.toLowerCase() === 'active').length} active`);
  else { console.log('goals.md malformed:'); for (const f of findings) console.log(`  - ${f}`); }
  process.exit(findings.length === 0 ? 0 : 1);
}
