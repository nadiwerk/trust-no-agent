#!/usr/bin/env node
/**
 * Fail-first test for the tna-gate CORE seam (ticket 02-veto-opencode-state,
 * AC1; adapter coverage moved to tna-gate-v2.test.mjs in ticket 08).
 *
 * Zero dependencies (node builtins only). Run: node scripts/tna-gate.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = veto or state drift.
 *
 * Seam: scripts/tna-gate.mjs (pure decide/observe + state read/write over an
 * injected directory). The V2 adapter (.opencode/plugins/tna-gate/index.js)
 * is driven by tna-gate-v2.test.mjs; this file pins the core it delegates
 * to. Fixtures use real temp dirs (fs.mkdtempSync), never the repo's own
 * .trust/. Expected verdicts are hand-written literals derived from the
 * spec's intent (AC1 + Constraints + the published self-review decision
 * "absent state = no evidence = deny"), never from running the code.
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideBefore, observeAfter, observeAfterWith, readState, logVeto } from './tna-gate.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};
const freshDir = () => mkdtempSync(join(tmpdir(), 'tna-gate-'));

// ---- A. AC1 core — commit with no state denies (spec self-review: absent = deny) ----
{
  const dir = freshDir();
  const v = decideBefore({ dir, tool: 'bash', args: { command: 'git commit -m "feat: x"' } });
  check('A1 commit with no state file is DENIED', v.allow === false, JSON.stringify(v));
  check('A2 the denial names the missing evidence (not a silent block)',
    /fresh test/i.test(v.reason), v.reason);
  check('A3 the denial is logged as one parseable veto-fire line',
    logVeto(dir, { harness: 'opencode', tool: 'bash', command: 'git commit -m "feat: x"' }) === true &&
    (() => { try { const o = JSON.parse(readFileSync(join(dir, '.trust', 'tna-gate-log.jsonl'), 'utf8').trim().split('\n').pop()); return o.tool === 'bash' && /git commit/.test(o.command); } catch { return false; } })());
}

// ---- B. Stale (failed) state denies push ----
{
  const dir = freshDir();
  observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'node scripts/x.test.mjs' } }, { title: '', output: 'fail 1', metadata: { error: true } });
  const v = decideBefore({ dir, tool: 'bash', args: { command: 'git push origin master' } });
  check('B1 push after a FAILED test run is DENIED', v.allow === false, JSON.stringify(v));
}

// ---- C. Fresh pass opens the gate ----
{
  const dir = freshDir();
  observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'node scripts/x.test.mjs' } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  const v = decideBefore({ dir, tool: 'bash', args: { command: 'git commit -m "feat: x"' } });
  check('C1 commit after a passing test run is ALLOWED', v.allow === true, JSON.stringify(v));
  check('C2 the pass is recorded in the state file', readState(dir).testPassFresh === true, JSON.stringify(readState(dir)));
}

// ---- D. Fail-open preserved — non-irreversible tools never deny ----
{
  const dir = freshDir();
  const r = decideBefore({ dir, tool: 'read', args: { filePath: 'docs/x.md' } });
  const w = decideBefore({ dir, tool: 'write', args: { filePath: 'src/a.ts', content: 'x' } });
  check('D1 read/write with empty state are ALLOWED', r.allow === true && w.allow === true, JSON.stringify({ r, w }));
}

// ---- E. observeAfter records honestly, touches nothing else ----
{
  const dir = freshDir();
  const touched = observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'git status' } }, { title: '', output: '', metadata: {} });
  check('E1 non-test commands leave no state file', touched === null && !existsSync(join(dir, '.trust', 'tna-gate-state.json')), String(touched));
  check('E2 decideBefore on a read call allows without state',
    decideBefore({ dir, tool: 'read', args: {} }).allow === true, JSON.stringify(decideBefore({ dir, tool: 'read', args: {} })));
  const forgery = observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'echo .test.mjs' } }, { title: '', output: '', metadata: {} });
  check('E3 a forged substring (echo .test.mjs) records nothing',
    forgery === null && readState(dir).testPassFresh === false, JSON.stringify({ forgery, state: readState(dir) }));
}

// ---- F. Veto-fire log: denials counted, logging never breaks the veto ----
{
  const dir = freshDir();
  check('F1 logVeto writes one parseable line', logVeto(dir, { harness: 'test', tool: 'bash', command: 'git push origin master' }) === true &&
    (() => { try { return JSON.parse(readFileSync(join(dir, '.trust', 'tna-gate-log.jsonl'), 'utf8').trim()).command === 'git push origin master'; } catch { return false; } })());
  logVeto(dir, { harness: 'test', tool: 'bash', command: 'git commit -m y' });
  check('F2 a second denial appends (two lines)',
    readFileSync(join(dir, '.trust', 'tna-gate-log.jsonl'), 'utf8').trim().split('\n').length === 2);
  check('F3 an unwritable dir returns false instead of throwing',
    logVeto(join(dir, '.trust', 'tna-gate-log.jsonl'), { harness: 't', tool: 'bash', command: 'x' }) === false);
}

// ---- G. Shell-tool parity — test evidence records under any shell tool (exec_command finding, 2026-10-24) ----
// decideBefore gates irreversible commands under ANY tool name (doubt blocks, full-enforcement 04/AC7), so a test
// run through the same tool must record — otherwise a gate that fires on exec_command can never open from an
// exec_command session (veto fail-closed forever on the bb/Codex path).
{
  const dir = freshDir();
  const recorded = observeAfter(dir, { tool: 'exec_command', sessionID: 's', callID: 'c', args: { command: 'node scripts/x.test.mjs' } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  check('G1 a passing test run via exec_command records fresh evidence',
    recorded !== null && readState(dir).testPassFresh === true, JSON.stringify({ recorded, state: readState(dir) }));
  const v = decideBefore({ dir, tool: 'exec_command', args: { command: 'git commit -m "feat: x"' } });
  check('G2 commit via exec_command after its own passing test run is ALLOWED', v.allow === true, JSON.stringify(v));
}
{
  const dir = freshDir();
  observeAfter(dir, { tool: 'exec_command', sessionID: 's', callID: 'c', args: { command: 'node scripts/x.test.mjs' } }, { title: '', output: 'fail 1', metadata: { error: true } });
  const v = decideBefore({ dir, tool: 'exec_command', args: { command: 'git push origin master' } });
  check('G3 push via exec_command after a FAILING test run is DENIED', v.allow === false, JSON.stringify(v));
}
{
  const dir = freshDir();
  const touched = observeAfter(dir, { tool: 'exec_command', sessionID: 's', callID: 'c', args: { command: 'git status' } }, { title: '', output: '', metadata: {} });
  check('G4 a non-test command via exec_command records nothing (no state touched)',
    touched === null && !existsSync(join(dir, '.trust', 'tna-gate-state.json')), String(touched));
}
// ---- H. Cross-project evidence binding (roast r1 F7) ----
// The recorder classified only the final chain segment, so `cd elsewhere &&
// npm test` wrote fresh evidence into the victim repo's .trust — a run that
// never touched the repo certified its commits. Evidence binds to the
// directory the command actually ran in.
{
  const dir = freshDir();
  const elsewhere = freshDir();
  observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: `cd ${elsewhere} && npm test` } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  check('H1 cd elsewhere && npm test does NOT authorize the victim repo',
    readState(dir).testPassFresh !== true
    && decideBefore({ dir, tool: 'bash', args: { command: 'git commit -m x' } }).allow === false,
    `state=${JSON.stringify(readState(dir))} verdict=${JSON.stringify(decideBefore({ dir, tool: 'bash', args: { command: 'git commit -m x' } }))}`);
  check('H2 the evidence binds to the directory the test actually ran in',
    readState(elsewhere).testPassFresh === true
    && decideBefore({ dir: elsewhere, tool: 'bash', args: { command: 'git commit -m x' } }).allow === true,
    `state=${JSON.stringify(readState(elsewhere))}`);
}
{
  const dir = freshDir();
  observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: `cd ${dir} && node scripts/x.test.mjs` } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  check('H3 cd <same dir> && node x.test.mjs still certifies the dir it ran in',
    readState(dir).testPassFresh === true, JSON.stringify(readState(dir)));
}
{
  // Residual laundering shapes: an impossible cd (target cannot exist, so the
  // && chain could never have run the test) and unresolvable dests all certify
  // NOTHING anywhere — a claimed pass must not land in the victim cwd.
  const dir = freshDir();
  const ghost = join(dir, 'no-such-subdir-xyz');
  const impossible = observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: `cd ${ghost} && npm test` } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  check('H4 cd <nonexistent> && npm test records evidence NOWHERE',
    impossible === null && readState(dir).testPassFresh !== true && !existsSync(ghost),
    `ret=${JSON.stringify(impossible)} state=${JSON.stringify(readState(dir))}`);
  const back = observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'cd - && npm test' } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  check('H5 cd - && npm test records evidence NOWHERE (oldpwd unresolvable)',
    back === null && readState(dir).testPassFresh !== true,
    `ret=${JSON.stringify(back)} state=${JSON.stringify(readState(dir))}`);
  const variable = observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'cd $SOMEWHERE && npm test' } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  check('H6 cd $VAR && npm test records evidence NOWHERE (variable dest)',
    variable === null && readState(dir).testPassFresh !== true,
    `ret=${JSON.stringify(variable)} state=${JSON.stringify(readState(dir))}`);
}
{
  // The store-bound recorder (opencode) cannot redirect evidence to another
  // tree — the store is bound — so a dir-changing chain must record NOTHING.
  const writes = [];
  const store = { writeState: async (s) => { writes.push(s); } };
  const r = await observeAfterWith(store, { tool: 'bash', command: 'cd elsewhere && npm test', pass: true });
  check('H7 a cd-chained command records NOTHING through the store-bound path',
    r === null && writes.length === 0,
    `ret=${JSON.stringify(r)} writes=${writes.length}`);
}
{
  // Residual laundering (roast r2 R1/F7): a dir-changer hidden INSIDE a
  // wrapper — subshell parens, command substitution, or a nested shell
  // launcher — never appears as a chain segment's leading token, so a
  // segment-level DIR_CHANGERS check cannot see it. `bash -c "cd X && npm
  // test"` really does run the test in X — but through a shape the resolver
  // cannot prove, so the honest verdict is record NOTHING (unproven dir
  // certifies nothing), never silently bind to the payload cwd.
  const dir = freshDir();
  const elsewhere = freshDir();
  for (const [label, command] of [
    ['parens subshell', `(cd ${elsewhere}) && npm test`],
    ['nested bash -c', `bash -c "cd ${elsewhere}" && npm test`],
    ['nested cmd /c', `cmd /c "cd ${elsewhere}" && npm test`],
  ]) {
    const d = freshDir();
    const r = observeAfter(d, { tool: 'bash', sessionID: 's', callID: 'c', args: { command } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
    check(`H8 ${label}: wrapped cd does NOT authorize the victim repo`,
      r === null && readState(d).testPassFresh !== true,
      `ret=${JSON.stringify(r)} state=${JSON.stringify(readState(d))}`);
  }
  const writes = [];
  const store = { writeState: async (s) => { writes.push(s); } };
  const rw = await observeAfterWith(store, { tool: 'bash', command: `bash -c "cd ${elsewhere}" && npm test`, pass: true });
  check('H9 store-bound path also refuses a wrapped cd (bash -c)',
    rw === null && writes.length === 0, `ret=${JSON.stringify(rw)} writes=${writes.length}`);
  const rw2 = await observeAfterWith(store, { tool: 'bash', command: '(cd elsewhere) && npm test', pass: true });
  check('H10 store-bound path refuses a parens-subshell cd',
    rw2 === null && writes.length === 0, `ret=${JSON.stringify(rw2)} writes=${writes.length}`);
  // Sanity: a benign quoted mention of a dir-changer is not a dir change —
  // `echo "remember cd" && npm test` must still bind to the payload cwd
  // (no over-flagging into a dead gate).
  const benign = freshDir();
  const rb = observeAfter(benign, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'echo "remember cd" && npm test' } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
  check('H11 a quoted non-dir-change mention still binds to the real cwd',
    rb !== null && readState(benign).testPassFresh === true,
    `ret=${JSON.stringify(rb)} state=${JSON.stringify(readState(benign))}`);
}
{
  // Round-3 residuals: shapes that still slip hiddenDirChange.
  // (a) redirect boundary — bash parses `cd>x` as cd + redirect, but `>` was
  // not a token boundary so the changer went unseen.
  // (b) quoted/escaped program name — `'cd' x`, `c\d x`, `cd${IFS}x` dodge the
  // prog check AND are stripped from rest by the unquoted scan.
  // (c) launcher gaps — payloads hiding a dir change behind launchers the
  // set did not know (interpreter -c, make -C, remote exec).
  // (d) encoded PowerShell — the base64 blob can never match a token scan.
  for (const [label, command] of [
    ['H12 redirect boundary', 'cd>x && npm test'],
    ['H13 single-quoted prog', `'cd' elsewhere && npm test`],
    ['H13 double-quoted prog', `"cd" elsewhere && npm test`],
    ['H13 backslash-escaped prog', 'c\\d elsewhere && npm test'],
    ['H13 ${IFS} bypass', 'cd${IFS}elsewhere && npm test'],
    ['H14 expect -c', `expect -c "cd elsewhere" && npm test`],
    ['H14 su -c', `su -c "cd elsewhere" && npm test`],
    ['H14 runuser -c', `runuser -c "cd elsewhere" && npm test`],
    ['H14 ssh remote exec', `ssh host "cd elsewhere" && npm test`],
    ['H14 make -C', 'make -C elsewhere test && npm test'],
    ['H14 python os.chdir', `python -c "import os;os.chdir('elsewhere')" && npm test`],
    ['H15 encoded powershell', 'powershell -e Y2QgZWxzZXdoZXJl && npm test'],
    ['H15 pwsh -EncodedCommand', 'pwsh -EncodedCommand Y2QgZWxzZXdoZXJl && npm test'],
  ]) {
    const d = freshDir();
    const r = observeAfter(d, { tool: 'bash', sessionID: 's', callID: 'c', args: { command } }, { title: '', output: 'ALL PASS', metadata: { error: false } });
    check(`${label}: records evidence NOWHERE`,
      r === null && readState(d).testPassFresh !== true,
      `ret=${JSON.stringify(r)} state=${JSON.stringify(readState(d))}`);
  }
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
