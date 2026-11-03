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
    'pnpm publish', 'yarn publish', 'yarn npm publish', 'gh pr merge 12', 'gh release create v1',
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

// ---- K. Attached git option values do not launder the subcommand (2026-11-01) ----
// Measured on the shipped 0.1.53 module before this fix: `git -Crepo commit -m x`
// and `git -C. commit -m x` both returned gated:false — `stripGitGlobalOptions`
// recognized only the `=` spelling, so a short flag with its value attached
// stopped the strip loop at the first word and the whole command matched no
// pattern. A real commit therefore passed BOTH the irreversible gate and the
// receipt veto. The `-C<path>` form is ordinary git usage (`git -C../repo`).
{
  const attached = [
    { cmd: 'git -Crepo commit -m x', label: '-C<path> commit' },
    { cmd: 'git -C. commit --allow-empty', label: '-C. commit' },
    { cmd: 'git --git-dir=.git commit -m x', label: '--git-dir=<path> commit' },
    { cmd: 'git -Crepo push origin master', label: '-C<path> push' },
  ];
  for (const { cmd, label } of attached) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`K1 attached-value global options still gate (${label})`, v.gated === true, JSON.stringify(v));
  }
  const open = classifyAction({ tool: 'bash', args: { command: 'git -Crepo commit -m x' }, evidence: { testPassFresh: true } });
  check('K2 fresh evidence still opens an attached-value commit', open.gated === false, JSON.stringify(open));
  const readOnly = classifyAction({ tool: 'bash', args: { command: 'git -Crepo status' }, evidence: {} });
  check('K3 read-only with an attached target stays open', readOnly.gated === false, JSON.stringify(readOnly));
}

// ---- L. gitTargetDir — which work tree a command ACTS ON (2026-11-01) ----
// The receipt veto and the evidence precondition graded `payload.cwd`, so
// `git -C <repo> commit` was judged against the directory the shell stood in.
// Expected values are hand-written from git's documented option grammar, not
// read off the implementation.
{
  const { gitTargetDir } = await import('./action-gate.mjs');
  const { resolve } = await import('node:path');
  // Absolute expectations are platform paths (this suite runs on Windows too),
  // so the expectation is stated as "the cwd-relative target, resolved" — path
  // resolution is node's documented contract. WHICH word becomes the target is
  // the behavior under test, and that stays hand-written per case.
  const cwd = '/work/agent';
  const at = (...p) => resolve(cwd, ...p);
  // Windows absolute paths are quoted (as a shell would carry them): an
  // unquoted backslash is a POSIX escape, so embedding `C:\repo` raw would
  // test the escape rule instead of the target rule.
  const q = (p) => `"${p}"`;
  const cases = [
    { cmd: 'git commit -m x', want: null, label: 'no target: the cwd is the target' },
    { cmd: `git -C ${q(at('/repo'))} commit -m x`, want: at('/repo'), label: '-C <abs>' },
    { cmd: 'git -C ../repo commit -m x', want: at('../repo'), label: '-C <relative>, resolved against the cwd' },
    { cmd: 'git -Crepo commit -m x', want: at('repo'), label: '-C<relative>/inline' },
    { cmd: 'git -C. commit -m x', want: null, label: '-C . names the cwd itself' },
    { cmd: `git --work-tree=${q(at('/repo'))} commit -m x`, want: at('/repo'), label: '--work-tree=<path>' },
    { cmd: `git --git-dir=${q(at('/repo/.git'))} commit -m x`, want: at('/repo'), label: '--git-dir names a .git dir: the work tree owns it' },
    { cmd: `git --git-dir=${q(at('/repo/vcs'))} commit -m x`, want: at('/repo/vcs'), label: '--git-dir with a non-.git name stays as named' },
    { cmd: `git -c user.name=x -C ${q(at('/repo'))} commit -m x`, want: at('/repo'), label: 'stacked globals, target last' },
    { cmd: `cd ${q(at('/repo'))} && git commit -m x`, want: at('/repo'), label: 'a `cd` before the commit names the target (2026-11-01)' },
    { cmd: `cd ${q(at('/repo'))} && git status`, want: at('/repo'), label: 'the rule is per git invocation, not per subcommand' },
    { cmd: 'cd /repo && npm test', want: null, label: 'a `cd` alone names no git target' },
  ];
  for (const { cmd, want, label } of cases) {
    const got = gitTargetDir(cmd, cwd);
    check(`L1 gitTargetDir: ${label}`, got === want, `want=${want} got=${got}`);
  }
}

