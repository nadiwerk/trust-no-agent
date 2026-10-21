#!/usr/bin/env node
/**
 * Corrective-tier starvation check for scripts/doctor.mjs (check C5).
 * Pure Node, zero dependencies. Extracted into its own module so the
 * fail-first test (doctor.test.mjs) can import it without running doctor's
 * CLI side effects (doctor.mjs checks-and-exits at import time).
 *
 * Contract (user-approved 2026-09-06): a ledger with entries but no
 * .trust/lessons.md is a starving corrective tier. It WARNs during a
 * 14-day grace period measured from the OLDEST dated entry in the ledger
 * (`## YYYY-MM-DD` headers, as written by ship-log), then FAILS — after
 * grace, lesson capture is mandatory, not optional. A ledger with no
 * parseable dates degrades to WARN: never hard-fail on unprovable data.
 */
export const DEFAULT_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A ledger heading is a CALENDAR DAY; `today` is a raw instant. Subtracting a
 * UTC-midnight parse from an instant shifts the grace boundary by the host's
 * UTC offset — east of UTC the day count floors DOWN, so a ledger whose grace
 * is spent still reads "inside grace" and the corrective tier keeps starving
 * silently. Both sides live in one frame. Measured 2026-10-22 on a UTC+7 host.
 */
const localDayOf = (instant) => {
  const d = new Date(instant);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** Calendar days between a `YYYY-MM-DD` date and an instant, or NaN. */
const ageInDays = (date, now) => {
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const start = new Date(y, m - 1, d);
  if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) return NaN;
  return Math.round((localDayOf(now) - start.getTime()) / DAY_MS);
};
const STARVE_MESSAGE =
  '.trust/progress.txt has entries but .trust/lessons.md does not exist — the corrective tier is starving; record a lesson on every repair (receipts lesson capture / make-it-so repair loop)';

/**
 * @param {object} input
 * @param {string} input.ledgerText full text of .trust/progress.txt
 * @param {boolean} input.lessonsExists whether .trust/lessons.md exists
 * @param {Date} input.today reference "now" (injected for determinism)
 * @param {number} [input.graceDays] grace period in days (default 14)
 * @returns {{level: 'ok'|'warn'|'fail', message: string}}
 */
export function checkStarve({ ledgerText, lessonsExists, today, graceDays = DEFAULT_GRACE_DAYS }) {
  if (lessonsExists || !ledgerText.trim()) return { level: 'ok', message: '' };
  // Titled headers count too (`## 2026-09-19 — Rebrand X`): the adopter router
  // writes them, and a reader that only saw bare headers measured no dates on
  // a real adopter ledger — the grace clock never started and the check warned
  // forever instead of enforcing. CRLF-safe for the same reason.
  const dates = [...ledgerText.matchAll(/^##\s*(\d{4}-\d{2}-\d{2})\b/gm)].map((m) => m[1]);
  if (!dates.length) return { level: 'warn', message: STARVE_MESSAGE };
  const oldest = dates.reduce((a, b) => (a < b ? a : b));
  const ageDays = ageInDays(oldest, today);
  if (!Number.isFinite(ageDays)) return { level: 'warn', message: STARVE_MESSAGE };
  if (ageDays >= graceDays)
    return {
      level: 'fail',
      message: `${STARVE_MESSAGE} — grace period exhausted: ${ageDays} days since the oldest entry (${oldest}), grace is ${graceDays}; lesson capture is mandatory now`,
    };
  return { level: 'warn', message: STARVE_MESSAGE };
}

// ---- C6 update-check (doctor): stale-skills detection ----
// Compares the version stamped in the installed skills' package marker against
// the upstream version. Detection is mechanical; the UPDATE itself is a
// user decision (installation.md "Updating") — doctor only reports.
export function checkStale({ installedVersion, upstreamVersion }) {
  if (!upstreamVersion) return { level: 'unknown', message: '' };
  if (!installedVersion)
    return {
      level: 'unstamped',
      message: `install carries no version stamp — detection cannot tell stale from current. Stamp it now: mkdir -p .trust && printf '<upstream-version>' > .trust/tna-version (see docs/installation.md "Updating")`,
    };
  const cmp = compareSemver(installedVersion, upstreamVersion);
  if (cmp < 0)
    return {
      level: 'stale',
      message: `installed skills v${installedVersion} < upstream v${upstreamVersion} — update available: re-run the install, see docs/installation.md "Updating"`,
    };
  return { level: 'current', message: '' };
}

function compareSemver(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
