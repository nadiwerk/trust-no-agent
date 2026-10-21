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
  // `today` must be at or after every "fresh" fixture date below: a claim
  // dated after today is a defect, never fresh (suite G). Before F6 these
  // fixtures used today=2026-10-14 with entries dated 2026-10-20 — a future
  // claim passing as fresh, which is the bug G1 now pins.
  const today = new Date('2026-10-21T00:00:00Z');
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

// ---- G. The anchor is a claim, not a heading (F6, 2026-10-21) ----
// Observed live: a ledger whose last `## <date>` heading reads 2026-11-02 — a
// date in the future — became the veto's staleness anchor. Because the
// staleness rule is `age < RECEIPT_STALE_DAYS`, a future date yields a
// NEGATIVE age, so that entry can never go stale and the veto opens forever.
// A heading is a label someone typed; the claim is what has to be verified.
//
// Spec under test: the anchor entry is the newest by POSITION (the ledger is
// append-only, so position is newest), its date is the nearest `## <date>`
// heading above it, a date after `today` is a LEDGER DEFECT (reported, and it
// cannot gate), and a `#### Receipt` block is the claim record — prose above
// it is not part of the receipt.
{
  const { newestEntry, auditLedgerReceipts, vetoVerdict } = await import('./receipt-enforcement.mjs');
  const today = new Date('2026-10-21T00:00:00Z');

  const validReceiptLines = [
    '**Verdict** — the receipt holds',
    'constraints satisfied — the shape + allowlist checked',
    'evidence fresh — node scripts/eval.mjs → 37/37 green',
    'scope held — 1 file in, 0 out',
    'subject verified — the receipt-enforcement seam',
    'fail-first proven — RED: blanket rejected first',
    '**Evidence** — the validator output',
    '**Open** — none',
    '**Next** — none',
  ];

  // The ads-tracker shape: a future-dated heading whose entry carries a
  // perfectly valid receipt. Nothing about the receipt is wrong — the DATE is.
  const futureLedger = [
    '## 2026-10-16',
    '',
    '### Session Summary - earlier work',
    ...validReceiptLines,
    '',
    '## 2026-11-02',
    '',
    '### Session Summary - future-dated heading',
    '',
    '#### Receipt',
    ...validReceiptLines,
  ].join('\n');

  const futureVeto = vetoVerdict({ ledgerText: futureLedger, today });
  check('G1 a claim dated after today cannot gate (a future date is never fresh)',
    futureVeto.allow === false && /future/i.test(futureVeto.reason), JSON.stringify(futureVeto));

  const futureAudit = auditLedgerReceipts({ ledgerText: futureLedger, today });
  check('G2 the future-dated heading is reported as a ledger defect',
    futureAudit.findings.some((f) => f.date === '2026-11-02' && /future/i.test(f.message)),
    JSON.stringify(futureAudit.findings));

  // The receipt is the claim record. A summary line above it that happens to
  // cite a command is prose, not evidence, and must not be graded as a receipt.
  const scopedLedger = [
    '## 2026-10-16',
    '',
    '### Session Summary - prose above the receipt',
    'The install step ran `npm install left-pad` outside the gate.',
    '',
    '#### Receipt',
    ...validReceiptLines,
  ].join('\n');
  const scopedVeto = vetoVerdict({ ledgerText: scopedLedger, today });
  check('G3 a `#### Receipt` block is the claim record (prose above it is not graded as evidence)',
    scopedVeto.allow === true, JSON.stringify(scopedVeto));

  // Preservation guard: ledgers that never adopted the `#### Receipt` heading
  // (every fixture in suite F, and the pre-heading entries in real ledgers)
  // still anchor on the last `## <date>` partition.
  const plainLedger = [
    '## 2026-10-16',
    '',
    '### Session Summary - inline receipt, no heading',
    ...validReceiptLines,
  ].join('\n');
  const plain = newestEntry(plainLedger);
  check('G4 without a `#### Receipt` heading the anchor is the last `## <date>` partition',
    plain !== null && plain.date === '2026-10-16' && /inline receipt/.test(plain.text),
    JSON.stringify(plain));
  check('G5 the fallback still gates: an inline receipt on a fresh date is allowed',
    vetoVerdict({ ledgerText: plainLedger, today }).allow === true,
    JSON.stringify(vetoVerdict({ ledgerText: plainLedger, today })));
}

