#!/usr/bin/env node
/**
 * Fail-first test for scripts/receipt-enforcement.mjs — the hilir receipt
 * validator + staleness seams (receipt-enforcement tickets 01/02; spec
 * AC1/AC2/AC3/AC6/AC7/AC10). Zero dependencies.
 * Run: node scripts/receipt-enforcement.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = seam drift.
 *
 * Seams: validateReceipt (receipt text -> blocks + per-boolean evidence +
 * allowlisted commands + errors), receiptStatus + canGateClaim (age ->
 * fresh/stale/re-verified/unverifiable). Fixtures are hand-written receipt
 * literals (independent source of truth).
 */
import { validateReceipt, receiptStatus, canGateClaim, RECEIPT_STALE_DAYS } from './receipt-enforcement.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const VALID_RECEIPT = [
  '**Verdict** — constraints satisfied: yes · evidence fresh: yes · scope held: yes',
  'constraints satisfied — the four-block shape + allowlist commands checked',
  'evidence fresh — node scripts/eval.mjs → 37/37 green, this turn',
  'scope held — 2 files in, 0 out',
  'subject verified — the receipts skill and this test file',
  'fail-first proven — RED: blanket verdict rejected before the validator',
  '**Evidence** — the validator output above',
  '**Open** — the re-run path (ticket 03)',
  '**Next** — commit the spec, then fork-it',
].join('\n');

// ---- A. The receipt shape (spec AC1/AC2/AC4) ----
{
  const res = validateReceipt(VALID_RECEIPT);
  check('A1 a receipt with per-boolean evidence lines validates',
    res.errors.length === 0, JSON.stringify(res.errors));
  check('A2 the five booleans are extracted with their evidence',
    res.booleans.length === 5 && res.booleans.every((b) => b.evidence.length > 0),
    JSON.stringify(res.booleans.map((b) => b.name)));

  const blanket = [
    '**Verdict** — constraints satisfied: yes · evidence fresh: yes · scope held: yes · subject verified: yes · fail-first proven: yes',
    '**Evidence** — all five hold',
    '**Open** — none',
    '**Next** — none',
  ].join('\n');
  const bad = validateReceipt(blanket);
  check('A3 a blanket all-yes verdict is rejected, naming the missing booleans',
    bad.errors.some((e) => /constraints satisfied/.test(e)) && bad.errors.some((e) => /fail-first proven/.test(e)),
    JSON.stringify(bad.errors).slice(0, 300));

  const noNext = VALID_RECEIPT.replace('**Next** — commit the spec, then fork-it', '');
  const bad2 = validateReceipt(noNext);
  check('A4 a missing block is a named error', bad2.errors.some((e) => /Next/.test(e)), JSON.stringify(bad2.errors));
}

// ---- B. The command allowlist (spec AC3) ----
{
  const evil = VALID_RECEIPT.replace('node scripts/eval.mjs → 37/37 green', '`rm -rf x` → 37/37 green');
  const res = validateReceipt(evil);
  check('B1 a non-allowlisted command is rejected, named',
    res.errors.some((e) => /rm -rf/.test(e) && /allowlist/i.test(e)), JSON.stringify(res.errors).slice(0, 200));
  const ok = validateReceipt(VALID_RECEIPT);
  check('B2 a repo gate from the CI workflow passes the allowlist',
    ok.commands.includes('node scripts/eval.mjs') && !ok.errors.some((e) => /allowlist/i.test(e)),
    JSON.stringify(ok.commands));
}

// ---- C. The fast one-line receipt (spec AC10) ----
{
  const fast = 'fast: fixed the wiring — node scripts/eval.mjs → 37/37 green';
  const res = validateReceipt(fast);
  check('C1 a fast one-line receipt (claim + command + result) validates',
    res.errors.length === 0 && res.commands.includes('node scripts/eval.mjs'), JSON.stringify(res));
  const badFast = 'fast: fixed the wiring';
  const bad = validateReceipt(badFast);
  check('C2 a fast claim with neither command nor result is rejected',
    bad.errors.some((e) => /fast/i.test(e)), JSON.stringify(bad.errors));
}