// ---- M. A Windows-style `git.exe` head is still git (2026-11-03) ----
// Measured on the shipped 0.1.57 module: `git.exe push` and a quoted
// `"C:\Program Files\Git\cmd\git.exe" commit` both returned gated:false.
// `matchAtExecution` normalized the program name only to decide WHETHER to
// strip git's global options, then rebuilt the head from the raw word, so the
// `.exe` and path spelling leaked into the string the pattern table sees.
// PowerShell and cmd resolve `git.exe` as ordinary usage on Windows, and the
// action is identical to `git push` — a real push must not pass because of the
// spelling of the program.
{
  const gated = [
    { cmd: 'git.exe push origin master', label: 'bare git.exe push' },
    { cmd: 'git.exe commit -m "feat: x"', label: 'bare git.exe commit' },
    { cmd: '"C:\\Program Files\\Git\\cmd\\git.exe" push origin master', label: 'quoted absolute git.exe path' },
    { cmd: '"C:\\Program Files\\Git\\cmd\\git.exe" -C . commit -m x', label: 'quoted absolute path plus global options' },
    { cmd: '"C:/Program Files/Git/cmd/git.exe" push origin master', label: 'quoted forward-slash absolute path' },
  ];
  for (const { cmd, label } of gated) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`M1 a git.exe spelling still gates (${label})`, v.gated === true, JSON.stringify(v));
  }
  const open = classifyAction({ tool: 'bash', args: { command: 'git.exe push origin master' }, evidence: { testPassFresh: true } });
  check('M2 fresh evidence opens a git.exe push', open.gated === false, JSON.stringify(open));
  const readOnly = classifyAction({ tool: 'bash', args: { command: 'git.exe status' }, evidence: {} });
  check('M3 read-only git.exe stays open', readOnly.gated === false, JSON.stringify(readOnly));
}

// ---- N. Recursive delete, whichever spelling (2026-11-03) ----
// The table carried one literal, `rm -rf`, so every equivalent spelling walked
// through: `rm -r -f` and `rm -fr` (measured open on 0.1.57), `rm -f -r`,
// `rm -rfv`, `rm --recursive --force`, and the PowerShell/cmd forms
// `Remove-Item -Recurse -Force` and `del /s /q`. The action is the same —
// delete a tree — so the rule keys on the ACTION (any recursive delete),
// never on one spelling of the flags. Force is not part of the rule: a
// recursive delete is irreversible with or without it, and requiring a
// particular flag ORDER is exactly the bug being fixed.
{
  const gated = [
    { cmd: 'rm -r -f dist', label: 'separate -r -f' },
    { cmd: 'rm -fr dist', label: 'clustered -fr' },
    { cmd: 'rm -rf dist', label: 'clustered -rf' },
    { cmd: 'rm -r dist', label: 'recursive without force' },
    { cmd: 'rm -R dist', label: 'capital -R' },
    { cmd: 'rm -f -r dist', label: 'reversed order' },
    { cmd: 'rm -rfv dist', label: 'cluster with -v' },
    { cmd: 'rm --recursive --force dist', label: 'long flags' },
    { cmd: 'sudo rm -fr dist', label: 'behind an executing wrapper' },
    { cmd: 'cd repo && rm -r -f dist', label: 'after a cd' },
    { cmd: 'Remove-Item -Recurse -Force dist', label: 'PowerShell Remove-Item' },
    { cmd: 'Remove-Item dist -Recurse', label: 'PowerShell flag after the path' },
    { cmd: 'del /s /q dist', label: 'cmd del recursive+quiet' },
    { cmd: 'rd /s /q dist', label: 'cmd rd recursive+quiet' },
  ];
  for (const { cmd, label } of gated) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`N1 a recursive delete is gated (${label})`, v.gated === true, JSON.stringify(v));
  }
  const open = [
    { cmd: 'rm dist', label: 'plain rm' },
    { cmd: 'rm -f dist', label: 'force only, no recursion' },
    { cmd: 'rm -i dist', label: 'interactive rm' },
    { cmd: 'del dist', label: 'cmd del, not recursive' },
    { cmd: 'Remove-Item -Force dist', label: 'PowerShell force only' },
    { cmd: 'rd dist', label: 'cmd rd of an empty dir' },
  ];
  for (const { cmd, label } of open) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`N2 a non-recursive delete stays open (${label})`, v.gated === false, JSON.stringify(v));
  }
  const evidenced = classifyAction({ tool: 'bash', args: { command: 'rm -fr dist' }, evidence: { testPassFresh: true } });
  check('N3 fresh evidence opens a recursive delete', evidenced.gated === false, JSON.stringify(evidenced));
}

