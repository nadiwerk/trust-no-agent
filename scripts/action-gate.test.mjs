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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
