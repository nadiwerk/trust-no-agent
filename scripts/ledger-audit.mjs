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
const LOADED_LINE = /^- Loaded: (\S+)/m;

// Churn doctrine (development item #6): 3 reverts on one block in the
// green-border saga = Iron Law 1 failing repeatedly without a signal. Two
// reverts naming the same target within the window is the earliest mechanical
// trace of that pattern; the finding tells the next session to stop fixing
// and confirm context instead. Single reverts are normal maintenance.
const REVERT_LINE = /revert/i;
const REVERT_STOPWORDS = ['commit', 'change', 'treatment', 'approach'];
const CHURN_THRESHOLD = 2;

/**
 * @param {object} input
 * @param {string} input.ledgerText full text of .trust/progress.txt
 * @param {Date} input.today reference "now" (injected for determinism)
 * @param {number} [input.recencyDays] audit window in days (default 14)
 * @returns {{findings: Array<{date: string, kind: string, message: string}>}}
 */
export function auditLedger({ ledgerText, today, recencyDays = RECENCY_DAYS }) {
  const findings = [];
  if (!ledgerText.trim()) return { findings, stats: emptyStats() };

  // Split into `## YYYY-MM-DD` dated sections; undated text is ignored
  // (degrade, never hard-fail on unprovable data).
  const sections = ledgerText.split(/^## /m).slice(1);
  const windowStart = today.getTime() - recencyDays * DAY_MS;

  // M4 — per-skill Loaded: counts, ledger-wide (not windowed): the historical
  // ratio IS the signal. A MANDATORY skill with zero Loaded: lines while the
  // ledger contains its domain markers is the 47-vs-0 blind spot made visible.
  const loadedCounts = {};
  const domainHits = {};
  const revertTargets = {}; // normalized target -> { count, label }

  for (const section of sections) {
    const nl = section.indexOf('\n');
    const date = section.slice(0, nl).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const start = new Date(`${date}T00:00:00Z`);
    const age = (today.getTime() - start.getTime()) / DAY_MS;
    if (!Number.isFinite(age) || age > recencyDays || start.getTime() < windowStart) continue;

    const body = section.slice(nl);

    for (const m of body.matchAll(/^- Loaded: (\S+)/gm)) {
      const skill = m[1].replace(/[^a-z-]/gi, '');
      if (skill) loadedCounts[skill] = (loadedCounts[skill] || 0) + 1;
    }
    for (const marker of DOMAIN_MARKERS) {
      if (body.includes(marker)) domainHits[marker] = (domainHits[marker] || 0) + 1;
    }

    // M5 — churn: collect revert targets within the window. Bullets only:
    // `### Session Summary - <title>` lines may contain "revert" as history
    // shorthand while the revert evidence itself lives in the entry's bullets.
    for (const line of body.split('\n')) {
      if (!line.startsWith('- ') || !REVERT_LINE.test(line)) continue;
      const target = normalizeRevertTarget(line);
      if (!target) continue;
      if (!revertTargets[target]) revertTargets[target] = { count: 0, label: target };
      revertTargets[target].count++;
    }

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

  // M5 — churn findings: 2+ reverts naming the same target in the window
  for (const { count, label } of Object.values(revertTargets)) {
    if (count >= CHURN_THRESHOLD)
      findings.push({
        date: 'window',
        kind: 'churn',
        message: `${count} reverts on "${label}" within the ${recencyDays}-day window — repeated fix-revert cycles on one target are the Iron Law 1 failure signature (guessing context instead of confirming it); STOP fixing and confirm the context with the owner first (AGENTS.md §6)`,
      });
  }

  // M4 — mandatoryMentions: per-MANDATORY-skill Loaded: count (0 = blind spot
  // when domain hits exist). Domain hits are counted on marker presence per
  // entry; a marker appearing at all means the domain was touched ledger-wide.
  const mandatoryMentions = MANDATORY_SKILLS.map((skill) => ({
    skill,
    count: loadedCounts[skill] || 0,
    domainTouched: DOMAIN_MARKERS.some((m) => (domainHits[m] || 0) > 0),
  }));

  return { findings, stats: { loadedCounts, mandatoryMentions } };
}

// MANDATORY skills per the router (kept in sync with eval.mjs check 6).
const MANDATORY_SKILLS = ['expect-fail', 'root-cause', 'receipts'];

const emptyStats = () => ({ loadedCounts: {}, mandatoryMentions: MANDATORY_SKILLS.map((skill) => ({ skill, count: 0, domainTouched: false })) });

// Normalize a revert line into a comparable target: strip the boilerplate
// (revert/reverted/the/spacers, commit hashes) and keep the noun phrase, so
// "Reverted the chain list spacing" and "revert chain list flex" collide on
// "chain list". Stopword-only lines return '' (nothing comparable).
function normalizeRevertTarget(line) {
  const words = line
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,}\b/g, ' ') // commit hashes
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const content = words.filter(
    (w) => !REVERT_STOPWORDS.includes(w) && !['revert', 'reverted', 'reverts', 'the', 'a', 'of', 'on', 'to', 'and'].includes(w),
  );
  // Key on the noun-phrase head (first 2 content words): "chain list spacing"
  // and "chain list flex" are the SAME target wearing different symptoms —
  // keeping more words would hide exactly the collision churn detection
  // exists to find.
  return content.slice(0, 2).join(' ');
}
