#!/usr/bin/env node
/**
 * Fail-first test for scripts/autonomy-ladder.mjs — the per-harness trust
 * ladder with decay (findings-adaptation ticket 03, AC5). Zero dependencies.
 * Run: node scripts/autonomy-ladder.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = ladder behavior drift.
 *
 * Seam: pure functions over (level, proofDate, now) plus a row parser for
 * docs/compatibility.md's veto table. The CLI is a thin printer over them.
 *
 * Why it exists (spec US5): trust must never be grant-and-forget. The corpus
 * (M1/M2, loop.md) found readiness that DECAYS — a 30-day-old STATE is not
 * the top rung. This repo's own doctrine says the same: a veto without a
 * live proof is a proposal (docs/compatibility.md), and a claim with no
 * proof date must fail CLOSED to the floor, not inherit the claim.
 *
 * Contract under test:
 *   rungs: audit-only → veto-proven → trusted (spec US5, order matters)
 *   floor: nothing decays below audit-only
 *   decay: floor(daysSinceProof / 30) rungs dropped — >=30 days already drops
 *   fail-closed: no proof date, a future (impossible) date, an unknown rung,
 *                or an unproven `veto (… live check open)` claim → audit-only
 *   auto-downgrade is NOT adopted (spec Decisions Already Made): decay is
 *   computed AT READ TIME, nothing writes back — promotion needs fresh proof
 *   by a human, not a mutating state machine.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Pin the zone. A proof date is a CALENDAR DAY and `now` is an instant; leaving
// the zone ambient makes every decay fixture host-dependent, and on a UTC host
// it hides the off-by-one in G1 entirely (offset 0 can never disagree).
// Asia/Jakarta is UTC+7 — east of UTC, where the unnormalised frame grants one
// rung MORE trust than the calendar warrants. Every existing fixture's `now` is
// a UTC-midnight instant, which lands at 07:00 local on the same calendar day,
// so the A–F expectations are unchanged.
process.env.TZ = 'Asia/Jakarta';

const { LADDER, DECAY_DAYS, decay, effectiveFromRow, ladderReport } =
  await import('./autonomy-ladder.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const DAY = 86400000;
const now = new Date('2026-10-13T00:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * DAY);
const iso = (d) => d.toISOString().slice(0, 10);

// ---- A. The ladder has the spec's three rungs, in order ----
{
  check('A1 LADDER is audit-only → veto-proven → trusted',
    JSON.stringify(LADDER) === JSON.stringify(['audit-only', 'veto-proven', 'trusted']),
    JSON.stringify(LADDER));
  check('A2 DECAY_DAYS is 30 (M1/M2: 30-day-old state ≠ top rung)',
    DECAY_DAYS === 30, String(DECAY_DAYS));
}

// ---- B. Fresh proof keeps the claimed rung ----
{
  check('B1 a fresh veto proof holds veto-proven',
    decay('veto-proven', iso(daysAgo(0)), now) === 'veto-proven',
    decay('veto-proven', iso(daysAgo(0)), now));
  check('B2 a proof at day 29 still holds (decay starts at 30)',
    decay('trusted', iso(daysAgo(29)), now) === 'trusted',
    decay('trusted', iso(daysAgo(29)), now));
  check('B3 trusted with fresh proof holds trusted',
    decay('trusted', iso(daysAgo(5)), now) === 'trusted',
    decay('trusted', iso(daysAgo(5)), now));
}

// ---- C. Stale proof decays — THE AC5 DIRECTION ----
// The ticket's test: "status basi → turun tingkat, bukan bertahan" (a stale
// status steps DOWN, it does not persist).
{
  check('C1 a 30-day-old veto proof drops to audit-only',
    decay('veto-proven', iso(daysAgo(30)), now) === 'audit-only',
    decay('veto-proven', iso(daysAgo(30)), now));
  check('C2 a 30-day-old trusted proof drops one rung to veto-proven',
    decay('trusted', iso(daysAgo(30)), now) === 'veto-proven',
    decay('trusted', iso(daysAgo(30)), now));
  check('C3 a 60-day-old trusted proof reaches the floor',
    decay('trusted', iso(daysAgo(60)), now) === 'audit-only',
    decay('trusted', iso(daysAgo(60)), now));
  check('C4 decay is computed from NOW, not from row order',
    decay('trusted', iso(daysAgo(31)), now) === 'veto-proven' &&
    decay('trusted', iso(daysAgo(59)), now) === 'veto-proven',
    'boundary 31/59 days');
}

// ---- D. Fail-closed: claims without usable proof → floor ----
{
  check('D1 no proof date → audit-only (a claim with no proof grants nothing)',
    decay('veto-proven', null, now) === 'audit-only',
    String(decay('veto-proven', null, now)));
  check('D2 a future proof date is bad data → audit-only (fail-closed)',
    decay('trusted', iso(daysAgo(-3)), now) === 'audit-only',
    String(decay('trusted', iso(daysAgo(-3)), now)));
  check('D3 the floor never decays below itself',
    decay('audit-only', null, now) === 'audit-only' &&
    decay('audit-only', iso(daysAgo(400)), now) === 'audit-only');
  check('D4 an unknown rung fails closed to audit-only',
    decay('root', iso(daysAgo(0)), now) === 'audit-only',
    String(decay('root', iso(daysAgo(0)), now)));
}

// ---- E. Row parsing over the REAL veto table (docs/compatibility.md) ----
// Expected values derive from spec intent (fail-closed + honest per-harness
// claims), not from the implementation's output. The block pins its own
// `now` (the day the Claude Code proof landed) — the module-level fixture
// (2026-10-13) predates that proof and would fail-close it as future-dated.
{
  const compat = readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8');
  const nowE = new Date('2026-10-22T00:00:00Z');
  const rows = ladderReport(compat, nowE);
  check('E1 the veto table yields at least 4 harness rows',
    rows.length >= 4, `got ${rows.length}`);
  check('E2 every row resolves to a real rung',
    rows.every((r) => LADDER.includes(r.effective)), JSON.stringify(rows));
  const opencode = rows.find((r) => /opencode/i.test(r.harness));
  check('E3 opencode V2 (proven live 2026-10-13, fresh) → veto-proven',
    opencode && opencode.effective === 'veto-proven', JSON.stringify(opencode));
  const claude = rows.find((r) => /claude/i.test(r.harness));
  check('E4 Claude Code veto proven live 2026-10-22 (fresh) → veto-proven',
    claude && claude.effective === 'veto-proven', JSON.stringify(claude));
  const omp = rows.find((r) => /omp|devin/i.test(r.harness));
  check('E5 doc-first row → audit-only floor',
    omp && omp.effective === 'audit-only', JSON.stringify(omp));
}

// ---- F. CLI smoke: deterministic via --now, exit 0, all harnesses named ----
{
  const res = spawnSync(process.execPath, [join(HERE, 'autonomy-ladder.mjs'), '--now', '2026-10-13'], { encoding: 'utf8' });
  check('F1 the CLI exits 0', res.status === 0, `status=${res.status} err=${(res.stderr || '').slice(0, 200)}`);
  check('F2 the CLI prints every harness in the table',
    /opencode V2/i.test(res.stdout) && /Claude Code/i.test(res.stdout) && /OMO/i.test(res.stdout),
    res.stdout.slice(0, 300));
  check('F3 the CLI prints the three rungs (a level from each, legible)',
    /audit-only/.test(res.stdout) && /veto-proven/.test(res.stdout), res.stdout.slice(0, 300));
  const future = spawnSync(process.execPath, [join(HERE, 'autonomy-ladder.mjs'), '--now', '2026-11-20'], { encoding: 'utf8' });
  const opencodeLine = (future.stdout || '').split('\n').find((l) => /opencode V2/i.test(l)) || '';
  check('F4 the same fresh proof decayed 38 days later (read-time decay, no state rewrite)',
    future.status === 0 && /audit-only/.test(opencodeLine),
    `opencode line: ${opencodeLine}`);
}

// ---- G. The proof date is a CALENDAR DAY, not a UTC instant ----
// A proof dated `2026-09-14` is 30 calendar days old on `2026-10-14`, whatever
// the hour. Reading the date as UTC midnight and subtracting a raw instant
// makes the answer depend on the host's UTC offset — east of UTC it rounds
// DOWN and the ladder keeps a rung the calendar has already revoked. Trust
// must never be granted by an accident of the host's timezone.
{
  // 2026-10-13T18:00Z is 2026-10-14 01:00 in Asia/Jakarta: the local calendar
  // says 30 days, the raw instant says 29.75.
  const lateNight = new Date('2026-10-13T18:00:00Z');
  check('G1 a 30-calendar-day-old proof has decayed, whatever the hour of `now`',
    decay('trusted', '2026-09-14', lateNight) === 'veto-proven',
    `got ${decay('trusted', '2026-09-14', lateNight)} (a raw-instant subtraction floors to 29 and keeps trusted)`);
  check('G2 the floor still holds at the same instant (no trust invented downward)',
    decay('veto-proven', '2026-09-14', lateNight) === 'audit-only',
    decay('veto-proven', '2026-09-14', lateNight));
  check('G3 one day short of the window still holds the rung',
    decay('trusted', '2026-09-15', lateNight) === 'trusted',
    decay('trusted', '2026-09-15', lateNight));
  // `--now <date>` names a CALENDAR DAY, so the verdict must not depend on the
  // host's zone. Parsing the argument as a UTC instant makes it name the
  // PREVIOUS local day west of UTC — the same proof then reads 29 days old and
  // keeps a rung the calendar has already revoked. opencode's proof is
  // 2026-10-13; `--now 2026-11-12` is exactly 30 days, so every zone must decay.
  const verdictIn = (zone) => {
    const res = spawnSync(process.execPath,
      [join(HERE, 'autonomy-ladder.mjs'), '--now', '2026-11-12'],
      { encoding: 'utf8', env: { ...process.env, TZ: zone } });
    const line = (res.stdout || '').split('\n').find((l) => /opencode V2/i.test(l)) || '';
    return (line.split('effective:')[1] || '').trim().split(/\s/)[0];
  };
  const west = verdictIn('America/Los_Angeles');
  check('G4 --now names a calendar day: the verdict is zone-independent (30 days decays everywhere)',
    west === 'audit-only' && verdictIn('Asia/Jakarta') === 'audit-only' && verdictIn('UTC') === 'audit-only',
    `Los_Angeles=${west} Jakarta=${verdictIn('Asia/Jakarta')} UTC=${verdictIn('UTC')}`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `FAIL: ${failures} expectation(s) broken.`}`);
process.exit(failures === 0 ? 0 : 1);
