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

// ---- H. Reader core — both writer shapes (ticket 01, spec §AC1–AC5) ----
// The reader assumed ONE writer shape: a bare `## YYYY-MM-DD` header, a
// `### Session Summary` heading, and `- Loaded: a; b` bullets. A second writer
// is in production — the adopter router's format: a TITLED header
// (`## YYYY-MM-DD — <title>`), flat bullets with no `###` heading, and
// `- Loaded: a, b, c` comma lists. Where the two differed the reader did not
// degrade; it emitted confident false signals (127 phantom coverage gaps and
// 60 context-gaps on a real 6-day adopter ledger). Fixtures below are the two
// shapes as actually written by their respective writers.

// H1 (AC1). Titled date header, in-window → the entry is dated and audited.
{
  const res = auditLedger({
    ledgerText: '## 2026-09-08 — Rebrand X\n\n### Session Summary - unit\n- Committed abc1234\n',
    today: TODAY,
  });
  check('H1 titled date header dates its entry (audited, no gap)',
    res.gaps.length === 0 && res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify({ gaps: res.gaps, findings: res.findings }));
}

// H2 (AC1). Titled header outside the recency window → out of scope, not a gap.
{
  const res = auditLedger({
    ledgerText: '## 2026-08-01 — Old rebrand\n\n### Session Summary - unit\n- Committed abc1234\n',
    today: TODAY,
  });
  check('H2 titled old header is out of scope (no gap, no finding)',
    res.gaps.length === 0 && res.findings.length === 0,
    JSON.stringify({ gaps: res.gaps, findings: res.findings }));
}

// H3 (AC1). CRLF must not defeat the header — adopter ledgers on Windows are
// CRLF. A bare CRLF header already parsed (`\s*` swallowed the `\r`); a titled
// one did not.
{
  const res = auditLedger({
    ledgerText: '## 2026-09-08 — Rebrand X\r\n\r\n### Session Summary - unit\r\n- Committed abc1234\r\n',
    today: TODAY,
  });
  check('H3 titled CRLF header still dates its entry',
    res.gaps.length === 0 && res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify({ gaps: res.gaps, findings: res.findings }));
}

// H4 (AC2). Flat section — header followed directly by bullets, no `###`
// heading → ONE dated entry. Before this fix: zero entries, because the bullet
// lines were dropped on the floor and the section vanished from the audit.
{
  const res = auditLedger({
    ledgerText: '## 2026-09-08\n- Committed abc1234\n',
    today: TODAY,
  });
  check('H4 flat section is one dated entry that audits',
    res.gaps.length === 0 && res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify({ gaps: res.gaps, findings: res.findings }));
}

// H5 (AC2). Flat section WITH a Loaded: bullet → the entry is dated AND its
// trail is read. Asserted as positives, not absences: the first version of this
// case checked `gaps===0 && findings===0`, which the PRE-FIX reader also
// satisfied by parsing nothing at all — a tautology that certified the bug
// (roast finding 2026-09-19). Now the entry must appear in the stats.
{
  const res = auditLedger({
    ledgerText: '## 2026-09-08\n- Loaded: receipts\n- Committed abc1234\n',
    today: TODAY,
  });
  check('H5 flat section with Loaded: is dated and counted',
    res.gaps.length === 0 &&
      res.findings.length === 0 &&
      res.stats.loadedCounts['receipts'] === 1,
    JSON.stringify({ gaps: res.gaps, findings: res.findings, counts: res.stats.loadedCounts }));
}

// H6 (AC2). Two flat sections must not leak into each other: the clean one
// stays clean, the uncovered one is flagged exactly once.
{
  const res = auditLedger({
    ledgerText: '## 2026-09-08\n- Loaded: receipts\n- Committed aaa\n\n## 2026-09-09\n- Committed bbb\n',
    today: TODAY,
  });
  check('H6 flat sections split per date header (one finding, no leak)',
    res.gaps.length === 0 && res.findings.filter((f) => f.kind === 'loaded-gap').length === 1,
    JSON.stringify({ gaps: res.gaps, findings: res.findings }));
}

