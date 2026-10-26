#!/usr/bin/env node
/**
 * Fail-first test for scripts/action-gate.mjs — the action-gate that replaces
 * word-punishment with action-gating (spec: docs/specs/hardening-general.md,
 * ticket 01-action-gate-core, AC7).
 *
 * Zero dependencies. Run: node scripts/action-gate.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = gate or consistency drift.
 *
 * Seam: classifyAction({ tool, args, evidence, message }) — a PURE function
 * over a tool call. Returns { gated, reason }. No I/O. Expected verdicts are
 * hand-written literals derived from the spec's intent (AC7: words alone never
 * gate; irreversible action without fresh evidence always gates), never from
 * running the code.
 */
import { classifyAction, IRREVERSIBLE_PATTERNS } from './action-gate.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Pure-function interface (ticket 01 criterion 2) ----
{
  const v = classifyAction({ tool: 'bash', args: { command: 'git commit -m x' }, evidence: {} });
  check('A1 returns a plain object', v !== null && typeof v === 'object' && !Array.isArray(v));
  check('A2 gated is boolean', typeof v.gated === 'boolean');
  check('A3 reason is a non-empty string', typeof v.reason === 'string' && v.reason.length > 0, JSON.stringify(v));
  check('A4 verdicts are fresh objects (no shared mutable state across calls)',
    classifyAction({ tool: 'read', args: {} }) !== classifyAction({ tool: 'read', args: {} }));
}

// ---- B. Irreversible action without fresh evidence → gated (spec §AC7) ----
{
  const cases = [
    [{ tool: 'bash', args: { command: 'git commit -m "feat: x"' }, evidence: {} }, 'commit, no evidence'],
    [{ tool: 'bash', args: { command: 'git push origin master' }, evidence: {} }, 'push, evidence absent'],
    [{ tool: 'Bash', args: { command: 'git commit -m test' }, evidence: { testPassFresh: false } }, 'commit, stale evidence, mixed-case tool'],
    [{ tool: 'bash', args: { command: 'npm publish' }, evidence: {} }, 'publish, no evidence'],
    [{ tool: 'bash', args: { command: 'rm -rf dist' }, evidence: {} }, 'delete, no evidence'],
    [{ tool: 'shell', args: { command: 'git commit -m "feat: x"' }, evidence: {} }, 'commit via shell tool, no evidence (opencode V2 live name)'],
  ];
  for (const [input, label] of cases) {
    check(`B1 gated: ${label}`, classifyAction(input).gated === true, JSON.stringify(classifyAction(input)));
  }
}

// ---- C. Irreversible action WITH fresh evidence → not gated ----
{
  const v = classifyAction({ tool: 'bash', args: { command: 'git commit -m "feat: x"' }, evidence: { testPassFresh: true } });
  check('C1 fresh evidence opens the gate', v.gated === false, JSON.stringify(v));
}

// ---- D. Words alone never gate (spec §AC7 core) ----
// The same read-only action under a "done"-flavored message and a neutral one
// must return IDENTICAL verdicts: the message cannot influence the gate by
// construction, so evasion-by-rephrasing buys nothing.
{
  const base = { tool: 'read', args: { filePath: 'docs/x.md' }, evidence: {} };
  const done = classifyAction({ ...base, message: 'this is done, ship it, selesai' });
  const neutral = classifyAction({ ...base, message: 'what is the status?' });
  const bare = classifyAction({ tool: 'read', args: { filePath: 'docs/x.md' }, evidence: {} });
  check('D1 read-only action is not gated', bare.gated === false, JSON.stringify(bare));
  check('D2 a "done" message does not change the verdict', JSON.stringify(done) === JSON.stringify(neutral), `${JSON.stringify(done)} vs ${JSON.stringify(neutral)}`);
  // And the reverse: a "done" message cannot OPEN a gate the action closed.
  const gatedA = classifyAction({ tool: 'bash', args: { command: 'git push origin master' }, evidence: {}, message: 'just checking, not done yet' });
  check('D3 a humble message does not open the gate', gatedA.gated === true, JSON.stringify(gatedA));
}

// ---- G. Unknown shape with irreversible command → deny (full-enforcement 04/AC7) ----
// Doubt blocks with its reason shown: a `command` string matching the
// irreversible patterns gates under ANY tool name — a future harness renaming
// `shell` must not reopen the hole ticket 08 closed live. Tools without a
// `command` field are unaffected (D/E suites above still hold).
{
  const v = classifyAction({ tool: 'shiny-new-executor', args: { command: 'git push origin master' }, evidence: {} });
  check('G1 unknown tool carrying an irreversible command is gated', v.gated === true, JSON.stringify(v));
  check('G2 the denial names the unknown tool (reason shown, not silent)',
    v.reason.includes('shiny-new-executor'), v.reason);
  const open = classifyAction({ tool: 'shiny-new-executor', args: { command: 'git push origin master' }, evidence: { testPassFresh: true } });
  check('G3 fresh evidence still opens the gate under an unknown tool', open.gated === false, JSON.stringify(open));
}

