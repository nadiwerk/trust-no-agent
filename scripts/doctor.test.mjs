#!/usr/bin/env node
/**
 * Fail-first test for scripts/doctor.mjs C5 (corrective tier starvation).
 * Zero dependencies. Run: node scripts/doctor.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = doctor behavior drift.
 *
 * Seam: checkStarve({ ledgerText, lessonsExists, today, graceDays }) — the
 * pure function behind C5. Doctor's CLI wraps it with warn/fail output; this
 * test exercises the decision logic directly so fixture dates are deterministic.
 */
import { checkStarve, checkStale } from './corrective-tier.mjs';
import { ledgerVerdict } from './ledger-audit.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const ledgerWithDate = (dateStr) =>
  `# progress.txt\n\n## ${dateStr}\n\n### Session Summary - something\n- did a thing\n`;

// 1. Young starving (within grace) → WARN, not FAIL
{
  const res = checkStarve({
    ledgerText: ledgerWithDate('2026-09-04'), // 2 days ago vs 2026-09-06
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('young-starving is warn', res.level === 'warn', JSON.stringify(res));
}

// 2. Old starving (beyond grace) → FAIL
{
  const res = checkStarve({
    ledgerText: ledgerWithDate('2026-08-01'), // 36 days ago vs 2026-09-06
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('old-starving is fail', res.level === 'fail', JSON.stringify(res));
}

// 3. Lessons exists → OK regardless of age
{
  const res = checkStarve({
    ledgerText: ledgerWithDate('2026-08-01'),
    lessonsExists: true,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('lessons-exists is ok', res.level === 'ok', JSON.stringify(res));
}

// 4. No parseable date headers → WARN (degrade, never hard-fail on unprovable data)
{
  const res = checkStarve({
    ledgerText: '# progress.txt\n\n### Session Summary - no date header\n- did a thing\n',
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('no-dates is warn', res.level === 'warn', JSON.stringify(res));
}

// 5. Grace boundary: age == graceDays - 1 → WARN
{
  const res = checkStarve({
    ledgerText: ledgerWithDate('2026-08-24'), // 13 days ago vs 2026-09-06
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('age-at-grace-minus-one is warn', res.level === 'warn', JSON.stringify(res));
}

// 6. Grace boundary: age == graceDays → FAIL
{
  const res = checkStarve({
    ledgerText: ledgerWithDate('2026-08-23'), // 14 days ago vs 2026-09-06
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('age-at-grace-exact is fail', res.level === 'fail', JSON.stringify(res));
}

// 7. Empty ledger text → OK (no entries to starve)
{
  const res = checkStarve({
    ledgerText: '',
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('empty-ledger is ok', res.level === 'ok', JSON.stringify(res));
}

if (failures) { console.error(`\nFAIL: ${failures} expectation(s) broken.`); process.exit(1); }
console.log('\nOK: doctor C5 behaves as specified.');

// ---- C6 update-check (checkStale) ----
// 8. No version stamp installed, upstream has one → UNSTAMPED (not "stale":
//    an unstamped install is unknown, not outdated — stamping is the fix)
{
  const res = checkStale({ installedVersion: '', upstreamVersion: '0.1.10' });
  check('missing-installed-version is unstamped', res.level === 'unstamped', JSON.stringify(res));
  check('unstamped message says stamp, not update', /Stamp it now/.test(res.message), res.message);
}

// 9. Installed older than upstream → stale
{
  const res = checkStale({ installedVersion: '0.1.9', upstreamVersion: '0.1.10' });
  check('older-installed is stale', res.level === 'stale', JSON.stringify(res));
}

// 10. Same version → current
{
  const res = checkStale({ installedVersion: '0.1.10', upstreamVersion: '0.1.10' });
  check('equal-versions is current', res.level === 'current', JSON.stringify(res));
}

// 11. Installed NEWER than upstream (dev checkout) → current, never nag down
{
  const res = checkStale({ installedVersion: '0.1.11', upstreamVersion: '0.1.10' });
  check('newer-installed is current', res.level === 'current', JSON.stringify(res));
}

// 12. Upstream version unknown (no package.json) → unknown, degrade to warn-free
{
  const res = checkStale({ installedVersion: '0.1.10', upstreamVersion: '' });
  check('unknown-upstream is unknown', res.level === 'unknown', JSON.stringify(res));
}

// ---- ledgerVerdict (three-valued ledger-audit verdict, spec D8/AC7/AC8) ----
// The operator must be able to tell "checked and clean" from "could not look".
// Before this function existed, doctor printed an unqualified "ledger audit
// clean" whenever findings.length === 0 — including when the audit was blind.

// 13. No findings, no gaps → clean
{
  const res = ledgerVerdict({ findings: [], gaps: [] });
  check('verdict clean when nothing found and nothing unprovable', res.level === 'clean', JSON.stringify(res));
}

// 14. Findings present → findings (WARN level, never FAIL)
{
  const res = ledgerVerdict({ findings: [{ date: '2026-09-08', kind: 'loaded-gap', message: 'x' }], gaps: [] });
  check('verdict findings when findings exist', res.level === 'findings', JSON.stringify(res));
  check('verdict findings is warn-level', res.warn === true, JSON.stringify(res));
}

// 15. AC8 — an all-undated legacy ledger yields unprovable as WARN, never FAIL
{
  const res = ledgerVerdict({ findings: [], gaps: [{ date: null, kind: 'coverage-gap', reason: 'x' }] });
  check('verdict unprovable for a gap-only ledger', res.level === 'unprovable', JSON.stringify(res));
  check('unprovable is warn-level', res.warn === true, JSON.stringify(res));
  check('unprovable message prints the gap count', /\b1\b/.test(res.message), res.message);
}

// 16. Findings AND gaps → findings wins the headline but the gap count is shown
{
  const res = ledgerVerdict({
    findings: [{ date: '2026-09-08', kind: 'loaded-gap', message: 'x' }],
    gaps: [{ date: null, kind: 'coverage-gap', reason: 'a' }, { date: null, kind: 'coverage-gap', reason: 'b' }],
  });
  check('verdict names findings when both exist', res.level === 'findings', JSON.stringify(res));
  check('verdict message still reports the unprovable count', /\b2\b/.test(res.message), res.message);
}

if (failures) { console.error(`\nFAIL: ${failures} expectation(s) broken.`); process.exit(1); }
console.log('\nOK: doctor decision logic behaves as specified.');
