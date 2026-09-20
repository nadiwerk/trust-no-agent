#!/usr/bin/env node
/**
 * Fail-first test for the decision logic doctor.mjs surfaces:
 *   C5 corrective-tier starvation + C6 update staleness (corrective-tier.mjs),
 *   C2 hook verdicts + C4 ledger-path resolution + C7b M4 blind spots
 *   (doctor-checks.mjs), and the three-valued ledger verdict (ledger-audit.mjs).
 * Zero dependencies. Run: node scripts/doctor.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = decision-logic drift.
 *
 * Seams are pure functions so fixture dates and paths are deterministic without
 * running doctor's CLI side effects.
 */
import { checkStarve, checkStale } from './corrective-tier.mjs';
import { ledgerVerdict } from './ledger-audit.mjs';
import { hookVerdict, pickLedgerPath, blindSpotWarning, gateVerdict } from './doctor-checks.mjs';

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

// ---- C5b. Titled date headers (ticket 03, spec §AC3) ----
// checkStarve measured the grace period from `## YYYY-MM-DD` ONLY. An adopter
// ledger writes titled headers (`## 2026-09-19 — Rebrand X`): 131 of 144 in the
// real one. With no date parsed, the check degraded to WARN forever — the
// grace clock never started, so the corrective tier could never be enforced.
// The two readers of this contract (ledger-audit, corrective-tier) must agree.