// ---- H. The private ledger is append-only — write/edit to it is gated (ledger-overwrite incident, 2026-10-18) ----
// Origin: the `write` tool overwrote .trust/progress.txt (a season's history
// lost; the append-only contract is prose in lessons.md but nothing enforced
// it — a rule with no enforcer is itself a repeat failure). A write/edit whose
// target path resolves to the private ledger is gated regardless of evidence:
// fresh test evidence cannot restore lost history, so evidence NEVER opens
// this gate. Other paths stay fail-open (E suite unchanged).
{
  const ledgerPaths = [
    '.trust/progress.txt',
    'C:\\abs\\project\\.trust\\progress.txt',
    '/abs/project/.trust/progress.txt',
    '.trust\\progress.txt',
  ];
  for (const p of ledgerPaths) {
    const w = classifyAction({ tool: 'write', args: { filePath: p, content: 'x' }, evidence: {} });
    check(`H1 write to the private ledger is gated (${p})`, w.gated === true, JSON.stringify(w));
    const e = classifyAction({ tool: 'edit', args: { filePath: p }, evidence: {} });
    check(`H2 edit of the private ledger is gated (${p})`, e.gated === true, JSON.stringify(e));
    const fresh = classifyAction({ tool: 'write', args: { filePath: p, content: 'x' }, evidence: { testPassFresh: true } });
    check(`H3 evidence never opens the ledger gate (${p})`, fresh.gated === true, JSON.stringify(fresh));
  }
  const notLedger = [
    { tool: 'write', args: { filePath: '.trust/tna-gate-state.json', content: '{}' } },
    { tool: 'write', args: { filePath: 'src/a.ts', content: 'x' } },
    { tool: 'edit', args: { filePath: 'docs/x.md' } },
    { tool: 'write', args: { filePath: '.trust/onboarding.json', content: '{}' } },
  ];
  for (const input of notLedger) {
    check(`H4 fail-open preserved: ${input.tool} ${input.args.filePath}`, classifyAction(input).gated === false, JSON.stringify(classifyAction(input)));
  }
  const bashAppend = classifyAction({ tool: 'bash', args: { command: 'echo x >> .trust/progress.txt' }, evidence: {} });
  check('H5 bash APPEND to the ledger is allowed (append is the contract)', bashAppend.gated === false, JSON.stringify(bashAppend));
  const bashTruncate = classifyAction({ tool: 'bash', args: { command: 'Set-Content .trust/progress.txt -Value x' }, evidence: {} });
  check('H6 bash overwrite/truncate of the ledger is gated (doubt blocks)', bashTruncate.gated === true, JSON.stringify(bashTruncate));
  // NAMING the ledger is not OVERWRITING it. Audit is the activity the
  // framework wants to encourage, so read-only forms must stay open; only a
  // matched write form (Set-Content / > / tee) may gate. Observed live: three
  // read-only audit commands vetoed in one session (F5, 2026-10-21).
  const readOnly = [
    'wc -l .trust/progress.txt',
    'node scripts/validate.mjs .trust/progress.txt',
    'ls -la .trust/ && node scripts/validate.mjs .trust/progress.txt',
    'grep -n "^## 20" .trust/progress.txt',
  ];
  for (const cmd of readOnly) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`H7 a read-only command naming the ledger is allowed (${cmd})`, v.gated === false, JSON.stringify(v));
  }
}

// ---- E. Ordinary writes stay fail-open (Constraints: irreversible only) ----
{
  const cases = [
    [{ tool: 'write', args: { filePath: 'src/a.ts' }, evidence: {} }, 'write prod file'],
    [{ tool: 'edit', args: { filePath: 'src/a.ts' }, evidence: {} }, 'edit prod file'],
  ];
  for (const [input, label] of cases) {
    check(`E1 fail-open: ${label}`, classifyAction(input).gated === false, JSON.stringify(classifyAction(input)));
  }
}

// ---- F. Pattern-table ↔ test consistency (prior art: mandatory-gate F1) ----
{
  const allCommands = [
    'git commit -m "feat: x"', 'git push origin master', 'npm publish', 'rm -rf dist',
  ].join(' ');
  const untested = [];
  for (const p of IRREVERSIBLE_PATTERNS) {
    const esc = String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(esc, 'i').test(allCommands)) untested.push(p);
  }
  check('F1 every irreversible pattern appears in at least one case above',
    untested.length === 0, `untested: ${untested.join(', ')}`);
  check('F2 the pattern table is non-empty',
    Array.isArray(IRREVERSIBLE_PATTERNS) && IRREVERSIBLE_PATTERNS.length > 0);
}