// ---- D. Staleness (spec AC6/AC7) ----
{
  check('D1 RECEIPT_STALE_DAYS is 14', RECEIPT_STALE_DAYS === 14, String(RECEIPT_STALE_DAYS));
  const today = new Date('2026-10-14T00:00:00Z');
  const cmds = ['node scripts/eval.mjs'];
  check('D2 age 13 is fresh; age 14 exactly is stale; age 15 is stale',
    receiptStatus({ claimDate: '2026-10-01', today, commands: cmds }) === 'fresh'
    && receiptStatus({ claimDate: '2026-09-30', today, commands: cmds }) === 'stale'
    && receiptStatus({ claimDate: '2026-09-29', today, commands: cmds }) === 'stale',
    JSON.stringify(['2026-10-01', '2026-09-30', '2026-09-29'].map((d) => receiptStatus({ claimDate: d, today, commands: cmds }))));
  check('D3 a claim with no evidence commands is unverifiable, never fresh',
    receiptStatus({ claimDate: '2026-10-13', today, commands: [] }) === 'unverifiable',
    receiptStatus({ claimDate: '2026-10-13', today, commands: [] }));
  check('D4 canGateClaim: fresh and re-verified true; stale and unverifiable false',
    canGateClaim('fresh') === true && canGateClaim('re-verified') === true
    && canGateClaim('stale') === false && canGateClaim('unverifiable') === false,
    ['fresh', 're-verified', 'stale', 'unverifiable'].map(canGateClaim).join(','));
  check('D5 a stale claim with a passing re-run becomes re-verified and may gate',
    receiptStatus({ claimDate: '2026-09-01', today, commands: cmds, reRunResult: 0 }) === 're-verified'
    && canGateClaim(receiptStatus({ claimDate: '2026-09-01', today, commands: cmds, reRunResult: 0 })) === true,
    receiptStatus({ claimDate: '2026-09-01', today, commands: cmds, reRunResult: 0 }));
  check('D6 a stale claim with a failing re-run stays stale',
    receiptStatus({ claimDate: '2026-09-01', today, commands: cmds, reRunResult: 1 }) === 'stale',
    receiptStatus({ claimDate: '2026-09-01', today, commands: cmds, reRunResult: 1 }));
}

