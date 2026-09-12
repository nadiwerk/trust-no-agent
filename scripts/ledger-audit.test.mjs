#!/usr/bin/env node
/**
 * Fail-first test for scripts/ledger-audit.mjs — the Loaded:-gap / visual-gate /
 * context-confirmation audit of the private ledger (.trust/progress.txt).
 * Zero dependencies. Run: node scripts/ledger-audit.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = audit behavior drift.
 *
 * Seam: auditLedger({ ledgerText, today }) — a pure function; the doctor wraps
 * it with output, this test exercises the decision logic with deterministic
 * fixtures. Fixtures are hand-written literals (independent source of truth),
 * never copied from implementation output.
 */
import { auditLedger } from './ledger-audit.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const TODAY = new Date('2026-09-09T00:00:00Z');

// Entry template mirroring the writer contract (spec D1): a date header, then
// an entry heading, then the per-entry lines the audit reads. NOTE: this is
// the TARGET format — ticket 01 brings ship-log in line with it. Deriving the
// fixture from the spec's intent (not from today's writer output) is the point:
// the previous version of this comment claimed the repo already wrote a date
// header, and that false premise is how the blindness shipped.
const entry = (lines) => `## 2026-09-08\n\n### Session Summary - unit\n${lines}\n`;

// An entry heading with NO preceding date header — the blindness case.
const undatedEntry = (lines) => `### Session Summary - unit\n${lines}\n`;

// ---- A. Loaded: gap (M1) — a domain-relevant entry without a Loaded: line ----

// A1. Bug-domain entry, no Loaded: line → flagged as loaded-gap
{
  const res = auditLedger({
    ledgerText: entry('- Root cause found: selector leaked to sibling blocks\n- Committed 91f8ce6, fixed'),
    today: TODAY,
  });
  check('A1 entry in bug/test domain without Loaded: is flagged',
    res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res.findings));
}

// A2. Same entry WITH a Loaded: line → not flagged
{
  const res = auditLedger({
    ledgerText: entry('- Root cause found: selector leaked to sibling blocks\n- Loaded: root-cause (phase 1 complete)'),
    today: TODAY,
  });
  check('A2 entry with Loaded: line is clean',
    !res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res.findings));
}

// A3. MANDATORY trigger words ("done"/"commit" claim domain) also demand Loaded:
{
  const res = auditLedger({
    ledgerText: entry('- Committed 72c9af2, pushed, deploy verified'),
    today: TODAY,
  });
  check('A3 commit/done-claim entry without Loaded: is flagged',
    res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res.findings));
}

// A4. Off-domain entry (no domain keywords) → never flagged
{
  const res = auditLedger({
    ledgerText: entry('- Read the design doc and summarized it'),
    today: TODAY,
  });
  check('A4 off-domain entry is not flagged',
    !res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res.findings));
}

// A5. Literal-marker discipline: the domain match uses literal phrases, not a
// loose regex — a cousin phrase must NOT trip the gap flag.
{
  const res = auditLedger({
    ledgerText: entry('- Notes from reading about debugging history in science'),
    today: TODAY,
  });
  check('A5 cousin phrase does not trip the loaded-gap flag',
    !res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res.findings));
}

// ---- B. Visual-gate (M2) — site/ visual fix without a rendered-evidence line ----

// B1. site/ fix entry without a rendered-evidence marker → flagged
{
  const res = auditLedger({
    ledgerText: entry('- Modified site/index.html: fixed gap in .laws block\n- Committed 356c870'),
    today: TODAY,
  });
  check('B1 site fix without rendered evidence is flagged',
    res.findings.some((f) => f.kind === 'visual-gate'),
    JSON.stringify(res.findings));
}

// B2. site/ fix WITH rendered evidence (screenshot/browser) → not flagged
{
  const res = auditLedger({
    ledgerText: entry('- Modified site/index.html: fixed gap\n- Rendered evidence: desktop screenshot 1440px attached, verified in browser'),
    today: TODAY,
  });
  check('B2 site fix with rendered evidence is clean',
    !res.findings.some((f) => f.kind === 'visual-gate'),
    JSON.stringify(res.findings));
}

// ---- C. Context confirmation (M3) — visual feedback fix without restatement ----