// ---- O. Publishing and remote state changes beyond npm (2026-11-03) ----
// Measured open on 0.1.57: `pnpm publish`, `yarn npm publish`, `gh pr merge 12
// --squash`, and `gh release create v1`. Each one changes state that cannot be
// taken back with the same one command — a package on the registry, a merged
// PR, a published release — so each belongs to the same boundary as
// `npm publish`. Read-only gh subcommands and package-manager installs stay
// fail-open: the boundary is the ACTION, not the program.
{
  const gated = [
    { cmd: 'pnpm publish', label: 'pnpm publish' },
    { cmd: 'pnpm publish --access public', label: 'pnpm publish with flags' },
    { cmd: 'yarn publish', label: 'yarn publish' },
    { cmd: 'yarn npm publish', label: 'yarn npm publish (berry)' },
    { cmd: 'gh pr merge 12 --squash', label: 'gh pr merge' },
    { cmd: 'gh pr merge --auto', label: 'gh pr merge --auto' },
    { cmd: 'gh release create v1 --notes x', label: 'gh release create' },
    { cmd: 'cd repo && pnpm publish', label: 'after a cd' },
    { cmd: 'sudo gh pr merge 5', label: 'behind an executing wrapper' },
  ];
  for (const { cmd, label } of gated) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`O1 state-changing publish/merge/release is gated (${label})`, v.gated === true, JSON.stringify(v));
  }
  const open = [
    { cmd: 'gh pr view 12', label: 'gh pr view' },
    { cmd: 'gh pr create --fill', label: 'gh pr create (reversible)' },
    { cmd: 'gh release list', label: 'gh release list' },
    { cmd: 'gh repo view', label: 'gh repo view' },
    { cmd: 'pnpm install', label: 'pnpm install' },
    { cmd: 'yarn build', label: 'yarn build' },
  ];
  for (const { cmd, label } of open) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`O2 read-only gh and local package commands stay open (${label})`, v.gated === false, JSON.stringify(v));
  }
  const evidenced = classifyAction({ tool: 'bash', args: { command: 'pnpm publish' }, evidence: { testPassFresh: true } });
  check('O3 fresh evidence opens a pnpm publish', evidenced.gated === false, JSON.stringify(evidenced));
}

// ---- P. A dry run and a help request are not the action (2026-11-03) ----
// Measured gated on 0.1.57: `git push --dry-run`, `git commit --help`, and
// `npm publish --dry-run`. None of them performs the irreversible action —
// git documents --dry-run as "do everything except actually send", npm as
// "everything publish would do except publish". Gating them punishes the
// read-only way to CHECK the action, which is the behavior the framework
// wants more of.
//
// The exemption is narrow on purpose. `--help` counts only in the FIRST
// argument position, because `git commit -m "--help"` is a real commit whose
// message says --help. `--dry-run` counts anywhere EXCEPT as the value of an
// option that would still run the action — `git push -o --dry-run origin`
// pushes with a push-option named --dry-run, so it stays gated.
{
  const open = [
    { cmd: 'git push --dry-run', label: 'push --dry-run' },
    { cmd: 'git push --dry-run origin master', label: 'push --dry-run with refspec' },
    { cmd: 'git push origin master --dry-run', label: 'push, trailing --dry-run' },
    { cmd: 'git commit --dry-run', label: 'commit --dry-run' },
    { cmd: 'git commit --help', label: 'commit --help' },
    { cmd: 'git commit -h', label: 'commit -h' },
    { cmd: 'npm publish --dry-run', label: 'npm publish --dry-run' },
    { cmd: 'pnpm publish --dry-run', label: 'pnpm publish --dry-run' },
    { cmd: 'yarn npm publish --dry-run', label: 'yarn npm publish --dry-run' },
    { cmd: 'gh pr merge --help', label: 'gh pr merge --help' },
    { cmd: 'gh release create --help', label: 'gh release create --help' },
  ];
  for (const { cmd, label } of open) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`P1 a dry run or help request stays open (${label})`, v.gated === false, JSON.stringify(v));
  }
  const gated = [
    { cmd: 'git commit -m "--help"', label: '--help as a commit message value' },
    { cmd: 'git commit -m "--dry-run"', label: '--dry-run as a message value' },
    { cmd: 'git push -o --dry-run origin master', label: '--dry-run as a push-option value (the push still happens)' },
    { cmd: 'npm publish --tag --dry-run', label: '--dry-run as a dist-tag value' },
    { cmd: 'git push --force', label: 'a plain force push' },
    { cmd: 'git push --help-me-not', label: 'a word that merely starts with --help' },
  ];
  for (const { cmd, label } of gated) {
    const v = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} });
    check(`P2 the exemption does not open a real action (${label})`, v.gated === true, JSON.stringify(v));
  }
}

