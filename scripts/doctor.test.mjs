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
import { hookVerdict, pickLedgerPath, blindSpotWarning, gateVerdict, manifestVerdict, gateFindingVerdict, extractHookTargets, hookTargetVerdict, floorVerdict, resolveFloor, adapterVerdict, overlayVerdict, grandfatherVerdict, rollupLedgerFindings } from './doctor-checks.mjs';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Pin the zone. A ledger heading is a CALENDAR DAY and `today` is an instant;
// leaving the zone ambient makes every starvation fixture host-dependent, and
// on a UTC host it hides the off-by-one at the grace edge entirely (offset 0
// can never disagree). Asia/Jakarta is UTC+7 — east of UTC, where the
// unnormalised frame reports a starved ledger as still inside grace. Every
// existing fixture's `today` is a UTC-midnight instant, which lands at 07:00
// local on the same calendar day, so fixtures 1–7 are unchanged.
process.env.TZ = 'Asia/Jakarta';

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

// 6b. Grace boundary measured in CALENDAR DAYS, not raw instants
// A heading dated 2026-09-24 is 14 days old on 2026-10-08, whatever the hour.
// 2026-10-07T18:00Z is 2026-10-08 01:00 in Asia/Jakarta: the local calendar
// says the grace is spent, a raw-instant subtraction says 13.5 days and floors
// to 13 — so an unnormalised frame reports a starved ledger as still inside
// grace. Starvation must not be an accident of the host's timezone.
{
  const res = checkStarve({
    ledgerText: ledgerWithDate('2026-09-24'),
    lessonsExists: false,
    today: new Date('2026-10-07T18:00:00Z'),
    graceDays: 14,
  });
  check('age-at-grace-exact holds across the day boundary (calendar day, any hour)',
    res.level === 'fail', JSON.stringify(res));
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

// ---- O/P groups (overlay registry) follow; the terminal exit lives at the
// file end so appended groups cannot run past it (the first version of the
// O/P append did exactly that — failures with exit 0, a suite that could not
// go red). ----

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


// ---- M. Adopter-mode gate OVERLAP note (audit 2026-09-29; the first design
// was suppression and measurement killed it — the gate's findings are mostly
// invisible to the literal audit, so filtering them would delete real signal).
// The contract is now: report every gate finding, and print how many overlap
// the literal audit versus how many are unique to the gate.
{
  const v = gateFindingVerdict({ gateFindings: 33, literalFindings: 11 });
  check('M1 the annotation reports every gate finding, none suppressed',
    v.reported === 33, JSON.stringify(v));
  check('M2 it separates the unique gate findings from the overlapping ones',
    v.unique === 22 && v.overlapping === 11, JSON.stringify(v));
  check('M3 the message names both counts (reader sees the duplication as a number)',
    /22 unique/.test(v.message) && /11 alongside/.test(v.message), v.message);
}
{
  const v = gateFindingVerdict({ gateFindings: 3, literalFindings: 3 });
  check('M4 a fully overlapping gate set says so without hiding the count',
    v.reported === 3 && v.unique === 0 && /all on entries the literal audit already flags/.test(v.message),
    JSON.stringify(v));
}
{
  const v = gateFindingVerdict({ gateFindings: 0, literalFindings: 4 });
  check('M5 no gate findings yields an empty, honest annotation',
    v.reported === 0 && v.unique === 0, JSON.stringify(v));
}


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

// ---- L. Manifest version must agree with the install stamp (C9) ----
// Origin: 2026-09-27 cross-harness audit. The Claude Code plugin — the actual
// enforcement mechanism on the author's machine — carried version 0.1.16 in its
// .claude-plugin/plugin.json while .trust/tna-version said 0.1.20. Doctor read
// only the stamp and reported "skills version current (v0.1.20)". plugin.json is
// documented by docs/installation.md as part of the plugin shape and is written
// by NO script, so nothing could ever bring the two into agreement: the same
// computed-signal-with-no-consumer class as M4, inverted — a documented artifact
// with no writer and no reader.
{
  const r = manifestVerdict({ stampVersion: '0.1.20', manifestVersion: '0.1.16' });
  check('L1 manifest behind the stamp is warn-level', r.level === 'warn', JSON.stringify(r));
  check('L2 the warning names both versions', /0\.1\.20/.test(r.message) && /0\.1\.16/.test(r.message), r.message);
  check('L3 the warning names the manifest file', /plugin\.json/.test(r.message), r.message);
  check('L4 matching versions pass', manifestVerdict({ stampVersion: '0.1.20', manifestVersion: '0.1.20' }).level === 'pass');
  check('L5 a manifest AHEAD of the stamp is also flagged', manifestVerdict({ stampVersion: '0.1.16', manifestVersion: '0.1.20' }).level === 'warn');
  check('L6 absent manifest degrades to pass (not every install has one)', manifestVerdict({ stampVersion: '0.1.20', manifestVersion: '' }).level === 'pass');
  check('L7 absent stamp degrades to pass (C6 owns the unstamped case)', manifestVerdict({ stampVersion: '', manifestVersion: '0.1.16' }).level === 'pass');
  check('L8 the warning says the update is a user decision, not a fix doctor performs', /user decision|installation\.md/i.test(r.message), r.message);
}

// K7 (roast finding 2026-09-20): the doctor WIRING is real — the C8 block must
// actually execute the gate's test file, not just check file presence. Run the
// same derivation doctor.mjs uses against the real files in this checkout.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const gateTest = join(here, 'mandatory-gate.test.mjs');
  check('K7 the gate self-test file exists beside doctor.test.mjs and doctor derives its path',
    existsSync(gateTest) && join(here, 'mandatory-gate.mjs').replace(/\.mjs$/, '.test.mjs') === gateTest,
    gateTest);
}