// H7 (AC4). A comma list counts EVERY skill, not just the first token.
// The real adopter ledger wrote 126 bullets containing `receipts`; the
// first-token parser counted 16.
{
  const res = auditLedger({
    ledgerText: entry('- Loaded: expect-fail, root-cause, receipts\n- Committed abc1234'),
    today: TODAY,
  });
  check('H7 comma-separated Loaded list counts all three skills',
    res.stats.loadedCounts['expect-fail'] === 1 &&
      res.stats.loadedCounts['root-cause'] === 1 &&
      res.stats.loadedCounts['receipts'] === 1,
    JSON.stringify(res.stats.loadedCounts));
}

// H8 (AC4). Every separator the real ledgers use parses the same way.
{
  const res = auditLedger({
    ledgerText: entry('- Loaded: expect-fail; root-cause + receipts / ship-log\n- Committed abc1234'),
    today: TODAY,
  });
  check('H8 semicolon, plus and slash separators all parse',
    ['expect-fail', 'root-cause', 'receipts', 'ship-log'].every((s) => res.stats.loadedCounts[s] === 1),
    JSON.stringify(res.stats.loadedCounts));
}

// H9 (AC5). Annotation text is not a skill. The real ledger wrote
// "- Loaded: (tanpa skill MANDATORY — perubahan teks UI murni, …)" and the
// first-token parser counted `tanpa` as a skill.
{
  const res = auditLedger({
    ledgerText: entry('- Loaded: (tanpa skill MANDATORY — perubahan teks UI murni, tanpa logika perilaku)\n- Committed abc1234'),
    today: TODAY,
  });
  check('H9 annotation-only Loaded line adds no counts',
    Object.keys(res.stats.loadedCounts).length === 0,
    JSON.stringify(res.stats.loadedCounts));
}

// H10 (AC5). A parenthetical AFTER a real skill name must not eat the name and
// must not add the annotation as a skill.
{
  const res = auditLedger({
    ledgerText: entry('- Loaded: expect-fail (ticket 01), receipts (release)\n- Committed abc1234'),
    today: TODAY,
  });
  check('H10 parenthetical annotation keeps the skill, drops the prose',
    res.stats.loadedCounts['expect-fail'] === 1 &&
      res.stats.loadedCounts['receipts'] === 1 &&
      Object.keys(res.stats.loadedCounts).length === 2,
    JSON.stringify(res.stats.loadedCounts));
}

// ---- I. M3 attribution gate (ticket 02, spec §AC7–AC8) ----
// M3 exists to catch one failure: a fix driven by OWNER-SUPPLIED visual
// feedback shipped without restating the context first (Iron Law 1). The old
// trigger was a bare word match on `screenshot|mockup|diagram`, which on a
// real 6-day UI ledger fired 60 times with ZERO owner-attributed entries —
// and inverted the M2 gate, since `screenshot` was simultaneously valid
// rendered evidence and an M3 trigger: an entry that PROVIDED evidence was
// accused of skipping confirmation. Attribution is the discriminator.

