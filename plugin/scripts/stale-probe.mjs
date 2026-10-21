#!/usr/bin/env node
/**
 * Stale-memory probe — re-verify old lessons against CURRENT behavior
 * (findings-adaptation ticket 04, AC6; spec US6; corpus D11 "stale-memory test:
 * read 3-week note → same answer").
 *
 * Run:  node scripts/stale-probe.mjs [--file <lessons.md>] [--now YYYY-MM-DD] [--allow-exec]
 * Exit 0 = no lesson is dead. Exit 1 = at least one lesson's probe
 * CONTRADICTS it (current behavior disagrees) — dead memory found.
 *
 * Contract:
 *   A lesson line (`Lesson: root_cause = … | correction = … [YYYY-MM-DD]`)
 *   may be followed by `Probe: <exact command>` — the check that re-asserts
 *   the lesson against today's code. Classification, per lesson:
 *
 *     fresh        age < STALE_DAYS (21, D11's three-week note) — recency
 *                  carries it, no probe needed yet
 *     re-verified  stale, probe ran and exited 0 — same answer as when
 *                  recorded
 *     dead         stale, probe exited non-zero — current behavior
 *                  CONTRADICTS the lesson
 *     unverifiable stale with no probe, undated, OR probes not executed
 *                  this run — fail-closed: absence of proof is not proof
 *
 *   canGate(status) — the AC6 line: only `fresh` and `re-verified` may gate
 *   live work. `dead` cannot steer anything; `unverifiable` cannot either
 *   (ragu = blokir). The probe COMPUTES status at read time; it never
 *   rewrites lessons.md — deleting or correcting a dead lesson is a human
 *   act (Iron Law 4 territory), this tool only reports.
 *
 *   Execution is opt-in (roast 2026-10-13 security fix): `Probe:` lines are
 *   agent-authored text, and executing agent-authored commands is an
 *   irreversible action class — the JEV / Iron-Law-4 rule this repo applies
 *   everywhere else. The DEFAULT run parses and reports only; a stale probed
 *   lesson then classifies `unverifiable` (cannot gate — ragu = blokir) with
 *   a hint to re-run with `--allow-exec`, the human's per-invocation sign-off.
 *   Even under `--allow-exec`, execution stays narrow: no shell (argv
 *   tokenization — `&`, `;`, `|`, `$()` are inert argv elements, never
 *   syntax) and an interpreter allowlist (node/npm/npx) — the blast radius
 *   of an agent-authored line stays a test command, not `rm -rf`.
 *   Honest limit: the 60s timeout kills the direct probe process; a probe
 *   that spawns its own background children could leave them behind — the
 *   probes this repo writes are test commands that exit on their own.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const STALE_DAYS = 21;
const DAY = 86400000;

/**
 * A `Lesson:` date is a CALENDAR DAY; `now` is a raw instant. Subtracting a
 * UTC-midnight parse from an instant shifts the window's edge by the host's
 * UTC offset, so a lesson exactly at the window's edge reads fresh east of UTC
 * (day 21 computed as 20) and stale west of it (day 20 computed as 21). Same
 * root cause as the receipt staleness seam: both sides must live in one frame.
 * Measured 2026-10-22 on a UTC+7 host.
 */
const localDayOf = (instant) => {
  const d = new Date(instant);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** Days between a `YYYY-MM-DD` date and an instant, measured in local days. */
const ageInDays = (date, now) => {
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const claim = new Date(y, m - 1, d);
  if (claim.getFullYear() !== y || claim.getMonth() !== m - 1 || claim.getDate() !== d) return NaN;
  return Math.round((localDayOf(now) - claim.getTime()) / DAY);
};

/**
 * Parse a lessons file into { rootCause, correction, date, probe } entries.
 * A `Probe:` line binds to the LESSON ABOVE IT (prose follows its subject).
 */
export function parseLessons(text) {
  const lessons = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('Lesson:')) {
      const body = line.slice('Lesson:'.length);
      const rc = /root_cause\s*=\s*(.*?)\s*\|\s*correction\s*=\s*(.*)$/.exec(body);
      const date = /\[(\d{4}-\d{2}-\d{2})\]/.exec(body);
      lessons.push({
        rootCause: rc ? rc[1] : body.trim(),
        correction: rc ? rc[2].replace(/\s*\[[\d-]+\]\s*$/, '') : '',
        date: date ? date[1] : null,
        probe: null,
      });
    } else if (line.startsWith('Probe:') && lessons.length) {
      lessons[lessons.length - 1].probe = line.slice('Probe:'.length).trim() || null;
    }
  }
  return lessons;
}

/**
 * Classify one lesson against `now`. `runCmd(cmd) -> exitCode` is injected
 * so tests never execute real commands; the CLI injects a shell spawn.
 * Pure in shape: undated lessons NEVER probe (a probe cannot fix a missing
 * age) and NEVER come back fresh.
 */
