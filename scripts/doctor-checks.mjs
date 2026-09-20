#!/usr/bin/env node
/**
 * Doctor decision logic, extracted so the fail-first test can import it
 * without running doctor's CLI side effects (same pattern as
 * corrective-tier.mjs, which holds C5/C6).
 *
 * Contract: these are the checks that decide whether an ADOPTER's installation
 * is healthy. Two of them were wrong in a way that only a real adopter could
 * reveal (2026-09-19 stress test against a 6-day, 71-commit project):
 *
 *  - C2 assumed the adopter sets `core.hooksPath` to the framework's own hooks
 *    dir. The documented install copies skills, not scripts — so the check
 *    FAILED on a correctly-installed project and taught the adopter to ignore
 *    doctor.
 *  - C7 hardcoded `.trust/progress.txt`; the adopter convention is
 *    `progress.txt` at the project root, so the audit never ran on the ledger
 *    it exists to check.
 *  - M4 (`mandatoryMentions`) was computed by auditLedger and consumed by
 *    nobody: the component built to expose the blind spot was itself dead.
 */

/**
 * C2 — are git hooks wired for this project's mode?
 *
 * repo mode: the project IS a trust-no-agent checkout, so the strict contract
 *   holds (hooksPath set, dir complete, matching the tracked copies).
 * adopter mode: the project copied skills only. The contract is weaker and
 *   honest about it — SOME hook must exist (any custom guard counts), and
 *   nothing here is an installation defect, so the level never reaches `fail`.
 *
 * @returns {{level: 'pass'|'warn'|'fail', message: string}}
 */
export function hookVerdict({ mode, hooksPath, hasPre, hasMsg, customHookExists }) {
  if (mode === 'repo') {
    if (!hooksPath)
      return { level: 'fail', message: 'core.hooksPath not set — enforcement inactive. Run: git config core.hooksPath scripts/hooks' };
    if (!hasPre || !hasMsg)
      return { level: 'fail', message: `hooks dir "${hooksPath}" lacks ${hasPre ? '' : 'pre-commit '}${hasMsg ? '' : 'commit-msg'}` };
    return { level: 'pass', message: `git hooks active (core.hooksPath=${hooksPath})` };
  }
  // adopter mode. A SET hooksPath is still a claim about enforcement, so it is
  // held to the same completeness bar — reporting PASS for a path pointing at an
  // empty dir is the false green this whole review pass exists to remove
  // (roast finding 2026-09-19).
  if (hooksPath) {
    if (hasPre || hasMsg) return { level: 'pass', message: `git hooks active (core.hooksPath=${hooksPath})` };
    return {
      level: 'warn',
      message: `core.hooksPath is set to "${hooksPath}" but that dir holds no pre-commit/commit-msg hook — the path claims enforcement it does not provide`,
    };
  }
  if (customHookExists) return { level: 'pass', message: 'project carries its own git hook(s)' };
  return {
    level: 'warn',
    message: 'no git hook found — nothing runs before a commit in this project; add one if you want the repo rules enforced mechanically (see docs/installation.md)',
  };
}

/**
 * C4 — which ledger does this project actually keep?
 * Upstream convention is `.trust/progress.txt` (private, gitignored); the
 * adopter router's convention is `progress.txt` at the root (tracked). Both are
 * legitimate writers; the audit must read whichever exists.
 *
 * When BOTH exist the choice is not neutral: a reader that silently prefers one
 * lets a second, emptier file shadow the real ledger and report "clean" — the
 * audited party selecting what the audit reads. `shadowed` is returned so the
 * caller can say so out loud (roast finding 2026-09-19).
 *
 * @returns {{path: string|null, shadowed: string|null}}
 */
export function pickLedgerPath({ hasTrustLedger, hasRootLedger }) {
  if (hasTrustLedger && hasRootLedger) return { path: '.trust/progress.txt', shadowed: 'progress.txt' };
  if (hasTrustLedger) return { path: '.trust/progress.txt', shadowed: null };
  if (hasRootLedger) return { path: 'progress.txt', shadowed: null };
  return { path: null, shadowed: null };
}

/**
 * C7b — M4 blind spot: a MANDATORY skill with ZERO `Loaded:` mentions while
 * entries in its domain were audited. This is the 47-receipts-vs-0 signal the
 * audit computes; surfacing it is what makes the audit's own finding real to a
 * reader instead of a number in a JSON blob nobody opens.
 *
 * `mandatoryMentions` carries domain hits ledger-wide, so this reports the
 * skills that are never named — it cannot claim a specific skill's domain went
 * untouched (the marker scan is shared across the three). The message says what
 * is actually known (roast finding 2026-09-19).
 *
 * @param {{mandatoryMentions?: Array<{skill: string, count: number, domainTouched: boolean}>}} input
 * @returns {string[]} one message per blind-spotted skill
 */
export function blindSpotWarning({ mandatoryMentions = [] } = {}) {
  return mandatoryMentions
    .filter((m) => m.count === 0 && m.domainTouched)
    .map(
      (m) =>
        `${m.skill} is never named in a "Loaded:" line in this ledger, while entries here do touch the MANDATORY-skill domains — either it never loads in this project, or the trail is unwritten; both are worth a look (AGENTS.md §2)`,
    );
}

/**
 * C8 — mandatory-gate: is the mechanical pre-gate classifier installed and
 * passing? (docs/specs/mandatory-gate.md, ticket 03.) The gate is the
 * mechanical boundary of MANDATORY skill routing (AGENTS.md §2); a broken or
 * missing gate means the boundary is prose-only again.
 *
 * Two strictness levels, the C2 lesson applied: repo mode (this IS a
 * trust-no-agent checkout) gets the strict contract — a missing or failing
 * gate is a FAIL-level installation defect. Adopter mode (skills copied,
 * scripts not) gets WARN — the gate is not part of the documented adopter
 * install, so its absence is not a defect, only a lost capability.
 *
 * @returns {{level: 'pass'|'warn'|'fail', message: string}}
 */
export function gateVerdict({ gateExists, gateSelfTestPasses, mode }) {
  if (!gateExists) {
    if (mode === 'repo')
      return { level: 'fail', message: 'mandatory-gate script missing — MANDATORY routing has no mechanical boundary. Restore scripts/mandatory-gate.mjs (spec: docs/specs/mandatory-gate.md)' };
    return { level: 'warn', message: 'mandatory-gate script not installed (adopter mode) — MANDATORY routing runs on the router prose and the ledger Loaded: trail alone' };
  }
  if (!gateSelfTestPasses)
    return { level: 'fail', message: 'mandatory-gate self-test fails — the classifier drifts from its keyword tables; run node scripts/mandatory-gate.test.mjs and reconcile before trusting the audit gate findings' };
  return { level: 'pass', message: 'mandatory-gate active — mechanical boundary check for MANDATORY skill routing (keyword signal, not proof)' };
}
