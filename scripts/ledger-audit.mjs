/**
 * Ledger audit — Loaded:-gap, visual-gate, and context-confirmation checks for
 * the private ledger (.trust/progress.txt). Pure Node, zero dependencies.
 * Extracted into its own module so the fail-first test
 * (ledger-audit.test.mjs) can import it without running doctor's CLI.
 *
 * Contract (user-approved 2026-09-09, high-priority development items 1–3):
 * the `Loaded:` audit-trail rule (AGENTS.md §2) and the wrong-target rule
 * (AGENTS.md §6) are proven to fail silently — session 2026-09-09 found
 * 47 `Loaded: receipts` entries, 0 for root-cause/expect-fail despite
 * domain-relevant work, and site receipts verified CSS strings while the user
 * read the rendered page. A rule that relies on runtime initiative fails
 * silently; written artifacts work. So the ledger itself is audited:
 *
 *  M1 loaded-gap — a dated entry whose text touches a MANDATORY skill's
 *     domain (bug/test/done-claim triggers) without any `Loaded: <skill>` line.
 *  M2 visual-gate — a dated entry touching site/ without a rendered-evidence
 *     line (screenshot/browser/rendered): rendered-output claims need
 *     rendered-output evidence, not a string match on the deployed source.
 *  M3 context-gap — a dated entry fixing owner-supplied visual feedback
 *     (screenshot/mockup/reference) without a literal `Context confirmed:`
 *     restatement line (Iron Law 1: shared understanding before action).
 *
 * Grace/recency window and degrade doctrine mirror corrective-tier.mjs:
 * findings only from the last 14 days of `## YYYY-MM-DD` headers, and an
 * undated ledger degrades to no findings — never hard-fail on unprovable data.
 */

export const RECENCY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// Literal markers (evals lesson: loose regex matched a cousin phrase and the
// RED test stayed green — checks use literal phrases, not loose patterns).
// Literal phrases that place an entry in a MANDATORY skill's domain.
const DOMAIN_MARKERS = [
  // receipts / done-claim domain
  'Committed ', 'committed ', 'pushed ', 'shipped ', 'deploy verified',
  // root-cause domain
  'root cause', 'Root cause', 'diagnos', 'test failure', 'failing test',
  // expect-fail domain
  'test-first', 'failing test', 'new test',
];

// Literal phrases that make an entry a site/ visual change.
const VISUAL_FIX_MARKER = 'site/';

// Literal phrases proving rendered-output evidence (not a CSS/source check).
const RENDERED_EVIDENCE = ['Rendered evidence:', 'screenshot', 'browser', 'rendered'];

// Literal phrases that make an entry a fix driven by owner visual feedback.
const VISUAL_FEEDBACK = ['screenshot', 'Owner said', 'owner confirmed', 'mockup', 'diagram'];

// The literal restatement line that satisfies the confirmation gate.
const CONTEXT_CONFIRMED = 'Context confirmed:';

// Any `Loaded: <name>` line counts; the audit only checks presence, because
// choosing the right skill is judgment (the audit is the boundary, not the judge).
const LOADED_LINE = /^- Loaded: \S/m;

/**
 * @param {object} input
 * @param {string} input.ledgerText full text of .trust/progress.txt
 * @param {Date} input.today reference "now" (injected for determinism)
 * @param {number} [input.recencyDays] audit window in days (default 14)
 * @returns {{findings: Array<{date: string, kind: string, message: string}>}}
 */
export function auditLedger({ ledgerText, today, recencyDays = RECENCY_DAYS }) {
  const findings = [];
  if (!ledgerText.trim()) return { findings };

  // Split into `## YYYY-MM-DD` dated sections; undated text is ignored
  // (degrade, never hard-fail on unprovable data).
  const sections = ledgerText.split(/^## /m).slice(1);
  const windowStart = today.getTime() - recencyDays * DAY_MS;

  for (const section of sections) {
    const nl = section.indexOf('\n');
    const date = section.slice(0, nl).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const start = new Date(`${date}T00:00:00Z`);
    const age = (today.getTime() - start.getTime()) / DAY_MS;
    if (!Number.isFinite(age) || age > recencyDays || start.getTime() < windowStart) continue;

    const body = section.slice(nl);

    // M1 — domain-relevant entry without a Loaded: line
    const inDomain = DOMAIN_MARKERS.some((m) => body.includes(m));
    if (inDomain && !LOADED_LINE.test(body))
      findings.push({
        date,
        kind: 'loaded-gap',
        message: `entry ${date} touches a MANDATORY skill's domain (bug/test/done-claim triggers) but carries no "- Loaded: <skill>" line — either the skill was not loaded (discipline silently dropped) or the audit trail is incomplete; fix the gap, per AGENTS.md §2`,
      });

    // M2 — site/ visual change without rendered-output evidence
    const siteFix = body.includes(VISUAL_FIX_MARKER);
    const hasRendered = RENDERED_EVIDENCE.some((m) => body.toLowerCase().includes(m.toLowerCase()));
    if (siteFix && !hasRendered)
      findings.push({
        date,
        kind: 'visual-gate',
        message: `entry ${date} touches site/ without rendered-output evidence (screenshot/browser/rendered) — verify the artifact the user reads: a live check of the rendered page, not a string match on the deployed source (AGENTS.md §6)`,
      });

    // M3 — owner visual feedback fixed without a context confirmation
    const ownerFeedback = VISUAL_FEEDBACK.some((m) => body.toLowerCase().includes(m.toLowerCase()));
    if (ownerFeedback && !body.includes(CONTEXT_CONFIRMED))
      findings.push({
        date,
        kind: 'context-gap',
        message: `entry ${date} fixes owner-supplied visual feedback without a "Context confirmed:" restatement line — Iron Law 1: confirm shared understanding (desktop/mobile, which block, what symptom) before the fix, not after a revert (AGENTS.md §6)`,
      });
  }

  return { findings };
}