// I1 (AC7). Visual mention, NO owner attribution → not a context-gap. The
// fixture is an agent's own rendered-evidence line — the exact shape that
// produced 60 false positives.
{
  const res = auditLedger({
    ledgerText: entry('- Verifikasi screenshot browser: 2 kartu terlihat jelas, teks di atas garis tanpa overlap; tsc EXIT 0'),
    today: TODAY,
  });
  check('I1 self-produced screenshot evidence without owner attribution is not a context-gap',
    !res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// I2 (AC7). Owner-attributed visual feedback, no restatement → flagged.
{
  const res = auditLedger({
    ledgerText: entry('- Owner screenshot showed the collision; fixed the chain list'),
    today: TODAY,
  });
  check('I2 owner-attributed visual feedback without restatement is flagged',
    res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// I3 (AC7). The Indonesian attribution form the real ledger actually uses —
// artifact first, human after ("mockup Master"). Taken verbatim from the one
// genuine M3 hit in the 6-day adopter ledger.
{
  const res = auditLedger({
    ledgerText: entry('- Ruling: copy tanpa em dash — mockup Master pakai em dash, diganti titik dua'),
    today: TODAY,
  });
  check('I3 Indonesian attribution form (artifact first) is recognized',
    res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// I3b (AC8). A REQUEST for a visual artifact is not owner-supplied feedback —
// the entry is asking for data, not acting on it. Real line: "butuh
// screenshot/lokasi persis + rentang tanggal dari Master".
{
  const res = auditLedger({
    ledgerText: entry('- Open: identifikasi pasti sumber "CPR Rp 777" butuh screenshot/lokasi persis + rentang tanggal dari Master'),
    today: TODAY,
  });
  check('I3b a request for an owner artifact is not a context-gap',
    !res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// I4 (AC7). The Master title is the same role — attribution, not a second rule.
// Delivery form: the owner hands the artifact over.
{
  const res = auditLedger({
    ledgerText: entry('- Master kirim mockup sidebar; spacing diterapkan tanpa konfirmasi ulang'),
    today: TODAY,
  });
  check('I4 Master-attributed visual feedback is flagged',
    res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// I5 (AC8). The inversion is closed: an entry carrying BOTH a rendered-evidence
// line and a screenshot mention, with no owner attribution, is clean on M3.
{
  const res = auditLedger({
    ledgerText: entry('- Rendered evidence: screenshot 1440px, verified in browser\n- Modified src/app/page.tsx: fixed layout'),
    today: TODAY,
  });
  check('I5 rendered evidence without owner attribution stays clean',
    !res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// I6 (AC8). QUOTING is not claiming. An entry that discusses the M3 rule itself
// — a ledger entry about the audit, a test fixture quoted in prose — carries
// the attribution phrase inside backticks. Found by dogfooding this very
// session's ledger entry, which quotes the canonical fixture and was flagged
// (the audit cannot tell a quote from a report unless quoting is excluded).
{
  const res = auditLedger({
    ledgerText: entry('- The canonical `Owner screenshot showed the collision` fixture still fires'),
    today: TODAY,
  });
  check('I6 a backticked quote of the attribution phrase is not a context-gap',
    !res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// I7 (AC7 regression floor). The exclusion must not weaken the real case: the
// same phrase UNquoted still fires.
{
  const res = auditLedger({
    ledgerText: entry('- Owner screenshot showed the collision; fixed the chain list'),
    today: TODAY,
  });
  check('I7 the same phrase unquoted still fires',
    res.findings.some((f) => f.kind === 'context-gap'),
    JSON.stringify(res.findings));
}

// ---- J. Gate finding (mandatory-gate integration) — flagged without Loaded: ----
// New finding class from the gate classifier (docs/specs/mandatory-gate.md,
// ticket 02): an entry whose Summary text the classifier flags for a MANDATORY
// domain, but which carries no `Loaded:` line, surfaces as a WARNING-level
// finding that says the verdict is a keyword-pattern signal, not proof.

// J1 (AC1). Done-claim Summary ("commit") without a Loaded: line → gated-loaded-gap
{
  const res = auditLedger({
    ledgerText: entry('- Finished the export feature, please commit'),
    today: TODAY,
  });
  check('J1 gate-flagged done-claim entry without Loaded: fires gated-loaded-gap',
    res.findings.some((f) => f.kind === 'gated-loaded-gap' && f.message.includes('receipts')),
    JSON.stringify(res.findings));
}

// J2 (AC2). The same entry WITH a Loaded: line → no gate finding
{
  const res = auditLedger({
    ledgerText: entry('- Finished the export feature, please commit\n- Loaded: receipts'),
    today: TODAY,
  });
  check('J2 gate-flagged entry with Loaded: is clean',
    !res.findings.some((f) => f.kind === 'gated-loaded-gap'),
    JSON.stringify(res.findings));
}

// J3 (AC4). Off-domain Summary → no gate finding
{
  const res = auditLedger({
    ledgerText: entry('- Renamed a variable in the export module'),
    today: TODAY,
  });
  check('J3 off-domain entry fires no gate finding',
    !res.findings.some((f) => f.kind === 'gated-loaded-gap'),
    JSON.stringify(res.findings));
}

// J4 (AC9). The finding message names itself a keyword-pattern signal to
// verify, not a proven violation.
{
  const res = auditLedger({
    ledgerText: entry('- Tulis test untuk modul export'),
    today: TODAY,
  });
  const f = res.findings.find((x) => x.kind === 'gated-loaded-gap');
  check('J4 gate finding message carries the signal-not-proof disclaimer and names expect-fail',
    f && f.message.includes('keyword') && f.message.includes('not a proven violation') && f.message.includes('expect-fail'),
    JSON.stringify(res.findings));
}

// J5 (regression floor). An entry the M1 literal-marker audit already flags
// still fires loaded-gap — the gate finding is additive, never a replacement.
{
  const res = auditLedger({
    ledgerText: entry('- Root cause found: selector leaked\n- Committed 91f8ce6'),
    today: TODAY,
  });
  check('J5 M1 loaded-gap still fires alongside the gate finding',
    res.findings.some((f) => f.kind === 'loaded-gap'),
    JSON.stringify(res.findings));
}

// F5/F6 (adopter regression 2026-09-23). A Self-Review checklist bullet is a
// template repeat, not revert evidence: KNOWN_SUBSECTIONS fold `### Self-Review`
// heads into the parent body before M5's bullet scan, so every session's
// "- [x] **Maintainability**: ... (revert <hash>)" line collides on a shared
// noun. Two unrelated checklists must not read as a fix-revert cycle.
{
  const ledger = [
    '## 2026-09-21',
    '',
    '### S',
    '- Modified config test — stateless now',
    '',
    '### Self-Review (4 Dimensi)',
    '- [x] **Readability**: constants named',
    '- [x] **Maintainability**: config restored to original state (revert 3001); wizard file untouched',
    '',
    '## 2026-09-22',
    '',
    '### S2',
    '- Enforced single source of truth for port via test',
    '',
    '### Self-Review (4 Dimensi)',
    '- [x] **Maintainability**: clean revert, no leftover diff in 7 config files',
    '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: new Date('2026-09-23T00:00:00Z') });
  check('F5 Self-Review checklist bullets are not churn evidence',
    !res.findings.some((f) => f.kind === 'churn'),
    JSON.stringify(res.findings));
}

// F6 sanity — the fix must not swallow genuine revert bullets: a real
// `- Reverted ...` bullet (no checkbox marker) inside a Self-Review
// subsection still counts toward churn.
{
  const ledger = [
    '## 2026-09-21', '', '### S',
    '### Self-Review (4 Dimensi)',
    '- [x] **Maintainability**: ok',
    '- Reverted the chain list spacing change', '',
    '## 2026-09-22', '', '### S2',
    '### Self-Review (4 Dimensi)',
    '- [x] **Maintainability**: fine',
    '- Reverted the chain list flex treatment', '',
  ].join('\n');
  const res = auditLedger({ ledgerText: ledger, today: new Date('2026-09-23T00:00:00Z') });
  check('F6 genuine revert bullets inside Self-Review still count as churn',
    res.findings.some((f) => f.kind === 'churn' && /chain list/i.test(f.message)),
    JSON.stringify(res.findings));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broke.` : '\nAll expectations hold.');
process.exit(failures ? 1 : 0);