// ---- E. The hardened runner + re-verification (spec AC8/AC9) ----
// Fixture gates in temp trees (a passing gate, a failing gate, a hanging
// gate, a chaining probe) so the runner's contract is observable without
// depending on which real gates are green today.
{
  const { runGateCommand, reVerifyClaim } = await import('./receipt-enforcement.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } = await import('node:fs');
  const { join: jE } = await import('node:path');
  const { tmpdir: osTmp } = await import('node:os');

  const dir = mkdtempSync(jE(osTmp(), 'rerun-'));
  const gatePath = jE(dir, 'gates');
  mkdirSync(gatePath, { recursive: true });
  const writeGate = (name, body) => {
    const p = jE(gatePath, name);
    writeFileSync(p, body);
    return `node ${p}`;
  };
  const passGate = writeGate('pass.mjs', 'process.exit(0);');
  const failGate = writeGate('fail.mjs', 'process.exit(1);');
  const hangGate = writeGate('hang.mjs', 'while (true) {}');
  const FIXTURE_GATES = new Set([passGate, failGate, hangGate]);

  check('E1 a passing gate command runs and returns 0', runGateCommand(passGate, { gates: FIXTURE_GATES }) === 0, String(runGateCommand(passGate, { gates: FIXTURE_GATES })));
  check('E2 a failing gate command returns 1', runGateCommand(failGate, { gates: FIXTURE_GATES }) === 1, String(runGateCommand(failGate, { gates: FIXTURE_GATES })));
  const refused = (() => { try { runGateCommand('node ' + join(gatePath, 'pass.mjs').replace('pass.mjs', 'nope.mjs'), { gates: FIXTURE_GATES }); return 'ran'; } catch { return 'refused'; } })();
  check('E3 a command outside the allowlist is refused, not executed', refused === 'refused', refused);
  const timedOut = runGateCommand(hangGate, { gates: FIXTURE_GATES, timeout: 1500 });
  check('E4 a hanging gate times out and counts as a failing re-run', timedOut === 1, String(timedOut));

  // Shell metacharacters cannot chain: the chained part is an argv element.
  const marker = jE(dir, 'PWNED');
  const chainGate = writeGate('chain.mjs', 'process.exit(0);');
  const chained = `${chainGate} && node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '\\\\')}', '1')"`;
  const withChain = new Set([...FIXTURE_GATES, chained]);
  runGateCommand(chained, { gates: withChain });
  check('E5 shell metacharacters in a cited command cannot chain (no shell)',
    !existsSync(marker), `marker exists: ${existsSync(marker)}`);

  // reVerifyClaim: stale + passing gate -> re-verified; stale + failing -> stale.
  const today = new Date('2026-10-14T00:00:00Z');
  const rv = reVerifyClaim({ claimDate: '2026-09-01', today, commands: [passGate] }, { gates: FIXTURE_GATES });
  check('E6 a stale claim whose gate re-runs green becomes re-verified',
    rv.status === 're-verified' && canGateClaim(rv.status), JSON.stringify(rv));
  const rvFail = reVerifyClaim({ claimDate: '2026-09-01', today, commands: [failGate] }, { gates: FIXTURE_GATES });
  check('E7 a stale claim whose gate re-runs red stays stale',
    rvFail.status === 'stale' && !canGateClaim(rvFail.status), JSON.stringify(rvFail));
  const rvFresh = reVerifyClaim({ claimDate: '2026-10-01', today, commands: [passGate] }, { gates: FIXTURE_GATES });
  check('E8 a fresh claim is NOT re-run (the audit stays bounded)', rvFresh.status === 'fresh', JSON.stringify(rvFresh));

  rmSync(dir, { recursive: true, force: true });
}

// ---- F. The audit + veto seams (spec AC4/AC11/AC15/AC17) ----
// Fixture ledgers (hand-written): an old entry (grandfathered), a new
// entry with a blanket verdict (hard), a new entry with a valid receipt
// (allowed), and the newest-entry linkage both directions.
{
  const { auditLedgerReceipts, vetoVerdict } = await import('./receipt-enforcement.mjs');
  const today = new Date('2026-10-14T00:00:00Z');
  const ledger = [
    '## 2026-09-01',
    '',
    '### Session Summary - old work',
    '**Verdict** — all five hold',
    '**Evidence** — the runs',
    '**Open** — none',
    '**Next** — none',
    '',
    '## 2026-10-20',
    '',
    '### Session Summary - new work, blanket verdict',
    '**Verdict** — constraints satisfied: yes · evidence fresh: yes · scope held: yes · subject verified: yes · fail-first proven: yes',
    '**Evidence** — everything',
    '**Open** — none',
    '**Next** — none',
  ].join('\n');
  const res = auditLedgerReceipts({ ledgerText: ledger, today });
  check('F1 an old entry with a blanket verdict is grandfathered (warn, not hard)',
    res.warns.length === 1 && /grandfathered/.test(res.warns[0]), JSON.stringify(res.warns));
  check('F2 a new entry with a blanket verdict is a hard finding',
    res.findings.length === 1 && /2026-10-20/.test(res.findings[0].message) && /boolean/.test(res.findings[0].message),
    JSON.stringify(res.findings));

  const goodLedger = [
    '## 2026-10-20',
    '',
    '### Session Summary - new work, proper receipt',
    '**Verdict** — the receipt holds',
    'constraints satisfied — the shape + allowlist checked',
    'evidence fresh — node scripts/eval.mjs → 37/37 green',
    'scope held — 1 file in, 0 out',
    'subject verified — the receipt-enforcement seam',
    'fail-first proven — RED: blanket rejected first',
    '**Evidence** — the validator output',
    '**Open** — the wiring',
    '**Next** — commit the spec',
  ].join('\n');
  check('F3 the veto allows a commit when the newest entry has a valid receipt',
    vetoVerdict({ ledgerText: goodLedger, today }).allow === true, JSON.stringify(vetoVerdict({ ledgerText: goodLedger, today })));
  check('F4 the veto denies with a named reason when the newest entry has a blanket verdict',
    (() => { const v = vetoVerdict({ ledgerText: ledger, today }); return v.allow === false && /receipt/.test(v.reason); })(),
    JSON.stringify(vetoVerdict({ ledgerText: ledger, today })));
  const staleLedger = goodLedger.replace('## 2026-10-20', '## 2026-08-01');
  check('F5 the veto denies a stale claim (must be re-verified before gating)',
    (() => { const v = vetoVerdict({ ledgerText: staleLedger, today }); return v.allow === false && /stale/.test(v.reason); })(),
    JSON.stringify(vetoVerdict({ ledgerText: staleLedger, today })));
  const mixed = ledger.replace('## 2026-10-20', '## 2026-09-15'); // newest is grandfathered
  check('F6 the linkage is the newest entry (an older grandfathered entry does not satisfy it)',
    (() => { const v = vetoVerdict({ ledgerText: mixed, today }); return v.allow === false; })(), JSON.stringify(vetoVerdict({ ledgerText: mixed, today })));
  check('F7 no ledger at all returns null (the evidence precondition owns that case)',
    vetoVerdict({ ledgerText: '', today }) === null, 'null');
}

console.log(failures === 0 ? '\nAll receipt-enforcement seam expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
