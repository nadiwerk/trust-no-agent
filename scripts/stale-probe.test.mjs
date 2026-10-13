#!/usr/bin/env node
/**
 * Fail-first test for scripts/stale-probe.mjs — the stale-memory
 * re-verification probe (findings-adaptation ticket 04, AC6; spec US6; corpus
 * D11 "stale-memory test — read 3-week note → same answer"). Zero deps.
 * Run: node scripts/stale-probe.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = probe behavior drift.
 *
 * Seam: pure functions over (lesson, now, runCmd) — parseLessons,
 * classify, canGate — plus a CLI smoke over a fixture file. The lesson
 * claim is prose; what is mechanically checkable is the CONTRACT around it:
 * a stale lesson must be re-verified against current behavior (its probe
 * command's exit code) before it may gate live work, and a lesson that
 * cannot be re-verified fails closed to history.
 *
 * Statuses (spec US6: dead memory cannot gate live work):
 *   fresh        age < STALE_DAYS — trusted by recency, no probe needed
 *   re-verified  stale, probe exit 0 — same answer as when recorded
 *   dead         stale, probe exit != 0 — current behavior CONTRADICTS the
 *                lesson; cannot gate, cannot steer
 *   unverifiable stale (or undated) with no probe, or undated — fail-closed:
 *                cannot gate either; absence of proof is not proof
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { STALE_DAYS, parseLessons, classify, canGate } =
  await import('./stale-probe.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. The window and the statuses ----
{
  check('A1 STALE_DAYS is 21 — D11\'s three-week note', STALE_DAYS === 21, String(STALE_DAYS));
}

// ---- B. Parsing: a Probe: line binds to the lesson above it ----
{
  const text = [
    '# lessons.md - corrective memory tier',
    '',
    'Lesson: root_cause = the hook can throw but not persist | correction = prove deny AND persistence live [2026-09-01]',
    'Probe: node scripts/tna-gate-v2.test.mjs',
    '',
    'Lesson: root_cause = no probe was ever written for this | correction = remember the shape only [2026-09-01]',
    '',
    'Lesson: root_cause = undated lesson | correction = cannot be aged',
  ].join('\n');
  const lessons = parseLessons(text);
  check('B1 three lessons parsed', lessons.length === 3, String(lessons.length));
  check('B2 the Probe: line binds to the lesson ABOVE it',
    lessons[0].probe === 'node scripts/tna-gate-v2.test.mjs', JSON.stringify(lessons[0]));
  check('B3 a lesson without a Probe: line parses with probe = null',
    lessons[1].probe === null && lessons[2].probe === null);
  check('B4 dates parse; undated is null (not guessed)',
    lessons[0].date === '2026-09-01' && lessons[2].date === null, JSON.stringify(lessons.map((l) => l.date)));
  check('B5 root cause text is captured (the lesson names its feature)',
    /the hook can throw/.test(lessons[0].rootCause), lessons[0].rootCause);
}

// ---- C. Fresh lessons are trusted by recency ----
{
  const now = new Date('2026-10-13T00:00:00Z');
  const fresh = { rootCause: 'x', correction: 'y', date: '2026-10-01', probe: null };
  check('C1 a 12-day-old lesson is fresh (inside the 21-day window)',
    classify(fresh, now, () => 1) === 'fresh', classify(fresh, now, () => 1));
  const edge = { rootCause: 'x', correction: 'y', date: '2026-09-22', probe: null };
  check('C2 day 21 exactly is stale (the window is inclusive)',
    classify(edge, now, () => 1) !== 'fresh', classify(edge, now, () => 1));
}

// ---- D. Stale lessons are re-verified by running their probe ----
{
  const now = new Date('2026-10-13T00:00:00Z');
  const stale = { rootCause: 'x', correction: 'y', date: '2026-09-01', probe: 'node scripts/whatever.test.mjs' };
  const seen = [];
  const ok = classify(stale, now, (cmd) => { seen.push(cmd); return 0; });
  check('D1 a stale lesson with a passing probe is re-verified', ok === 're-verified', ok);
  check('D2 the probe command actually runs (the exact cmd, not a guess)',
    seen.length === 1 && seen[0] === 'node scripts/whatever.test.mjs', JSON.stringify(seen));
  const dead = classify(stale, now, () => 1);
  check('D3 a stale lesson whose probe FAILS is dead — behavior contradicts it',
    dead === 'dead', dead);
  const noExec = classify(stale, now, null);
  check('D4 without an executor (default run) a probed stale lesson is unverifiable — fail-closed, never silently dead',
    noExec === 'unverifiable', noExec);
}

// ---- E. Fail-closed: unverifiable lessons cannot gate ----
{
  const now = new Date('2026-10-13T00:00:00Z');
  const noProbe = { rootCause: 'x', correction: 'y', date: '2026-09-01', probe: null };
  check('E1 stale + no probe → unverifiable (absence of proof is not proof)',
    classify(noProbe, now, () => 0) === 'unverifiable', classify(noProbe, now, () => 0));
  const undated = { rootCause: 'x', correction: 'y', date: null, probe: null };
  check('E2 an undated lesson cannot be aged → unverifiable, never fresh',
    classify(undated, now, () => 0) === 'unverifiable', classify(undated, now, () => 0));
  const undatedProbed = { rootCause: 'x', correction: 'y', date: null, probe: 'node -e "process.exit(0)"' };
  check('E3 an undated lesson is NOT probed (a probe cannot fix a missing age)',
    classify(undatedProbed, now, () => { throw new Error('must not run'); }) === 'unverifiable');
}

// ---- F. THE AC6 LINE: only fresh/re-verified may gate ----
{
  check('F1 fresh may gate', canGate('fresh') === true);
  check('F2 re-verified may gate', canGate('re-verified') === true);
  check('F3 DEAD cannot gate — the corpse does not steer live work', canGate('dead') === false);
  check('F4 unverifiable cannot gate — fail-closed', canGate('unverifiable') === false);
}

// ---- G. CLI smoke: fixture file, pinned --now, exit codes ----
// Probes execute ONLY with --allow-exec (roast 2026-10-13 security fix:
// Probe lines are agent-authored text; executing them by default is an
// irreversible action class, so the human signs off per invocation).
{
  const dir = mkdtempSync(join(tmpdir(), 'stale-probe-'));
  const fixture = join(dir, 'lessons.md');
  writeFileSync(fixture, [
    'Lesson: root_cause = passing probe lesson | correction = stays recallable [2026-09-01]',
    'Probe: node -e "process.exit(0)"',
    'Lesson: root_cause = failing probe lesson | correction = contradicted by now [2026-09-01]',
    'Probe: node -e "process.exit(1)"',
    'Lesson: root_cause = stale with no probe | correction = history only [2026-09-01]',
  ].join('\n'));
  try {
    const res = spawnSync(process.execPath,
      [join(HERE, 'stale-probe.mjs'), '--file', fixture, '--now', '2026-10-13', '--allow-exec'],
      { encoding: 'utf8', timeout: 60000 });
    check('G1 the CLI exits 1 when a probe contradicts its lesson (dead found)',
      res.status === 1, `status=${res.status} out=${(res.stdout || '').slice(0, 300)} err=${(res.stderr || '').slice(0, 200)}`);
    check('G2 it names the dead lesson and the verdict',
      /failing probe lesson/.test(res.stdout) && /dead/i.test(res.stdout), res.stdout.slice(0, 500));
    check('G3 it re-verifies the passing lesson (probe ran, verdict green)',
      /passing probe lesson/.test(res.stdout) && /re-verified/i.test(res.stdout), res.stdout.slice(0, 500));
    check('G4 the unprobed stale lesson is unverifiable, not silent',
      /stale with no probe/.test(res.stdout) && /unverifiable/i.test(res.stdout), res.stdout.slice(0, 500));

    writeFileSync(fixture, [
      'Lesson: root_cause = passing probe lesson | correction = stays recallable [2026-09-01]',
      'Probe: node -e "process.exit(0)"',
      'Lesson: root_cause = fresh lesson | correction = inside window [2026-10-10]',
    ].join('\n'));
    const clean = spawnSync(process.execPath,
      [join(HERE, 'stale-probe.mjs'), '--file', fixture, '--now', '2026-10-13', '--allow-exec'],
      { encoding: 'utf8', timeout: 60000 });
    check('G5 exit 0 when no lesson is dead (fresh + re-verified only)',
      clean.status === 0, `status=${clean.status} out=${(clean.stdout || '').slice(0, 300)}`);

    // Default run: the failing probe must NOT execute. If it ran, the dead
    // verdict and exit 1 would appear; observing unverifiable + exit 0 is
    // the proof of non-execution (fail-closed: probes not run cannot verify).
    const resDefault = spawnSync(process.execPath,
      [join(HERE, 'stale-probe.mjs'), '--file', fixture, '--now', '2026-10-13'],
      { encoding: 'utf8', timeout: 60000 });
    check('G6 default run does NOT execute probes (unverifiable, exit 0, hint shown)',
      resDefault.status === 0 && /unverifiable/i.test(resDefault.stdout) && /--allow-exec/i.test(resDefault.stdout),
      `status=${resDefault.status} out=${(resDefault.stdout || '').slice(0, 300)}`);

    // Even with --allow-exec, execution is narrowed: interpreter allowlist
    // (node/npm/npx) and NO shell — metacharacters are inert argv, never
    // syntax. `echo PWNED` never runs; a non-allowlisted probe cannot
    // execute against today's tree → dead (cannot gate either way).
    writeFileSync(fixture, [
      'Lesson: root_cause = injected command lesson | correction = attempted side channel [2026-09-01]',
      'Probe: echo PWNED',
    ].join('\n'));
    const injected = spawnSync(process.execPath,
      [join(HERE, 'stale-probe.mjs'), '--file', fixture, '--now', '2026-10-13', '--allow-exec'],
      { encoding: 'utf8', timeout: 60000 });
    check('G7 a non-node probe is refused by the allowlist and never executes',
      injected.status === 1 && /dead/i.test(injected.stdout) && !/PWNED/.test(injected.stdout),
      `status=${injected.status} out=${(injected.stdout || '').slice(0, 300)}`);

    // Shell metacharacter laundering: `node -e "process.exit(1)" & echo
    // harmless` — under a shell the exit code would be echo's 0 and the
    // lesson would launder a failing probe into re-verified. Without a
    // shell, node exits 1 and `echo harmless` is an inert argv element.
    writeFileSync(fixture, [
      'Lesson: root_cause = metacharacter lesson | correction = shell chaining attempt [2026-09-01]',
      'Probe: node -e "process.exit(1)" & echo harmless',
    ].join('\n'));
    const chained = spawnSync(process.execPath,
      [join(HERE, 'stale-probe.mjs'), '--file', fixture, '--now', '2026-10-13', '--allow-exec'],
      { encoding: 'utf8', timeout: 60000 });
    check('G8 shell metacharacters cannot launder a failing probe (no shell, argv only)',
      chained.status === 1 && /dead/i.test(chained.stdout) && !/harmless/.test(chained.stdout),
      `status=${chained.status} out=${(chained.stdout || '').slice(0, 300)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- H. The real tier parses (wiring proof against .trust/lessons.md) ----
{
  const { readFileSync, existsSync } = await import('node:fs');
  const real = join(HERE, '..', '.trust', 'lessons.md');
  if (existsSync(real)) {
    const lessons = parseLessons(readFileSync(real, 'utf8'));
    check('H1 the project tier parses with no crash', lessons.length > 0, String(lessons.length));
    check('H2 every parsed lesson has a verdict path (date or null, probe or null)',
      lessons.every((l) => (l.date === null || /^\d{4}-\d{2}-\d{2}$/.test(l.date)) && (l.probe === null || typeof l.probe === 'string')));
  } else {
    check('H1 the project tier parses with no crash', true, 'no .trust/lessons.md (adopter-fresh) — skipped');
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `FAIL: ${failures} expectation(s) broken.`}`);
process.exit(failures === 0 ? 0 : 1);