// ---- H. The allowlist belongs to the PROJECT, not to the framework (F1, 2026-10-21) ----
// Observed live: the shipped payload carries no `.github/`, so
// `repoGateCommands()` — hardwired to the framework ROOT's ci.yml — returns an
// EMPTY set for every adopter, and `validateReceipt` only ever extracts
// `node scripts/*.mjs` citations. An adopter citing `npm test` therefore gets
// `commands: []` -> `unverifiable` -> the veto denies every commit, forever,
// with no reason a human can act on. The framework's own allowlist is non-empty
// precisely because the framework's CI happens to be written in `node scripts/*`.
//
// Spec under test: the allowlist is read from the PROJECT root, in order —
// (1) a `proof-commands` fenced block declared in the project's AGENTS.md,
// (2) the project's `.github/workflows/*.yml` run steps (a generalized parser:
// any gate runner, block scalars included, setup/install lines excluded),
// (3) empty WITH AN EXPLICIT REASON — never a silent empty set.
{
  const { repoGateCommands, resolveGateCommands, validateReceipt: vr, vetoVerdict: vv } =
    await import('./receipt-enforcement.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { join: jH } = await import('node:path');
  const { tmpdir: osTmpH } = await import('node:os');

  const project = (agentsMd, ciYml) => {
    const dir = mkdtempSync(jH(osTmpH(), 'adopter-'));
    if (agentsMd !== null) writeFileSync(jH(dir, 'AGENTS.md'), agentsMd);
    if (ciYml !== null) {
      mkdirSync(jH(dir, '.github', 'workflows'), { recursive: true });
      writeFileSync(jH(dir, '.github', 'workflows', 'ci.yml'), ciYml);
    }
    return dir;
  };
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const show = (s) => JSON.stringify([...s].sort());

  // (1) A declaration in the project's own AGENTS.md is authoritative.
  const declared = project(
    ['# Project', '', '## 6. Verification commands', '', '```proof-commands', 'npm run typecheck', 'npm test', '```', ''].join('\n'),
    null,
  );
  const h1 = repoGateCommands({ root: declared });
  check('H1 an AGENTS.md `proof-commands` block is the project allowlist',
    sameSet(h1, new Set(['npm run typecheck', 'npm test'])), show(h1));

  // (2) No declaration -> the project's own CI workflow, parsed generally.
  //     A block scalar's setup lines (mkdir/printf/chmod) are NOT gates; the
  //     npm/npx lines are.
  const ciOnly = project(null, [
    'jobs:',
    '  test:',
    '    steps:',
    '      - run: npm ci',
    '      - run: npm run lint',
    '      - run: npm test',
    '      - run: npx vitest run src/test/unit/migration-journal.test.ts',
    '      - name: Siapkan SSH',
    '        run: |',
    '          mkdir -p ~/.ssh',
    "          printf '%s\\n' \"$KEY\" > ~/.ssh/id_ci",
    '          chmod 600 ~/.ssh/id_ci',
    '          npm run typecheck',
    '',
  ].join('\n'));
  const h2 = repoGateCommands({ root: ciOnly });
  check('H2 the project CI workflow yields its gates, block scalars included',
    h2.has('npm test') && h2.has('npm run lint') && h2.has('npm run typecheck')
    && h2.has('npx vitest run src/test/unit/migration-journal.test.ts'), show(h2));
  check('H2b setup and install steps are not gates',
    !h2.has('npm ci') && ![...h2].some((c) => /^(mkdir|printf|chmod)\b/.test(c)), show(h2));

  // (3) Neither source -> empty, and the emptiness is EXPLAINED.
  const bare = project(null, null);
  const h3res = resolveGateCommands({ root: bare });
  check('H3 a project declaring no gates resolves empty',
    h3res.gates.size === 0 && h3res.source === 'none', JSON.stringify({ source: h3res.source, size: h3res.gates.size }));
  check('H3b the empty resolution carries an explicit reason naming both places it looked',
    typeof h3res.reason === 'string' && /AGENTS\.md/.test(h3res.reason) && /workflow/i.test(h3res.reason),
    JSON.stringify(h3res.reason));

  // (4) Citation extraction follows the allowlist, not a hardwired shape.
  const npmReceipt = [
    '**Verdict** — the receipt holds',
    'constraints satisfied — the shape + allowlist checked',
    'evidence fresh — npm test → 42/42 green, this turn',
    'scope held — 1 file in, 0 out',
    'subject verified — the adopter project',
    'fail-first proven — RED: npm citation rejected before the parser',
    '**Evidence** — the run above',
    '**Open** — none',
    '**Next** — none',
  ].join('\n');
  const h4 = vr(npmReceipt, { gates: repoGateCommands({ root: ciOnly }) });
  check('H4 a receipt citing a project gate is accepted and its command extracted',
    h4.commands.includes('npm test') && !h4.errors.some((e) => /allowlist/i.test(e)),
    JSON.stringify({ commands: h4.commands, errors: h4.errors.slice(0, 2) }));

  // (5) A project with no declared gates gets a reason a human can act on.
  const h5 = vv({ ledgerText: `## 2026-10-20\n\n${npmReceipt}`, today: new Date('2026-10-21T00:00:00Z'), root: bare });
  check('H5 the veto names the missing declaration instead of a silent empty allowlist',
    h5.allow === false && /declar|AGENTS\.md/i.test(h5.reason), JSON.stringify(h5));

  // (6) A declaration outranks CI when both exist.
  const both = project(
    ['```proof-commands', 'npm run typecheck', '```', ''].join('\n'),
    ['jobs:', '  t:', '    steps:', '      - run: npm test', ''].join('\n'),
  );
  const h6 = repoGateCommands({ root: both });
  check('H6 the AGENTS.md declaration wins over the CI workflow',
    sameSet(h6, new Set(['npm run typecheck'])), show(h6));

  // (7) Preservation guard: the framework's own allowlist still resolves.
  const h7 = repoGateCommands();
  check('H7 the framework repo still resolves its own gates (node scripts/eval.mjs present)',
    h7.has('node scripts/eval.mjs') && h7.size >= 30, String(h7.size));

  // (8) A declared-but-empty block is an error, not a silent fallback to CI.
  const emptyBlock = project(
    ['```proof-commands', '```', ''].join('\n'),
    ['jobs:', '  t:', '    steps:', '      - run: npm test', ''].join('\n'),
  );
  const h8 = resolveGateCommands({ root: emptyBlock });
  check('H8 a `proof-commands` block that declares nothing is reported, not silently replaced',
    h8.gates.size === 0 && h8.source === 'agents-md-empty' && /empty/i.test(h8.reason),
    JSON.stringify({ source: h8.source, reason: h8.reason }));

  for (const d of [declared, ciOnly, bare, both, emptyBlock]) rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll receipt-enforcement seam expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
