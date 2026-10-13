#!/usr/bin/env node
/**
 * Autonomy ladder — per-harness trust rungs WITH decay (findings-adaptation
 * ticket 03, AC5; spec US5; corpus M1/M2 + loop.md "readiness DECAYS —
 * 30-day-old STATE ≠ L3").
 *
 * Run:  node scripts/autonomy-ladder.mjs [--now YYYY-MM-DD]
 * Exit 0 = table printed. Default now = today; --now pins it (tests).
 *
 * Rungs (spec: audit-only → veto-proven → trusted):
 *   audit-only   floor — prose + ledger audit, no veto claimed or proven
 *   veto-proven  a live veto proof exists (proof date REQUIRED)
 *   trusted      promoted rung — same proof requirement, older habit
 *
 * Decay: rungs dropped = floor(daysSinceProof / DECAY_DAYS). A proof at
 * day 30 already drops one rung; the floor is never left. Computed AT READ
 * TIME from (claimed rung, proof date, now) — there is no stored level to
 * rot. This is deliberately NOT the auto-downgrade state machine the spec
 * rejected (Decisions Already Made): nothing mutates the table, no promotion
 * happens without a human landing fresh proof in the row.
 *
 * Fail-closed: a `veto` claim with no proof date (e.g. "live check open"),
 * a future date (impossible — bad data), or an unknown rung all resolve to
 * audit-only. A claim without proof grants nothing (docs/compatibility.md:
 * "a veto without a live proof is a proposal").
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const LADDER = ['audit-only', 'veto-proven', 'trusted'];
export const DECAY_DAYS = 30;

const DAY = 86400000;

/**
 * Resolve the effective rung from (claimed, proofDate, now).
 * Pure. Fail-closed: anything unverifiable → the audit-only floor.
 */
export function decay(claimed, proofDate, now) {
  if (!LADDER.includes(claimed)) return 'audit-only';
  const idx = LADDER.indexOf(claimed);
  if (idx === 0) return 'audit-only'; // the floor holds itself
  if (!proofDate || typeof proofDate !== 'string') return 'audit-only';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(proofDate);
  if (!m) return 'audit-only';
  const t = Date.parse(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(t)) return 'audit-only';
  const days = Math.floor((now.getTime() - t) / DAY);
  if (days < 0) return 'audit-only'; // future proof = bad data, not trust
  const drops = Math.floor(days / DECAY_DAYS);
  return LADDER[Math.max(0, idx - drops)];
}

/** Map a Level-cell claim to its rung. Unknown claims fail closed. */
function claimedRung(levelCell) {
  if (/^veto\b/i.test(levelCell)) return 'veto-proven';
  if (/^trusted\b/i.test(levelCell)) return 'trusted';
  return 'audit-only'; // audit-only, doc-first WARN, anything else
}

/**
 * Parse ONE veto-table row (| Harness | Irreversible-action guarantee | Level |)
 * into { harness, claimed, proofDate, effective }.
 */
export function effectiveFromRow(rowText, now) {
  const cells = rowText.split('|').map((c) => c.trim());
  const harness = (cells[1] || '').replace(/\*\*/g, '').trim();
  const levelCell = cells[3] || '';
  const claimed = claimedRung(levelCell);
  const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(levelCell);
  const proofDate = dateMatch ? dateMatch[1] : null;
  return { harness, claimed, proofDate, effective: decay(claimed, proofDate, now) };
}

/**
 * Extract the irreversible-action table from docs/compatibility.md and
 * resolve every row. Rows of any OTHER table are ignored (the big
 * compatibility matrix has a different header and must not leak in).
 */
export function ladderReport(compatText, now) {
  const lines = compatText.split('\n');
  const headerIdx = lines.findIndex((l) => /Irreversible-action guarantee/.test(l));
  if (headerIdx === -1) return [];
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) { // +2: header + separator
    const line = lines[i];
    if (!line.trim().startsWith('|')) break;
    rows.push(effectiveFromRow(line, now));
  }
  return rows;
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const nowArg = args.includes('--now') ? args[args.indexOf('--now') + 1] : null;
  const now = nowArg ? new Date(`${nowArg}T00:00:00Z`) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error('FAIL: --now must be YYYY-MM-DD');
    process.exit(1);
  }
  const compat = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'compatibility.md'), 'utf8');
  const rows = ladderReport(compat, now);
  if (!rows.length) {
    console.error('FAIL: no irreversible-action table found in docs/compatibility.md');
    process.exit(1);
  }
  console.log(`Autonomy ladder (read-time decay, ${DECAY_DAYS}-day window, as of ${now.toISOString().slice(0, 10)}):`);
  for (const r of rows) {
    const proof = r.proofDate || 'NO PROOF DATE';
    const why = r.effective === r.claimed ? ''
      : r.proofDate ? '  <- decayed (proof older than window)'
        : '  <- fail-closed (claim without proof date)';
    console.log(`${r.harness} | claimed: ${r.claimed} | proof: ${proof} | effective: ${r.effective}${why}`);
  }
  process.exit(0);
}