// ---- I. Prose naming an irreversible action is not that action (F4, 2026-10-21) ----
// Observed live: writing a ledger entry through a heredoc whose text said
// "before you git commit, ..." tripped the irreversible gate, then fell into
// the receipt veto. The gate exists to catch EXECUTION, so a pattern only
// counts at an execution position (start of the command string or right after
// a shell separator, wrappers aside). Anything merely mentioning the phrase
// mid-sentence must stay open — otherwise the gate grades shell syntax, and
// the workaround (stage to a temp file, then cat >>) defeats its own purpose.
{
  const prose = [
    { cmd: 'echo "note: git commit is gated here"', label: 'echo, phrase inside a quoted sentence' },
    { cmd: 'cat <<\'EOF\' >> .trust/progress.txt\n- sebelum commit, jalankan git commit dengan bukti\nEOF', label: 'heredoc body line mentioning the phrase' },
    { cmd: 'echo "- the rule says: never git push without sign-off"', label: 'prose about push' },
    { cmd: 'node scripts/eval.mjs && echo "npm publish is what CI does, not us"', label: 'phrase after a separator but inside quotes' },
  ];
  for (const { cmd, label } of prose) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`I1 prose never gates (${label})`, v.gated === false, JSON.stringify(v));
  }
  // ...while the same phrase at an execution position still gates.
  const executing = [
    { cmd: 'cd repo && git commit -m "feat: x"', label: 'after &&' },
    { cmd: 'node scripts/eval.mjs; git push origin master', label: 'after ;' },
    { cmd: 'cd repo\ngit commit -m "feat: x"', label: 'start of the next line' },
    { cmd: 'sudo git commit -m "feat: x"', label: 'after an executing wrapper' },
    { cmd: 'npm publish', label: 'at the start of the string' },
    // Preservation guard, not new behavior: the pre-F4 whole-string match
    // caught these, so quote-stripping must not silently lose them. Text
    // handed to an interpreter is a command, not prose.
    { cmd: 'bash -c "git push origin master"', label: 'inside a bash -c payload' },
    { cmd: 'pwsh -Command "git commit -m x"', label: 'inside a pwsh -Command payload' },
  ];
  for (const { cmd, label } of executing) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`I2 execution position still gates (${label})`, v.gated === true, JSON.stringify(v));
  }
}

// ---- J. git's own global options do not launder the subcommand (2026-10-25) ----
// Measured live: `git -C . commit --allow-empty` ran a real commit while
// `classifyAction` returned gated:false, on every harness — the classifier
// compared the first word to `git commit` and git's global options (`-C`,
// `-c`, `--git-dir`, `--no-pager`, …) sit BETWEEN the program and the
// subcommand. The gate keys on the action the shell will run, so the options
// are skipped before the subcommand is matched. Read-only git stays open:
// the fix must not turn `git status` into a false positive.
{
  const laundering = [
    { cmd: 'git -C . commit --allow-empty -m x', label: '-C <path> commit' },
    { cmd: 'git -c user.name=x commit -m x', label: '-c <k=v> commit' },
    { cmd: 'git --git-dir=.git commit -m x', label: '--git-dir commit' },
    { cmd: 'git --no-pager commit -m x', label: '--no-pager commit' },
    { cmd: 'git -C /repo push origin master', label: '-C <path> push' },
    { cmd: 'git --no-pager -C . push --force', label: 'stacked global options, push' },
    { cmd: 'sudo git -C . commit -m x', label: 'global option behind an executing wrapper' },
  ];
  for (const { cmd, label } of laundering) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`J1 git global options still gate (${label})`, v.gated === true, JSON.stringify(v));
  }
  const readOnly = [
    { cmd: 'git status', label: 'status' },
    { cmd: 'git -C . status', label: '-C . status' },
    { cmd: 'git --no-pager log --oneline -5', label: '--no-pager log' },
    { cmd: 'git -c core.pager=cat diff', label: '-c <k=v> diff' },
  ];
  for (const { cmd, label } of readOnly) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`J2 read-only git stays open (${label})`, v.gated === false, JSON.stringify(v));
  }
  // Evidence still opens a laundered commit: the fix must gate the ACTION,
  // never punish the syntax.
  const open = classifyAction({ tool: 'bash', args: { command: 'git -C . commit -m x' }, evidence: { testPassFresh: true } });
  check('J3 fresh evidence opens a laundered commit', open.gated === false, JSON.stringify(open));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
