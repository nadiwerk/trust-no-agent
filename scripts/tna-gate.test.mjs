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
import { decideBefore, observeAfter, readState, logVeto } from './tna-gate.mjs';

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
  observeAfter(dir, { tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'node scripts/x.test.mjs' } }, { title: '', output: 'ALL PASS', metadata: {} });
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
