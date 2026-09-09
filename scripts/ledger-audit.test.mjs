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

// Entry template matching the ship-log format the repo actually writes:
// a date header, then sections, then the per-entry lines the audit reads.
const entry = (lines) => `## 2026-09-08\n\n### Session Summary - unit\n${lines}\n`;

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

console.log(failures ? `\nFAIL: ${failures} expectation(s) broke.` : '\nAll expectations hold.');
process.exit(failures ? 1 : 0);