// K8 (hardening-general 06/AC8): the meter WIRING is real — doctor.mjs must
// CALL meterVerdict (check-30 doctrine: match the call, not the import), or
// the meter module ships while doctor never prints it.
{
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'doctor.mjs'), 'utf8');
  check('K8 doctor.mjs CALLS meterVerdict (a computed-but-unread meter is a dead component)',
    /meterVerdict\s*\(/.test(src), 'no meterVerdict( call in doctor.mjs');
}

// ---- K9/K10. Gate self-test ABSENT is not the same defect as RED (C8) ----
// Origin 2026-11-01, measured on a real install: running doctor from the
// distributed payload (plugin/ in the checkout, or the installed plugin cache)
// printed "mandatory-gate self-test fails — the classifier drifts from its
// keyword tables" while the classifier was green. Cause: the payload ships
// mandatory-gate.mjs but never mandatory-gate.test.mjs (sync-payloads.mjs
// mirrors same-name .mjs only), so "test file missing" was folded into
// "self-test failed" and reported as classifier drift — a false diagnosis of
// the one component that was working.
//
// Intent, stated before the fix ran: absence of the test is a DEFECT in a
// source checkout (the file is tracked and CI runs it) and a STRUCTURAL FACT
// in a distributed payload (it is not shipped). Different facts, different
// verdicts. The repo-mode case is a preservation pin whose message assertion
// is new (it must name the missing file, not accuse the classifier).
{
  const absentInAdopter = gateVerdict({ gateExists: true, gateTestExists: false, gateSelfTestPasses: false, mode: 'adopter' });
  check('K9 a payload that ships the gate without its self-test warns, never fails',
    absentInAdopter.level === 'warn', JSON.stringify(absentInAdopter));
  check('K9b the warning says the test is not shipped, not that the classifier drifted',
    /self-test|test file/.test(absentInAdopter.message) && !/drift/i.test(absentInAdopter.message),
    absentInAdopter.message);
  const absentInRepo = gateVerdict({ gateExists: true, gateTestExists: false, gateSelfTestPasses: false, mode: 'repo' });
  check('K10 a checkout missing its tracked self-test fails, naming the file',
    absentInRepo.level === 'fail' && /mandatory-gate\.test\.mjs/.test(absentInRepo.message),
    JSON.stringify(absentInRepo));
  check('K10b the checkout failure does not accuse the classifier of drift (absence is not redness)',
    !/drift/i.test(absentInRepo.message), absentInRepo.message);
  const red = gateVerdict({ gateExists: true, gateTestExists: true, gateSelfTestPasses: false, mode: 'adopter' });
  check('K10c a test that exists and fails is fail-level in adopter mode too (red is red everywhere)',
    red.level === 'fail' && /drift/i.test(red.message), JSON.stringify(red));
}

// ---- K11. Live: doctor run inside the distributed payload must not FAIL ----
// The seam Master hit, driven end to end rather than through the verdict: the
// payload directory is doctor's OWN tree (cwd === ROOT) but it is not a source
// checkout — no categorized skills tree, no tracked hooks dir, no .test.mjs.
// Treating "where the script lives" as "what the directory is" applied the
// strict checkout contract to a distribution artifact and produced two false
// FAILs. Fixture: the repo's own plugin/ payload — a real one, not a mock.
{
  const hereK11 = dirname(fileURLToPath(import.meta.url));
  const doctorK11 = join(hereK11, 'doctor.mjs');
  const payloadK11 = join(hereK11, '..', 'plugin');
  const r = spawnSync(process.execPath, [doctorK11], { cwd: payloadK11, encoding: 'utf8', timeout: 120000 });
  const out = String(r.stdout ?? '');
  const failLines = out.split('\n').filter((l) => l.startsWith('FAIL'));
  check('K11 doctor run inside the distributed payload reports no installation gap',
    r.status === 0 && failLines.length === 0,
    `exit=${r.status} ${failLines.join(' | ').slice(0, 300)}`);
}