export function classify(lesson, now, runCmd) {
  if (!lesson.date) return 'unverifiable';
  const age = ageInDays(lesson.date, now);
  if (Number.isNaN(age)) return 'unverifiable';
  if (age < STALE_DAYS) return 'fresh';
  if (!lesson.probe) return 'unverifiable';
  if (!runCmd) return 'unverifiable'; // execution not requested this run — fail-closed, never silently dead
  try {
    return runCmd(lesson.probe) === 0 ? 're-verified' : 'dead';
  } catch {
    return 'dead'; // the probe could not even run against today's tree
  }
}

/** The AC6 line: which statuses may gate live work. */
export function canGate(status) {
  return status === 'fresh' || status === 're-verified';
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const argOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const allowExec = args.includes('--allow-exec');
  const nowArg = argOf('--now');
  // `--now <date>` names a CALENDAR DAY. Parsing it as a UTC instant makes it
  // name the previous local day west of UTC, so a lesson on the window's edge
  // reads one day younger and comes back `fresh` — the status that keeps its
  // power to gate live work. Noon is used so the instant lands inside the named
  // local day under any offset (|offset| < 12h).
  const parseDay = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  };
  const now = nowArg ? parseDay(nowArg) : new Date();
  if (!now) {
    console.error('FAIL: --now must be YYYY-MM-DD');
    process.exit(1);
  }
  // Default lessons file lives in the GRADED project: the working directory,
  // never this script's own install dir. The plugin payload ships this file;
  // deriving the tree from import.meta.url would probe the plugin copy's
  // (nonexistent) lessons while reporting OK over the adopter's real tier —
  // the wrong-tree green receipt class (ticket F2).
  const file = argOf('--file') || join(process.cwd(), '.trust', 'lessons.md');
  if (!existsSync(file)) {
    if (argOf('--file')) {
      console.error(`FAIL: lessons file not found: ${file}`);
      process.exit(1);
    }
    console.log(`no lessons tier at ${file} — nothing to probe.`);
    process.exit(0);
  }
  const lessons = parseLessons(readFileSync(file, 'utf8'));
  if (!lessons.length) {
    console.log('lessons tier is empty — nothing to probe.');
    process.exit(0);
  }
  // Probe execution is opt-in: without --allow-exec, runCmd is null and
  // classify fails closed to unverifiable (probes not run cannot verify).
  // With it, the human signs off per invocation — and even then: no shell
  // (argv tokenization makes metacharacters inert) and an interpreter
  // allowlist (node/npm/npx) — an agent-authored line stays a test command.
  const ALLOWED = /^(node|npm|npx)(\.exe|\.cmd|\.bat)?$/i;
  const tokenize = (cmd) => {
    const out = [];
    let cur = '', q = null;
    for (const ch of String(cmd)) {
      if (q) { if (ch === q) q = null; else cur += ch; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  const runCmd = allowExec ? (cmd) => {
    const argv = tokenize(cmd);
    if (!argv.length || !ALLOWED.test(argv[0]))
      throw new Error(`probe interpreter not allowed (node/npm/npx only): ${argv[0] || '(empty)'}`);
    const res = spawnSync(argv[0], argv.slice(1), { shell: false, encoding: 'utf8', timeout: 60000 });
    return res.status === 0 ? 0 : 1;
  } : null;
  const counts = { fresh: 0, 're-verified': 0, dead: 0, unverifiable: 0 };
  let deadFound = 0;
  let staleProbed = 0;
  // The header names the day the verdicts were computed against, so it renders
  // from the SAME local frame. `now` is a local-noon instant: west of UTC it is
  // still the previous day in UTC, and toISOString() would print a day the
  // classifications never saw.
  const asOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  console.log(`Stale-memory probe (window ${STALE_DAYS} days, as of ${asOf}${allowExec ? ', probes executed' : ', probes NOT executed'}):`);
  for (const l of lessons) {
    const status = classify(l, now, runCmd);
    counts[status]++;
    if (status === 'dead') deadFound++;
    if (status === 'unverifiable' && l.probe) staleProbed++;
    const gate = canGate(status) ? 'may gate' : 'CANNOT gate';
    console.log(`  ${status.padEnd(13)} | ${gate} | ${l.rootCause}`);
  }
  console.log(`summary: fresh=${counts.fresh} re-verified=${counts['re-verified']} dead=${counts.dead} unverifiable=${counts.unverifiable}`);
  if (!allowExec && staleProbed)
    console.log(`note: ${staleProbed} stale lesson(s) carry probes that were NOT run — re-run with --allow-exec to execute them (default is read-only, fail-closed).`);
  if (deadFound) {
    console.log(`${deadFound} dead lesson(s) — their probe contradicts current behavior; they cannot gate live work. Correct or delete them (human act, Iron Law 4).`);
    process.exit(1);
  }
  process.exit(0);
}