// ---- Q. A patch is judged by its TARGETS, never by its text (2026-11-03) ----
// Measured on 0.1.57: `apply_patch` reads its diff from `command`, so the
// irreversible-pattern matcher graded the PATCH TEXT. A diff whose context line
// began with ` git push origin master` was gated (a false positive on
// documentation), while a patch that UPDATED or DELETED `.trust/progress.txt`
// was open (a real gap: the ledger guard covered only write/edit). The scanner
// already refuses a git hook payload for the same reason — text a tool will not
// execute is data. So: paths decide the ledger rule, and patch text never
// reaches command matching.
{
  const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
  const ledgerMessages = 'append-only';

  const ledgerTargets = [
    { body: patch('*** Update File: .trust/progress.txt', '@@', '-old line', '+new line'), label: 'Update File' },
    { body: patch('*** Add File: .trust/progress.txt', '+first line'), label: 'Add File' },
    { body: patch('*** Delete File: .trust/progress.txt'), label: 'Delete File' },
    { body: patch('*** Update File: C:\\repo\\.trust\\progress.txt', '@@', '+x'), label: 'absolute Windows path' },
    { body: patch('*** Update File: src/a.ts', '@@', '+x', '*** Update File: .trust/progress.txt', '+y'), label: 'second file in the same patch' },
  ];
  for (const { body, label } of ledgerTargets) {
    const v = classifyAction({ tool: 'apply_patch', args: { command: body }, evidence: {} });
    check(`Q1 a patch touching the ledger is gated (${label})`, v.gated === true, JSON.stringify(v));
    check(`Q2 the denial explains the ledger rule (${label})`, v.reason.includes(ledgerMessages), v.reason);
    const fresh = classifyAction({ tool: 'apply_patch', args: { command: body }, evidence: { testPassFresh: true } });
    check(`Q3 evidence never opens the ledger patch gate (${label})`, fresh.gated === true, JSON.stringify(fresh));
  }

  const open = [
    { body: patch('*** Update File: docs/guide.md', '@@', '-Before you continue, run git push.', '+Before you continue, run git push upstream.'), label: 'context line mentioning git push' },
    { body: patch('*** Update File: docs/guide.md', '@@', ' git push origin master', '+git push --force'), label: 'diff text that reads like a command' },
    { body: patch('*** Add File: scripts/helper.sh', '+npm publish'), label: 'a new file whose content is an irreversible command' },
    { body: patch('*** Update File: src/a.ts', '@@', '-a', '+b'), label: 'ordinary source edit' },
  ];
  for (const { body, label } of open) {
    const v = classifyAction({ tool: 'apply_patch', args: { command: body }, evidence: {} });
    check(`Q4 a patch that executes nothing stays open (${label})`, v.gated === false, JSON.stringify(v));
  }

  // The ledger guard is about the TOOL writing the file, not one tool name:
  // every editor-shaped tool that can replace the file wholesale must gate.
  for (const tool of ['multiedit', 'notebookedit', 'str_replace_editor', 'MultiEdit', 'NotebookEdit']) {
    const v = classifyAction({ tool, args: { filePath: '.trust/progress.txt' }, evidence: {} });
    check(`Q5 ${tool} to the ledger is gated`, v.gated === true, JSON.stringify(v));
  }
  const multiOpen = classifyAction({ tool: 'multiedit', args: { filePath: 'src/a.ts' }, evidence: { testPassFresh: true } });
  check('Q6 multiedit elsewhere stays open', multiOpen.gated === false, JSON.stringify(multiOpen));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