// C1. Visual-feedback entry (screenshot/diagram/source imagery) without a
// context confirmation → flagged.
{
  const res = auditLedger({
    ledgerText: entry('- Owner screenshot showed the collision; fixed the chain list'),
    today: TODAY,
  });
  check('C1 visual-feedback fix without context confirmation is flagged',
    res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// C2. With a restatement line → not flagged
{
  const res = auditLedger({
    ledgerText: entry('- Owner screenshot showed the collision\n- Context confirmed: desktop 1440px, chain block 01-06, symptom = number/text overlap'),
    today: TODAY,
  });
  check('C2 restated context line is clean',
    !res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// C3. The restatement must be literal ("Context confirmed:") — a sentence
// merely containing the word "context" does not satisfy the gate.
{
  const res = auditLedger({
    ledgerText: entry('- Owner screenshot showed the collision\n- The context of the fix was clear from the CSS'),
    today: TODAY,
  });
  check('C3 prose containing "context" alone does not satisfy confirmation',
    res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// ---- D. Degrade gracefully ----

// D1. Empty ledger → ok, no findings
{
  const res = auditLedger({ ledgerText: '', today: TODAY });
  check('D1 empty ledger produces no findings', res.findings.length === 0, JSON.stringify(res));
}

// D2. No parseable date headers → findings suppressed (degrade, never
// hard-fail on unprovable data — same doctrine as corrective-tier checkStarve)
{
  const res = auditLedger({ ledgerText: '# progress.txt\nno date headers here\n', today: TODAY });
  check('D2 undated ledger degrades to no findings', res.findings.length === 0, JSON.stringify(res));
}

// D3. Entries older than the recency window (default 14 days) are out of scope
{
  const old = `## 2026-08-01\n\n### Session Summary - unit\n- Root cause of the old bug: it was stale\n- Committed abc1234\n`;
  const res = auditLedger({ ledgerText: old, today: TODAY });
  check('D3 entry older than the window is not audited',
    !res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res));
}

// ---- E. Stats (M4) — per-skill Loaded: counts surface the 47-vs-0 blind spot ----

// E1. Stats count Loaded: lines per skill name across the whole ledger
// (stats are ledger-wide, not windowed — the point is the historical ratio).
{
  const ledger = [
    '## 2026-09-01', '', '### S', '- Loaded: receipts', '- Committed a', '',
    '## 2026-09-02', '', '### S', '- Loaded: receipts', '- Committed b', '',
    '## 2026-09-03', '', '### S', '- Loaded: root-cause (phase 1)', '- Fixed c', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('E1 stats count per skill',
    res.stats.loadedCounts['receipts'] === 2 && res.stats.loadedCounts['root-cause'] === 1,
    JSON.stringify(res.stats));
}

// E2. Expected values from intent, not observed code: the 2026-09-09 evaluation
// found 47 receipts / 0 root-cause / 0 expect-fail. The zero-gap signal is the
// contract: a MANDATORY skill with zero mentions in a ledger that has work in
// its domain is exactly the blind spot this stat exists to surface.
{
  const ledger = [
    '## 2026-09-01', '', '### S', '- Loaded: receipts', '- Committed a', '',
    '## 2026-09-02', '', '### S', '- Root cause: x', '- Committed b', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('E2 stats expose a zero-mention MANDATORY skill',
    res.stats.loadedCounts['root-cause'] === undefined &&
      res.stats.mandatoryMentions.some((m) => m.skill === 'root-cause' && m.count === 0),
    JSON.stringify(res.stats));
  check('E3 receipts has nonzero count in mandatoryMentions',
    res.stats.mandatoryMentions.find((m) => m.skill === 'receipts').count === 1,
    JSON.stringify(res.stats.mandatoryMentions));
}

// ---- F. Churn (M5) — repeated reverts on one target = Law-1 failure signal ----

// F1. Two reverts mentioning the same block/feature within the window → churn finding
{
  const ledger = [
    '## 2026-09-07', '', '### S', '- Reverted the chain list spacing change', '',
    '## 2026-09-08', '', '### S', '- Reverted the chain list flex treatment', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('F1 two reverts on one target are flagged as churn',
    res.findings.some((f) => f.kind === 'churn' && /chain list/i.test(f.message)),
    JSON.stringify(res.findings));
}

// F2. A single revert is normal maintenance, not churn
{
  const ledger = '## 2026-09-08\n\n### S\n- Reverted the chain list spacing change\n';
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('F2 single revert is not churn',
    !res.findings.some((f) => f.kind === 'churn'),
    JSON.stringify(res.findings));
}

// F3. Two reverts on DIFFERENT targets are independent events, not churn
{
  const ledger = [
    '## 2026-09-07', '', '### S', '- Reverted the chain list spacing change', '',
    '## 2026-09-08', '', '### S', '- Reverted the laws block padding', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('F3 reverts on different targets are not churn',
    !res.findings.some((f) => f.kind === 'churn'),
    JSON.stringify(res.findings));
}

// F4. "Revert" appearing only in a section TITLE (### Session Summary) is
// history shorthand, not revert evidence — the false positive doctor's live
// run exposed on the real ledger ("4 reverts on session summary").
{
  const ledger = [
    '## 2026-09-07', '', '### Session Summary - laws spacing reverted per owner feedback', '- Owner verdict: spacing too wide, reverted items to original rhythm', '',
    '## 2026-09-08', '', '### Session Summary - README trio sections reverted after review', '- Committed 24e30dd after Master feedback', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('F4 title-only revert mentions are not churn evidence',
    !res.findings.some((f) => f.kind === 'churn'),
    JSON.stringify(res.findings));
}

// ---- G. Coverage gaps — an undated entry is reported, never silently dropped ----
// Spec AC3–AC6. The blindness this fixes: auditLedger split on `## DATE`, so an
// entry with no date header contributed nothing (not a finding, not a signal) —
// zero findings and a clean ledger looked identical. A gap is a distinct output
// (spec D7), never mixed into findings.

// G1. AC3 (RED baseline) — an undated entry yields exactly one coverage gap and
// zero M1–M5 findings. Before this fix the same input returned no findings and
// no `gaps` field at all: the gate was blind, not clean.
{
  const res = auditLedger({
    ledgerText: undatedEntry('- Root cause found: selector leaked\n- Committed 91f8ce6'),
    today: TODAY,
  });
  check('G1 undated entry produces exactly one coverage gap',
    Array.isArray(res.gaps) && res.gaps.length === 1,
    JSON.stringify(res.gaps));
  check('G1 gap has the declared shape (date null, kind coverage-gap)',
    Array.isArray(res.gaps) && res.gaps[0]?.date === null && res.gaps[0]?.kind === 'coverage-gap',
    JSON.stringify(res.gaps));
  check('G1 gap is not mixed into findings',
    !res.findings.some((f) => f.kind === 'coverage-gap'),
    JSON.stringify(res.findings));
  // AC3's other half: the undated entry must not fall through to the M1–M5
  // checks either — the fixture is deliberately domain-relevant, so a regression
  // that audited it would surface here as a loaded-gap.
  check('G1 undated entry produces zero M1–M5 findings',
    res.findings.length === 0,
    JSON.stringify(res.findings));
}

// G2. AC4 — an undated first entry followed by a dated in-window entry with a
// domain marker is NOT dropped: the gap is reported AND the later entry's
// finding still fires (leading undated text must not shadow the rest).
{
  const ledger = [
    '### Session Summary - old undated unit', '- Committed deadbee', '',
    '## 2026-09-08', '', '### Session Summary - dated unit', '- Root cause found: selector leaked', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('G2 undated entry reports a gap while the dated entry still audits',
    res.gaps.length === 1 && res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify({ gaps: res.gaps, findings: res.findings }));
}

// G3. AC5 — `### Self-Review (4 Dimensions)` is a sub-section of its parent
// entry, not a second entry: a dated entry with a Self-Review section yields no
// gap and no spurious entry.
{
  const ledger = [
    '## 2026-09-08', '', '### Session Summary - unit', '- Loaded: receipts', '- Committed abc1234', '',
    '### Self-Review (4 Dimensions)', '- [x] **Readability**: clear', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('G3 Self-Review section creates no gap and no extra entry',
    res.gaps.length === 0,
    JSON.stringify(res.gaps));
}

// G4. AC6 — the coverage gap is age-independent (an undated entry is undated
// however old the document), while a DATED entry older than the recency window
// produces neither a finding nor a gap (it is out of scope, not unprovable).
{
  const undated = auditLedger({ ledgerText: undatedEntry('- Root cause of the ancient bug'), today: TODAY });
  check('G4 undated entry gaps regardless of age',
    undated.gaps.length === 1 && !undated.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify({ gaps: undated.gaps, findings: undated.findings }));

  const oldDated = '## 2026-08-01\n\n### Session Summary - unit\n- Root cause of the old bug: it was stale\n- Committed abc1234\n';
  const res = auditLedger({ ledgerText: oldDated, today: TODAY });
  check('G4 dated entry outside the window yields neither finding nor gap',
    res.gaps.length === 0 && !res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify({ gaps: res.gaps, findings: res.findings }));
}

// G5. Multiple undated entries each get their own gap — the count is the
// coverage signal the doctor prints, so it must not collapse to a boolean.
{
  const ledger = [
    '### Session Summary - one', '- did a thing', '',
    '### Session Summary - two', '- did another thing', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('G5 each undated entry yields its own gap',
    res.gaps.length === 2,
    JSON.stringify(res.gaps));
}

// G6. Refined D4 (Ruling, 2026-09-12): entry identity is ANY `###` heading
// except the writer contract's known sub-sections — not just `### Session
// Summary`. The old E/F fixtures use `### S` as the entry heading, and the
// writer contract (ship-log Log Format) defines exactly two sub-sections
// (Self-Review, Archive); anything else `###` is an entry heading by contract.
// A sub-heading inside a DATED entry therefore starts a second entry carrying
// the SAME date — no gap, bodies split. Locked here so the rule is specified,
// not accidental.
{
  const ledger = [
    '## 2026-09-08', '', '### Session Summary - unit', '- Loaded: receipts', '- Committed abc1234', '',
    '### Evidence', '- rendered browser snapshot at 1440px', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: TODAY });
  check('G6 a non-subsection ### heading starts a same-date second entry (no gap)',
    res.gaps.length === 0,
    JSON.stringify(res.gaps));
  check('G6 the parent entry still audits clean (Loaded: present)',
    !res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res.findings));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broke.` : '\nAll expectations hold.');
process.exit(failures ? 1 : 0);