// M1/M2 (hardening-general roast/AC8): the meter block can never fail the
// install it reports on. Slice the C10 region and assert it contains no
// fail( invocation and no process.exit — every path warns. An absence test:
// its RED was proven by injecting fail('x') into the region (suite FAILs),
// then reverting (suite PASSes).
{
  const srcM = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'doctor.mjs'), 'utf8');
  // The meter region ends at the NEXT section marker, not at the summary —
  // slicing to the summary worked while C10 was the last section; the
  // overlay section added after it belongs outside the meter's region.
  const c10Start = srcM.indexOf('C10. gate meter');
  const region = srcM.slice(c10Start, srcM.indexOf('// ----', c10Start + 1));
  check('M1 the meter region never calls fail (WARN-only by decision)',
    !/[^a-zA-Z]fail\s*\(/.test(region), region.slice(0, 200));
  check('M2 the meter region never exits the process (exit code stays with health checks)',
    !/process\.exit/.test(region), region.slice(0, 200));
}

// ---- O. Overlay registry verdict (decision-composition 04; spec AC9/AC10/AC16) ----
{
  const absent = overlayVerdict({ tierPresent: false });
  check('O1 an absent overlay tier is optional (pass, named)',
    absent.level === 'pass' && /optional/.test(absent.lines.join(' ')), JSON.stringify(absent));
  const defect = overlayVerdict({ tierPresent: true, errors: ['bad-anchor: anchor "root-cause/Phase-99" is not in the derived canonical catalog'], entryCount: 0, omittedCount: 0 });
  check('O2 a defect is fail-level and names the skill + kind',
    defect.level === 'fail' && /bad-anchor/.test(defect.lines.join(' ')) && /catalog/.test(defect.lines.join(' ')), JSON.stringify(defect));
  const omission = overlayVerdict({ tierPresent: true, errors: [], entryCount: 3, omittedCount: 2 });
  check('O3 budget omission is warn-level and carries the count',
    omission.level === 'warn' && /2 overlay/.test(omission.lines.join(' ')), JSON.stringify(omission));
  const clean = overlayVerdict({ tierPresent: true, errors: [], entryCount: 2, omittedCount: 0 });
  check('O4 a clean registry is pass with the entry count',
    clean.level === 'pass' && /2 overlay/.test(clean.lines.join(' ')), JSON.stringify(clean));
  const both = overlayVerdict({ tierPresent: true, errors: ['x: y'], entryCount: 1, omittedCount: 1 });
  check('O5 defects dominate the level (fail even alongside an omission warning)',
    both.level === 'fail' && both.lines.some((l) => /omitted/.test(l)), JSON.stringify(both));
}
{
  // Wiring (K8 precedent): doctor.mjs must CALL the overlay seams, or the
  // verdict ships while doctor never prints it — a computed-but-unread
  // verdict is a dead component.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'doctor.mjs'), 'utf8');
  check('O6 doctor.mjs CALLS the shared overlay seam (computed-but-unread = dead)',
    /scanSessionOverlays\s*\(/.test(src) && /overlayVerdict\s*\(/.test(src), 'no scanSessionOverlays(/overlayVerdict( call in doctor.mjs');
}
// ---- P. Live doctor overlay verdicts (roast spec Required: AC9/AC16) ----
// The O-group tests the pure verdict; this proves the LIVE doctor surfaces
// each defect kind by name and recomputes at read time (AC16: mutating a
// registry file between runs changes the verdict, no cache). Fixtures live
// in temp cwds; the doctor is spawned with cwd = the fixture dir — no
// scripts/ there, so the gate self-tests do not run and the spawn is fast.
{
  const DOCTOR = join(dirname(fileURLToPath(import.meta.url)), 'doctor.mjs');
  const runDoctor = (dir) => String(spawnSync(process.execPath, [DOCTOR], { cwd: dir, encoding: 'utf8', timeout: 60000 }).stdout ?? '');
  const put = (dir, name, body) => {
    const d = join(dir, '.trust', 'skills-overlay', name);
    mkdirSync(d, { recursive: true });
    if (body !== null) writeFileSync(join(d, 'SKILL.md'), body);
    return d;
  };

  // P1: every defect kind surfaces in the live doctor output, named.
  {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-overlay-'));
    put(dir, 'missing-file', null);
    put(dir, 'bad-role', '---\nname: bad-role\nextends: root-cause/Phase-1\nrole: skip\n---\nbody');
    put(dir, 'malformed', 'no frontmatter at all');
    put(dir, 'bad-anchor', '---\nname: bad-anchor\nextends: root-cause/Phase-99\nrole: insert-after\n---\nbody');
    const out = runDoctor(dir);
    check('P1 the live doctor names every defect kind by skill',
      /missing-file.*missing skill file/is.test(out) && /bad-role.*illegal role/is.test(out)
      && /malformed.*frontmatter/is.test(out) && /bad-anchor.*anchor/is.test(out),
      out.split('\n').filter((l) => /overlay/.test(l)).join(' | ').slice(0, 400));
    rmSync(dir, { recursive: true, force: true });
  }

  // P2: trust computed at read time — the fix changes the verdict (AC16).
  {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-nocache-'));
    const d = put(dir, 'mutant', '---\nname: mutant\nextends: root-cause/Phase-99\nrole: insert-after\n---\nbody');
    const before = runDoctor(dir);
    check('P2a the first run reports the defect', /mutant.*anchor/is.test(before), before.slice(0, 200));
    writeFileSync(join(d, 'SKILL.md'), '---\nname: mutant\nextends: root-cause/Phase-1\nrole: insert-after\n---\nbody');
    const after = runDoctor(dir);
    check('P2b re-running after the fix shows no defect (computed at read time, no cache)',
      !/mutant.*anchor/is.test(after) && /1 overlay\(s\) validated/.test(after),
      after.split('\n').filter((l) => /overlay/.test(l)).join(' | ').slice(0, 300));
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- Q. Onboarding consent in the doctor (spec AC12/AC13) ----
// Unit both directions; live derivation uses the repo itself as the
// working-install fixture (hooks wired + skills found + no stamp), writing
// and removing a stamp around the run — .trust/onboarding.json is the only
// file touched.
{
  check('Q1 a working-install signal with no stamp warns, naming the CLI',
    grandfatherVerdict({ hooksWired: true }).level === 'warn' && /onboarding\.mjs/.test(grandfatherVerdict({ hooksWired: true }).message),
    JSON.stringify(grandfatherVerdict({ hooksWired: true })));
  check('Q2 a fresh tree (no signal, no stamp) is silent',
    grandfatherVerdict({}).level === 'pass', JSON.stringify(grandfatherVerdict({})));
  const DOCTOR = join(dirname(fileURLToPath(import.meta.url)), 'doctor.mjs');
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
  const STAMP = join(REPO, '.trust', 'onboarding.json');
  const runRepoDoctor = () => String(spawnSync(process.execPath, [DOCTOR], { cwd: REPO, encoding: 'utf8', timeout: 120000 }).stdout ?? '');
  const hadStamp = existsSync(STAMP);
  const saved = hadStamp ? readFileSync(STAMP, 'utf8') : null;
  try {
    if (hadStamp) rmSync(STAMP, { force: true });
    const before = runRepoDoctor();
    check('Q3 the live doctor warns (not fails) on the working repo without a stamp',
      /no consent stamp/.test(before) && /PASS|OK:/.test(before), before.split('\n').filter((l) => /consent/.test(l)).join(' | ').slice(0, 200));
    mkdirSync(join(REPO, '.trust'), { recursive: true });
    writeFileSync(STAMP, JSON.stringify({ schema: 1, consentedAt: '2026-10-14T00:00:00.000Z', routerVersion: '0.1.28', harness: 'test', components: { floor: true, hooks: true, overlays: true, evidenceGate: false }, did: {} }));
    const after = runRepoDoctor();
    check('Q4 with a stamp, the grandfather warning is gone and the decline is named loudly',
      !/no consent stamp/.test(after) && /declined at onboarding.*evidenceGate|evidenceGate.*declined/s.test(after),
      after.split('\n').filter((l) => /consent|declined/.test(l)).join(' | ').slice(0, 200));
  } finally {
    if (saved !== null) writeFileSync(STAMP, saved);
    else if (existsSync(STAMP)) rmSync(STAMP, { force: true });
  }
}
// ---- R. Ledger-audit display rollup + dev-mode badge (A+C, Master 2026-10-14) ----
// The 47-findings wall: a developer's dense ledger turns the doctor into a
// wall of numbered warnings that reads like a broken install (Master: "setiap
// update selalu menyisahkan 47 findings ... sangat mengganggu para user").
// The doctor must print ONE rollup line (total + per-kind counts + the
// warn-only/exit-0 fact), and in repo mode (the framework's own checkout) a
// single dev-mode badge instead of a wall.
{
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'doctor.mjs'), 'utf8');
  check('R1 the doctor carries a single-line rollup (total + per-kind + warn-only) for bulk findings',
    /rollupLedgerFindings/.test(src), 'no rollupLedgerFindings in doctor.mjs');
  check('R2 the doctor carries the dev-mode badge (repo mode collapses the wall into one badge line)',
    /dev-mode ledger/.test(src), 'no dev-mode badge in doctor.mjs');
  const fixtures = [
    { kind: 'next-gap', message: 'x' }, { kind: 'next-gap', message: 'y' }, { kind: 'next-gap', message: 'z' },
    { kind: 'gated-loaded-gap', message: 'a' }, { kind: 'gated-loaded-gap', message: 'b' },
    { kind: 'lesson-gap', message: 'c' },
  ];
  const roll = rollupLedgerFindings({ findings: fixtures, total: 47 });
  check('R3 the rollup is one line: total + per-kind counts + the warn-only fact',
    roll.split('\n').length === 1 && /47/.test(roll) && /next-gap \(3\)/.test(roll)
    && /gated-loaded-gap \(2\)/.test(roll) && /lesson-gap \(1\)/.test(roll) && /warning/i.test(roll),
    roll);
  const empty = rollupLedgerFindings({ findings: [], total: 0 });
  check('R4 zero findings produce no rollup line (nothing to summarize)',
    empty === null, JSON.stringify(empty));
}
// ---- K12. A broken gate hook must not take the doctor down with it (2026-11-03) ----
// The hook's own import guard makes a load failure warn instead of exiting 1,
// but the doctor USED TO import scanSessionOverlays from that same module — so
// exactly when the hook was broken, the tool whose job is to report the break
// died on the same throw. Two expectations: the doctor still produces its
// report and names the unloadable hook (behavioral, on a real copy of scripts/
// with one dependency deleted), and it never statically imports the hook again
// (source-level, so the regression cannot come back through a tidy-looking
// import list).
{
  const hereK12 = dirname(fileURLToPath(import.meta.url));
  const repoK12 = join(hereK12, '..');
  const tmp = mkdtempSync(join(tmpdir(), 'doctor-broken-hook-'));
  const scriptsCopy = join(tmp, 'scripts');
  cpSync(join(repoK12, 'scripts'), scriptsCopy, { recursive: true, filter: (p) => !p.includes('tickets-fixture') });
  // Remove the hook's own dependency, not the hook: the copy is a REAL partial
  // install (a payload missing one referenced file), the failure under test.
  rmSync(join(scriptsCopy, 'reinject.mjs'));
  const r = spawnSync(process.execPath, [join(scriptsCopy, 'doctor.mjs')], {
    cwd: tmp, encoding: 'utf8', timeout: 180000,
  });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  const lines = out.split('\n');
  check('K12a the doctor still reports when the gate hook cannot load',
    !/ERR_MODULE_NOT_FOUND/.test(out) && lines.some((l) => l.startsWith('FAIL') || l.startsWith('WARN')),
    out.slice(0, 400));
  check('K12b the unloadable hook is named as a failure',
    lines.some((l) => l.startsWith('FAIL') && /gate hook/i.test(l)), out.slice(0, 600));
  rmSync(tmp, { recursive: true, force: true });
  const src = readFileSync(join(repoK12, 'scripts', 'doctor.mjs'), 'utf8');
  check('K12c doctor never statically imports the hook module (a load crash would kill the report)',
    !/^import[^\n]*from ['"]\.\/gate-hook\.mjs['"]/m.test(src),
    (src.match(/^import[^\n]*gate-hook[^\n]*$/m) || [''])[0]);
}

// ---- C13 hook-target liveness (dead-gate detection) ----
{
  // The measured adopter shape: settings JSON naming project-relative paths.
  const cfg = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR}/scripts/orchestrator-brief.mjs' }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'sh .trust/restore-tooling.sh && node .devin/scripts/hook.mjs' }] }],
    },
    permissions: { allow: ['Bash(git status)'] },
  };
  const t = extractHookTargets(cfg).map((x) => x.target).sort();
  check('C13a ${CLAUDE_PROJECT_DIR}/x and bare sh/node targets are extracted',
    t.join(',') === '.devin/scripts/hook.mjs,.trust/restore-tooling.sh,scripts/orchestrator-brief.mjs', t.join(','));
}
{
  // A [ ! -f ]-guarded target is optional by the config's own declaration.
  const cfg = { hooks: { PreToolUse: [{ command: '[ ! -f scripts/opt.mjs ] && exit 0; node scripts/opt.mjs --go' }] } };
  const t = extractHookTargets(cfg);
  check('C13b guarded target is optional (conditional hook)', t.length === 1 && t[0].optional === true, JSON.stringify(t));
}
{
  const cfg = { hooks: { PreToolUse: [{ command: 'node scripts/there.mjs' }] } };
  const v = hookTargetVerdict({ missing: ['scripts/there.mjs'], checked: 1, files: ['.claude/settings.json'] });
  check('C13c missing target is FAIL naming the file', v.level === 'fail' && /scripts\/there\.mjs/.test(v.message));
}
{
  check('C13d all-present is PASS', hookTargetVerdict({ missing: [], checked: 3, files: ['.claude/settings.json'] }).level === 'pass');
  check('C13e no hook config is PASS (C2 owns the wired question)', hookTargetVerdict({ missing: [], checked: 0, files: [] }).level === 'pass');
}
{
  // End-to-end: a fixture project whose settings.local.json points at a file
  // that does not exist must come back FAIL from the doctor itself.
  const hereK13 = dirname(fileURLToPath(import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'doctor-c13-'));
  mkdirSync(join(tmp, '.claude'), { recursive: true });
  writeFileSync(join(tmp, '.claude', 'settings.local.json'),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR}/scripts/ghost.mjs' }] }] } }));
  const r = spawnSync(process.execPath, [join(hereK13, 'doctor.mjs')], { cwd: tmp, encoding: 'utf8', timeout: 180000 });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  check('C13f doctor FAILs and names the dead gate target',
    /FAIL.*hook target.*scripts\/ghost\.mjs/s.test(out), out.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ').slice(0, 400));
  rmSync(tmp, { recursive: true, force: true });
}

// ---- C14. Discipline floor resolvable from the project's own router ----
// A merged adoption keeps the project's router as the only router and
// cherry-picks the framework's gates into it (installation.md §Verify step 5:
// "the Iron Laws must be recitable from the project's own files"). A merge
// that drops the MANDATORY section or the Iron Laws leaves every router FILE
// C1 checks present while the floor injection emits a NOT FOUND half — a
// silent hole no file-presence check can see. C14 resolves the floor from the
// router text itself and fails when a stamp-consented floor cannot be read.
{
  const FLOOR_FULL = [
    '## Iron Laws', '',
    '- No acting until the user confirms shared understanding.',
    '- No production code without a failing test first.',
    '- No completion claims without fresh verification evidence.',
    "- No expensive, irreversible, or shared-system action (commit, push, delete) without the user's explicit sign-off.",
    '', '## MANDATORY discipline skills', '',
    '- **`expect-fail`** — load before writing any test or behavior change.',
    '- **`root-cause`** — load before proposing any fix.',
    '- **`receipts`** — load before accepting any done claim.',
  ].join('\n');

  const both = await resolveFloor(FLOOR_FULL);
  check('C14a resolveFloor finds both halves in a merged router text',
    both.lawsFound && both.mandatoryFound, JSON.stringify(both));

  const lawsOnly = await resolveFloor(FLOOR_FULL.split('## MANDATORY')[0]);
  check('C14b resolveFloor flags a dropped MANDATORY section',
    lawsOnly.lawsFound && !lawsOnly.mandatoryFound, JSON.stringify(lawsOnly));

  const neither = await resolveFloor('# Project rules\n\n- do the thing\n');
  check('C14c resolveFloor flags a router carrying no floor at all',
    !neither.lawsFound && !neither.mandatoryFound, JSON.stringify(neither));

  check('C14d consented floor + dropped section = FAIL (the merge hole this check exists for)',
    floorVerdict({ mode: 'adopter', floorConsented: true, filesScanned: ['AGENTS.md'], lawsFound: true, mandatoryFound: false }).level === 'fail');

  check('C14e no stamp + dropped section = WARN (cannot tell adoption from never-installed)',
    floorVerdict({ mode: 'adopter', floorConsented: null, filesScanned: ['AGENTS.md'], lawsFound: true, mandatoryFound: false }).level === 'warn');

  check('C14f declined floor = quiet PASS (a visible decision, surfaced by ON)',
    floorVerdict({ mode: 'adopter', floorConsented: false, filesScanned: ['AGENTS.md'], lawsFound: false, mandatoryFound: false }).level === 'pass');

  check('C14g repo mode + dropped half = FAIL (the framework router must carry its own floor)',
    floorVerdict({ mode: 'repo', floorConsented: true, filesScanned: ['AGENTS.md'], lawsFound: false, mandatoryFound: true }).level === 'fail');

  check('C14h resolvable floor = PASS',
    floorVerdict({ mode: 'adopter', floorConsented: true, filesScanned: ['AGENTS.md', 'WORKFLOW.md'], lawsFound: true, mandatoryFound: true }).level === 'pass');

  check('C14i consented floor + no router files at all = FAIL',
    floorVerdict({ mode: 'adopter', floorConsented: true, filesScanned: [], lawsFound: false, mandatoryFound: false }).level === 'fail');

  check('C14j no stamp + no router files = quiet PASS (C1 owns the missing-router report)',
    floorVerdict({ mode: 'adopter', floorConsented: null, filesScanned: [], lawsFound: false, mandatoryFound: false }).level === 'pass');
}
{
  // End-to-end: a fixture project that consented to the floor at onboarding
  // but merged its router WITHOUT the MANDATORY section must come back FAIL
  // from the doctor itself — the glue (file scan → stamp → verdict) is what
  // this leg proves, not the truth table.
  const hereK14 = dirname(fileURLToPath(import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'doctor-c14-'));
  mkdirSync(join(tmp, '.trust'), { recursive: true });
  writeFileSync(join(tmp, 'AGENTS.md'), [
    '# Our router', '',
    '## Iron Laws', '',
    '- No acting until the user confirms shared understanding.',
    '- No production code without a failing test first.',
    '- No completion claims without fresh verification evidence.',
    "- No expensive, irreversible, or shared-system action (commit, push, delete) without the user's explicit sign-off.",
  ].join('\n'));
  writeFileSync(join(tmp, '.trust', 'onboarding.json'),
    JSON.stringify({ schema: 1, components: { floor: true, hooks: false, overlays: false, evidenceGate: false } }));
  const r = spawnSync(process.execPath, [join(hereK14, 'doctor.mjs')], { cwd: tmp, encoding: 'utf8', timeout: 180000 });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  check('C14k doctor FAILs a consented-but-dropped floor and names the missing half',
    /FAIL.*floor.*MANDATORY/i.test(out), out.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ').slice(0, 400));
  rmSync(tmp, { recursive: true, force: true });
}

// ---- C15. C1 router check honours the merge path ----
// The merge install keeps the adopter's own router filename (CLAUDE.md,
// GEMINI.md, …) — the router follows the adopter's working style. C1 used to
// FAIL `WORKFLOW.md missing` on exactly that correct install: a false-FAIL
// indistinguishable from a broken one. In adopter mode any router file at the
// project root passes; in repo mode both framework files are still required.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const run = (dir) => {
    const r = spawnSync(process.execPath, [join(here, 'doctor.mjs')], { cwd: dir, encoding: 'utf8', timeout: 180000 });
    return String(r.stdout ?? '') + String(r.stderr ?? '');
  };

  // Adopter, merged router under a foreign name: no AGENTS.md, no WORKFLOW.md
  const t1 = mkdtempSync(join(tmpdir(), 'doctor-c15a-'));
  mkdirSync(join(t1, '.trust'), { recursive: true });
  writeFileSync(join(t1, 'CLAUDE.md'), '# Router\n\n## Iron Laws\n\n- one\n\n## MANDATORY discipline skills\n\n- **`expect-fail`**\n');
  writeFileSync(join(t1, '.trust', 'onboarding.json'), JSON.stringify({ schema: 1, components: { floor: true, hooks: false } }));
  const out1 = run(t1);
  check('C15a merged CLAUDE.md router passes C1 (no false router FAIL)',
    /PASS.*router/i.test(out1) && !/FAIL.*router|FAIL.*no router/i.test(out1),
    out1.split('\n').filter((l) => /router/i.test(l)).join(' | ').slice(0, 400));
  rmSync(t1, { recursive: true, force: true });

  // Adopter with no router file at all still fails — absence is real
  const t2 = mkdtempSync(join(tmpdir(), 'doctor-c15b-'));
  const out2 = run(t2);
  check('C15b no router file anywhere = C1 FAIL',
    /FAIL.*router/i.test(out2),
    out2.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ').slice(0, 400));
  rmSync(t2, { recursive: true, force: true });

  // Repo mode keeps the strict two-file contract
  const t3 = mkdtempSync(join(tmpdir(), 'doctor-c15c-'));
  mkdirSync(join(t3, 'skills', 'engineering', 'breakpoint'), { recursive: true });
  writeFileSync(join(t3, 'skills', 'engineering', 'breakpoint', 'SKILL.md'), 'x');
  writeFileSync(join(t3, 'AGENTS.md'), '# Router\n\n## Iron Laws\n\n- one\n\n## MANDATORY discipline skills\n\n- **`expect-fail`**\n');
  const out3 = run(t3);
  check('C15c repo mode still FAILs a missing WORKFLOW.md',
    /FAIL.*WORKFLOW\.md/i.test(out3),
    out3.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ').slice(0, 400));
  rmSync(t3, { recursive: true, force: true });
}

// ---- T02. User-level adapter registration detail + semantic floor truth ----
// First-install trust-layer ticket 02. A surviving veto/pre-tool entry must not
// certify the evidence recorder, and doctor must surface the scanner's detail
// rather than borrowing the dsh cordis.patch.yml explanation.
{
  const av = adapterVerdict({
    harness: 'devin',
    adapters: [{
      path: 'C:/fixture/home/.tna/veto-hooks/devin/hook.mjs',
      state: 'unregistered',
      missingRegistrations: ['PostToolUse:gate-hook'],
    }],
  });
  check('T02a adapter verdict names the missing evidence-recorder registration',
    av.level === 'warn' && /PostToolUse:gate-hook/.test(av.message), av.message);
  check('T02b user-level registration defects never use the dsh cordis explanation',
    !/cordis\.patch\.yml/.test(av.message), av.message);
}
{
  const placeholder = `# Router

## Iron Laws

\`\`\`
placeholder text explaining that rules will be added later
\`\`\`

## MANDATORY discipline skills

These important skills must be loaded when appropriate.
`;
  const floor = await resolveFloor(placeholder);
  check('T02c resolveFloor rejects placeholder Iron Laws',
    floor.lawsFound === false, JSON.stringify(floor));
  check('T02d resolveFloor rejects a MANDATORY body missing the three skills',
    floor.mandatoryFound === false, JSON.stringify(floor));
}

// ---- T05. Layered readiness in health output (first-install trust-layer AC11) ----
// Doctor's final line is a readiness verdict, not a checksum of PASS rows. A
// subprocess probe is adapter evidence only: it never proves the live host
// consumed the hook. Missing runtime files, declined components, unsupported
// surfaces, or absent live proof must therefore cap the verdict below full
// readiness, with each required layer named.
{
  const hereT05 = dirname(fileURLToPath(import.meta.url));
  const ONB_T05 = join(hereT05, 'onboarding.mjs');
  const DOCTOR_T05 = join(hereT05, 'doctor.mjs');
  const floorText = [
    '# Fixture router', '',
    '## Iron Laws', '',
    '- No acting until the user confirms shared understanding.',
    '- No production code without a failing test first.',
    '- No completion claims without fresh verification evidence.',
    "- No expensive, irreversible, or shared-system action (commit, push, delete) without the user's explicit sign-off.",
    '', '## MANDATORY discipline skills', '',
    '- **`expect-fail`** — load before writing any test or behavior change.',
    '- **`root-cause`** — load before proposing any fix.',
    '- **`receipts`** — load before accepting any done claim.',
  ].join('\n');
  const mkProject = (prefix) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(dir, '.devin'), { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), floorText);
    writeFileSync(join(dir, 'WORKFLOW.md'), floorText);
    const appData = join(dir, 'appdata');
    mkdirSync(join(appData, 'devin'), { recursive: true });
    writeFileSync(join(appData, 'devin', 'config.json'), '{}\n');
    const env = { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: appData };
    delete env.CLAUDE_PLUGIN_ROOT;
    return { dir, env };
  };
  const install = (fx, components) => spawnSync(process.execPath, [ONB_T05, '--from-chat', JSON.stringify({ components, mapSkills: [] })], {
    cwd: fx.dir, input: '', encoding: 'utf8', timeout: 60000, env: fx.env,
  });
  const doctor = (fx) => spawnSync(process.execPath, [DOCTOR_T05], {
    cwd: fx.dir, encoding: 'utf8', timeout: 180000, env: fx.env,
  });
  const textOf = (r) => String(r.stdout ?? '') + String(r.stderr ?? '');
  const everyLayerNamed = (text) => ['floor', 'mandatory-gate', 'veto', 'evidence-recorder', 'done-gate', 'ledger-append-only']
    .every((name) => new RegExp(`${name}:`).test(text));
  const noFullVerdict = (text) => !/full-readiness|fully ready|OK:\s*installation healthy/i.test(text);

  {
    const fx = mkProject('doctor-t05-complete-');
    const ins = install(fx, { floor: true, hooks: true, overlays: false, evidenceGate: true });
    const r = doctor(fx);
    const text = textOf(r);
    check('T05e doctor names every required readiness layer for a complete install',
      ins.status === 0 && /Readiness \(required layers\)/.test(text) && everyLayerNamed(text),
      `install=${ins.status} doctor=${r.status} out=${text.slice(-900)}`);
    check('T05f doctor distinguishes adapter self-test evidence from live host proof',
      /adapter self-test:/.test(text) && /live host proof:\s*(open|unproven)/i.test(text),
      `out=${text.slice(-700)}`);
    check('T05g unsupported done-gate plus absent live proof caps the doctor verdict',
      /done-gate:\s*unsupported/.test(text) && noFullVerdict(text) && /PARTIAL:\s*readiness/i.test(text),
      `out=${text.slice(-700)}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }

  {
    const fx = mkProject('doctor-t05-missing-runtime-');
    const ins = install(fx, { floor: true, hooks: true, overlays: false, evidenceGate: true });
    rmSync(join(fx.dir, '.tna', 'plugin', 'scripts', 'gate-hook.mjs'), { force: true });
    const r = doctor(fx);
    const text = textOf(r);
    check('T05h a missing runtime file is named as a missing required layer, never healthy',
      ins.status === 0 && /veto:\s*missing/.test(text) && /evidence-recorder:\s*missing/.test(text) && noFullVerdict(text),
      `install=${ins.status} doctor=${r.status} out=${text.slice(-900)}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }

  {
    const fx = mkProject('doctor-t05-declined-');
    const ins = install(fx, { floor: true, hooks: false, overlays: false, evidenceGate: false });
    const r = doctor(fx);
    const text = textOf(r);
    check('T05i declined layers stay visibly declined in doctor output',
      ins.status === 0 && /mandatory-gate:\s*declined/.test(text) && /veto:\s*declined/.test(text) && noFullVerdict(text),
      `install=${ins.status} doctor=${r.status} out=${text.slice(-900)}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

if (failures) { console.error(`nFAIL: ${failures} expectation(s) broken.`); process.exit(1); }
console.log('\nOK: doctor checks behave as specified (C5/C5b + K/M + O/P/Q + C13 + C14 + C15 + T02 + T05).');
