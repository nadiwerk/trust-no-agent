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
  const dates = [...ledgerText.matchAll(/^## (\d{4}-\d{2}-\d{2})\s*$/gm)].map((m) => m[1]);
  if (!dates.length) return { level: 'warn', message: STARVE_MESSAGE };
  const oldest = dates.reduce((a, b) => (a < b ? a : b));
  const start = new Date(`${oldest}T00:00:00Z`);
  const ageDays = Math.floor((today.getTime() - start.getTime()) / DAY_MS);
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