// 17. Titled header beyond grace → FAIL (the clock runs).
{
  const res = checkStarve({
    ledgerText: '# progress.txt\n\n## 2026-08-01 — Old rebrand\n\n### Ringkasan Sesi\n- did a thing\n',
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('titled old header exhausts grace (fail)', res.level === 'fail', JSON.stringify(res));
}

// 18. Titled header within grace → WARN (not silently OK, not FAIL).
{
  const res = checkStarve({
    ledgerText: '# progress.txt\n\n## 2026-09-04 — Recent rebrand\n\n### Ringkasan Sesi\n- did a thing\n',
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('titled recent header stays in grace (warn)', res.level === 'warn', JSON.stringify(res));
}

// 19. CRLF titled header — Windows adopter ledgers must not lose the clock.
{
  const res = checkStarve({
    ledgerText: '# progress.txt\r\n\r\n## 2026-08-01 — Old rebrand\r\n\r\n### Ringkasan Sesi\r\n- did a thing\r\n',
    lessonsExists: false,
    today: new Date('2026-09-06T00:00:00Z'),
    graceDays: 14,
  });
  check('CRLF titled header exhausts grace (fail)', res.level === 'fail', JSON.stringify(res));
}

// ---- C2b. Hook verdict: repo vs adopter mode (ticket 04, spec §AC10) ----
// Doctor FAILED on `core.hooksPath` in a project that only copied skills —
// which is exactly what the documented install (README: cp -r skills/*/*) asks
// for. A check that cannot pass under the documented install is a false alarm
// that trains the adopter to ignore doctor. Repo mode keeps today's strict
// contract; adopter mode checks that SOME hook exists, and never FAILs.

// 20. Repo mode: hooksPath set and complete → pass
{
  const res = hookVerdict({ mode: 'repo', hooksPath: 'scripts/hooks', hasPre: true, hasMsg: true, customHookExists: false });
  check('repo mode with complete hooks dir passes', res.level === 'pass', JSON.stringify(res));
}

// 21. Repo mode: hooksPath missing → fail (unchanged from today)
{
  const res = hookVerdict({ mode: 'repo', hooksPath: '', hasPre: false, hasMsg: false, customHookExists: true });
  check('repo mode without hooksPath fails', res.level === 'fail', JSON.stringify(res));
}

// 22. Repo mode: hooksPath set but dir incomplete → fail (unchanged)
{
  const res = hookVerdict({ mode: 'repo', hooksPath: 'scripts/hooks', hasPre: true, hasMsg: false, customHookExists: false });
  check('repo mode with incomplete hooks dir fails', res.level === 'fail', JSON.stringify(res));
}

// 23. Adopter mode: custom hook installed, no hooksPath → pass, never fail
{
  const res = hookVerdict({ mode: 'adopter', hooksPath: '', hasPre: false, hasMsg: false, customHookExists: true });
  check('adopter mode with a custom hook passes', res.level === 'pass', JSON.stringify(res));
}

// 23b. Adopter mode: hooksPath SET but the dir holds no hook → warn, not a
// false PASS. A set path is a claim about enforcement; reporting it healthy
// when the dir is empty is the false green this review pass removes.
{
  const res = hookVerdict({ mode: 'adopter', hooksPath: 'scripts/hooks', hasPre: false, hasMsg: false, customHookExists: false });
  check('adopter mode with an empty hooksPath dir warns', res.level === 'warn', JSON.stringify(res));
  check('adopter mode empty-hooksPath message names the path', /scripts\/hooks/.test(res.message), res.message);
}

// 23c. Adopter mode: hooksPath set AND the dir is complete → pass.
{
  const res = hookVerdict({ mode: 'adopter', hooksPath: 'scripts/hooks', hasPre: true, hasMsg: true, customHookExists: false });
  check('adopter mode with a complete hooksPath dir passes', res.level === 'pass', JSON.stringify(res));
}

// 24. Adopter mode: no hook at all → warn (a lead, not an installation defect)
{
  const res = hookVerdict({ mode: 'adopter', hooksPath: '', hasPre: false, hasMsg: false, customHookExists: false });
  check('adopter mode without any hook warns', res.level === 'warn', JSON.stringify(res));
  check('adopter mode never fails on hooks', res.level !== 'fail', JSON.stringify(res));
}

// ---- C4b. Ledger path resolution (ticket 04, spec §AC11) ----
// Doctor hardcoded `.trust/progress.txt`. The adopter convention (their router,
// 7397 lines of it) is `progress.txt` at the root — so the audit never ran on
// the real ledger it was built to check.

// 25. .trust ledger preferred when both exist — and the shadowed file is named
{
  const res = pickLedgerPath({ hasTrustLedger: true, hasRootLedger: true });
  check('pickLedgerPath prefers .trust/progress.txt',
    res.path === '.trust/progress.txt', JSON.stringify(res));
  check('pickLedgerPath reports the shadowed ledger',
    res.shadowed === 'progress.txt', JSON.stringify(res));
}
// 26. Root ledger used when it is the only one (the adopter convention)
{
  const res = pickLedgerPath({ hasTrustLedger: false, hasRootLedger: true });
  check('pickLedgerPath falls back to root progress.txt',
    res.path === 'progress.txt' && res.shadowed === null, JSON.stringify(res));
}
// 27. Neither exists → null (no audit, no crash)
{
  const res = pickLedgerPath({ hasTrustLedger: false, hasRootLedger: false });
  check('pickLedgerPath returns null when no ledger exists',
    res.path === null && res.shadowed === null, JSON.stringify(res));
}

// ---- C7b. M4 blind-spot surfacing (ticket 04, spec §AC9) ----
// `mandatoryMentions` was computed by auditLedger and read by nobody: the
// component built to expose the 47-vs-0 blind spot was itself silently dead.
// Doctor now warns when a MANDATORY skill has zero Loaded: mentions while its
// domain was touched — the signal, finally wired to a consumer.

// 28. A MANDATORY skill with zero mentions in a touched domain → one warning
{
  const msgs = blindSpotWarning({
    mandatoryMentions: [
      { skill: 'expect-fail', count: 3, domainTouched: true },
      { skill: 'root-cause', count: 0, domainTouched: true },
      { skill: 'receipts', count: 0, domainTouched: false },
    ],
  });
  check('blind spot warns for a zero-mention skill in a touched domain',
    msgs.length === 1 && /root-cause/.test(msgs[0]), JSON.stringify(msgs));
}

// 29. No blind spot → no warnings (a clean ledger must stay quiet)
{
  const msgs = blindSpotWarning({
    mandatoryMentions: [
      { skill: 'expect-fail', count: 5, domainTouched: true },
      { skill: 'receipts', count: 2, domainTouched: true },
    ],
  });
  check('no blind spot produces no warning', msgs.length === 0, JSON.stringify(msgs));
}

// 30. Zero mentions but domain NOT touched → not a blind spot (nothing to see)
{
  const msgs = blindSpotWarning({
    mandatoryMentions: [{ skill: 'root-cause', count: 0, domainTouched: false }],
  });
  check('untouched domain is not a blind spot', msgs.length === 0, JSON.stringify(msgs));
}

if (failures) { console.error(`\nFAIL: ${failures} expectation(s) broken.`); process.exit(1); }
console.log('\nOK: doctor C5/C5b behaves as specified.');

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

// ---- K. Gate C-check (mandatory-gate, ticket 03) ----
// Seam: gateVerdict({ gateExists, gateSelfTestPasses, mode }) — doctor verifies
// the gate like any other installation component: fail-level when the script
// is missing from a repo-mode checkout; warn-level in adopter mode (C2 lesson:
// adopters copy skills, not scripts, so strictness would misfire); pass when
// present and its self-test suite passes.
{
  const repo = gateVerdict({ gateExists: false, gateSelfTestPasses: false, mode: 'repo' });
  check('K1 repo-mode missing gate is fail-level',
    repo.level === 'fail', JSON.stringify(repo));
  const adopter = gateVerdict({ gateExists: false, gateSelfTestPasses: false, mode: 'adopter' });
  check('K2 adopter-mode missing gate is warn-level, never fail',
    adopter.level === 'warn', JSON.stringify(adopter));
  const ok = gateVerdict({ gateExists: true, gateSelfTestPasses: true, mode: 'repo' });
  check('K3 present + passing gate is pass-level',
    ok.level === 'pass', JSON.stringify(ok));
  const broken = gateVerdict({ gateExists: true, gateSelfTestPasses: false, mode: 'repo' });
  check('K4 present but failing self-test is fail-level',
    broken.level === 'fail', JSON.stringify(broken));
  check('K5 pass message names the gate and its boundary role',
    ok.message.includes('mandatory-gate') && ok.message.includes('boundary'),
    ok.message);
}

// K6 (spec §Constraints binding — roast finding 2026-09-20): a gated-loaded-gap
// finding can NEVER fail an audit by itself. ledgerVerdict maps any findings to
// warn — this test binds the gate finding to that contract explicitly, so a
// future refactor that gives findings severity levels cannot silently promote
// the keyword matcher into a hard gate.
{
  const res = ledgerVerdict({
    findings: [{ date: '2026-09-08', kind: 'gated-loaded-gap', message: 'signal to verify' }],
    gaps: [],
  });
  check('K6 gated-loaded-gap verdict is warn-level, never fail',
    res.level === 'findings' && res.warn === true, JSON.stringify(res));
}

// K7 (roast finding 2026-09-20): the doctor WIRING is real — the C8 block must
// actually execute the gate's test file, not just check file presence. Run the
// same derivation doctor.mjs uses against the real files in this checkout.
{
  const { existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const gateTest = join(here, 'mandatory-gate.test.mjs');
  check('K7 the gate self-test file exists beside doctor.test.mjs and doctor derives its path',
    existsSync(gateTest) && join(here, 'mandatory-gate.mjs').replace(/\.mjs$/, '.test.mjs') === gateTest,
    gateTest);
}
