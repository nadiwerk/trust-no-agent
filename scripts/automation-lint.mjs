#!/usr/bin/env node
/**
 * automation-lint — validates `.trust/automation.json` against the
 * unattended-run contract (docs/specs/unattended-runs.md).
 *
 * The danger shape: an automation config claiming more trust than its proof
 * supports — silent over-authorization in a session with no user. So the
 * claimed rung is DECAYED through the same 30-day function the autonomy
 * ladder uses, and the action-tier ceiling is the effective rung:
 *   audit-only  -> read/report/analyze
 *   veto-proven -> + write/edit/test/install
 *   trusted     -> + commit/push/pr/publish/deploy (listed + not escalated)
 *
 * Fail-closed on shape (an unverifiable claim grants nothing), fail-open on
 * absence (no file = no automations = valid).
 *
 * Usage: node scripts/automation-lint.mjs [path-to-automation.json]
 *        [--goals path-to-goals.md] [--now YYYY-MM-DD] [--json]
 * Exit 0 = absent or valid. Exit 1 = findings.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decay, LADDER } from './autonomy-ladder.mjs';
import { parseGoals } from './goals.mjs';

export const ACTION_TIERS = {
  'audit-only': new Set(['read', 'report', 'analyze']),
  'veto-proven': new Set(['read', 'report', 'analyze', 'write', 'edit', 'test', 'install']),
  'trusted': new Set(['read', 'report', 'analyze', 'write', 'edit', 'test', 'install', 'commit', 'push', 'pr', 'publish', 'deploy']),
};

const REQUIRED = ['id', 'schedule', 'harness', 'task', 'rung', 'proofDate', 'allowedActions', 'receipt', 'escalate'];

export function lintAutomation(configText, { now = new Date(), goalsText = null } = {}) {
  const findings = [];
  let cfg;
  try { cfg = JSON.parse(configText); } catch (e) {
    return { ok: false, findings: [`automation.json is not JSON: ${e.message}`], runs: [] };
  }
  const runs = Array.isArray(cfg?.runs) ? cfg.runs : [];
  if (!runs.length) findings.push("automation.json has no 'runs' entries");

  const knownGoals = goalsText != null
    ? new Map(parseGoals(goalsText).goals.map((g) => [g.name, g])) : null;

  for (const [i, run] of runs.entries()) {
    const tag = run?.id || `runs[${i}]`;
    for (const k of REQUIRED) if (run?.[k] == null) findings.push(`${tag}: missing '${k}'`);
    if (!run || typeof run !== 'object') continue;

    const claimed = LADDER.includes(run.rung) ? run.rung : null;
    if (!claimed) findings.push(`${tag}: rung '${run.rung}' not in {${LADDER.join(', ')}}`);
    const effective = decay(claimed ?? 'audit-only', run.proofDate, now);
    if (claimed && claimed !== 'audit-only' && effective !== claimed) {
      findings.push(`${tag}: claimed ${claimed} but proof ${run.proofDate ?? 'none'} decays to ${effective}`);
    }

    const ceiling = ACTION_TIERS[effective];
    for (const a of Array.isArray(run.allowedActions) ? run.allowedActions : []) {
      if (!ceiling.has(a)) findings.push(`${tag}: action '${a}' exceeds effective rung ${effective}`);
    }
    const esc = new Set(Array.isArray(run.escalate) ? run.escalate : []);
    for (const a of Array.isArray(run.allowedActions) ? run.allowedActions : []) {
      if (esc.has(a)) findings.push(`${tag}: '${a}' is both allowed and escalated — pick one`);
    }
    if (typeof run.receipt !== 'string' || !run.receipt.trim()) {
      findings.push(`${tag}: receipt must name an artifact path`);
    }
    for (const g of Array.isArray(run.goals) ? run.goals : []) {
      if (knownGoals && !knownGoals.has(g)) findings.push(`${tag}: goal '${g}' not found in goals.md`);
      else if (knownGoals && knownGoals.get(g).fields.Status?.toLowerCase() !== 'active') {
        findings.push(`${tag}: goal '${g}' is ${knownGoals.get(g).fields.Status} — only active goals may be worked`);
      }
    }
  }
  return { ok: findings.length === 0, findings, runs };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--') && a !== args[args.indexOf('--now') + 1] && a !== args[args.indexOf('--goals') + 1]);
  const file = positional[0] ?? join(process.env.DEVIN_PROJECT_DIR || process.cwd(), '.trust', 'automation.json');
  const goalsFile = args.includes('--goals') ? args[args.indexOf('--goals') + 1] : join(process.env.DEVIN_PROJECT_DIR || process.cwd(), '.trust', 'goals.md');
  const now = args.includes('--now') ? new Date(`${args[args.indexOf('--now') + 1]}T12:00:00`) : new Date();

  if (!existsSync(file)) {
    if (json) console.log(JSON.stringify({ ok: true, runs: 0, findings: [] }));
    else console.log(`no automation.json at ${file} — nothing configured, nothing to validate`);
    process.exit(0);
  }
  const goalsText = existsSync(goalsFile) ? readFileSync(goalsFile, 'utf8') : null;
  const { ok, findings, runs } = lintAutomation(readFileSync(file, 'utf8'), { now, goalsText });
  if (json) console.log(JSON.stringify({ ok, runs: runs.length, findings }, null, 2));
  else if (ok) console.log(`automation.json OK — ${runs.length} run(s)`);
  else { console.log('automation.json findings:'); for (const f of findings) console.log(`  - ${f}`); }
  process.exit(ok ? 0 : 1);
}
