#!/usr/bin/env node
/**
 * gate-hook-fastpath — pins the PreToolUse pre-filter as a STRICT SUPERSET of
 * the gated-action space, and proves the fast path skips the verdict modules
 * end-to-end.
 *
 * Why the adversarial corpus exists: the pre-filter is a second matcher in
 * front of the classifier. Any shape the classifier gates that the filter
 * misses is a fail-open hole worse than no fast path at all — the gate would
 * LOOK installed while a spelling slipped past it. The pin therefore runs the
 * REAL classifier (matchesAnyCommand) as the oracle: anything it calls gated
 * must survive the filter, including quote/escape-split needles
 * (`git com'mit'` — splitWords consumes the quote, so the classifier sees
 * `git commit` and the filter must too), wrapper chains, git global options,
 * interpreter payloads, and the recursive-delete family.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { IRREVERSIBLE_PATTERNS, matchesAnyCommand } from './action-gate.mjs';
import { mayGatePreTool } from './gate-hook.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'gate-hook.mjs');

const pre = (toolInput, tool = 'exec') => mayGatePreTool({
  hook_event_name: 'PreToolUse',
  tool_name: tool,
  tool_input: toolInput,
  cwd: HERE,
});
const cmd = (command, tool) => pre({ command }, tool);

// Every spelling the classifier is proven to gate must reach it — the
// corpus pairs each with the classifier's own verdict so the test cannot
// drift into asserting the filter is stricter than the gate.
const GATED_COMMANDS = [
  // The literal patterns, undressed and dressed.
  ...IRREVERSIBLE_PATTERNS.map((p) => `${p} --flag`),
  'sudo git commit -m x',
  'env A=1 git push origin main',
  'doas git push',
  'time npm publish',
  'git -C . commit -m x',
  'git -C. commit -m x',
  'git --git-dir=r/.git commit -m x',
  'git -c user.name=x commit -m y',
  'echo ok && git push',
  'echo ok; git commit -m x',
  'false || git push',
  'bash -c "git commit -m x"',
  "sh -c 'git push'",
  "eval 'git push'",
  '( git push )',
  '`git push`',
  // Quote/escape-split needles — splitWords consumes the quote, so the
  // classifier gates these; the filter must not lose them.
  "git com'mit' -m x",
  'git "com"mit -m x',
  'git c\\ommit -m x',
  "git pu'sh'",
  "r'm' -rf /tmp/x",
  // The recursive-delete family — wider than the `rm -rf` literal.
  'rm -r -f /tmp/x',
  'rm -fr /tmp/x',
  'rm -rfv /tmp/x',
  'rm --recursive --force /tmp/x',
  'Remove-Item -Recurse -Force C:\\x',
  'ri -Recurse C:\\x',
  'del /s /q C:\\x',
  'erase /s C:\\x',
  'rd /s C:\\x',
  'rmdir /s C:\\x',
  // Ledger overwrite forms through a shell.
  'echo x > .trust/progress.txt',
  'Set-Content .trust/progress.txt y',
  'echo x | tee .trust/progress.txt',
  'copy nul .trust\\progress.txt',
];

// Non-gated calls the fast path must skip — no hint substring survives
// normalization, so the verdict machinery is never paid. Needles in DATA
// position (an echoed "git commit", a lookalike progress.txt path) still pay
// the load — that overmatch is the free, safe direction.
const BENIGN = [
  { tool: 'exec', input: { command: 'ls -la' } },
  { tool: 'exec', input: { command: 'git status --short' } },
  { tool: 'exec', input: { command: 'git diff main...HEAD' } },
  { tool: 'exec', input: { command: 'node probe.test.mjs' } },
  { tool: 'exec', input: { command: 'npm test' } },
  { tool: 'read', input: { file_path: 'src/app.ts' } },
  { tool: 'write', input: { file_path: 'src/app.ts', content: 'x' } },
];

test('every gated command spelling survives the pre-filter', () => {
  const misses = [];
  for (const c of GATED_COMMANDS) {
    if (!cmd(c)) misses.push(c);
  }
  assert.deepEqual(misses, [], `pre-filter dropped gated command(s): ${misses.join(' | ')}`);
});

test('pre-filter is a strict superset of the real classifier (corpus)', () => {
  const misses = [];
  for (const c of GATED_COMMANDS) {
    if (matchesAnyCommand(c) && !cmd(c)) misses.push(c);
  }
  assert.deepEqual(misses, [], `filter narrower than classifier on: ${misses.join(' | ')}`);
});

test('ledger-targeting tool calls survive the pre-filter', () => {
  assert.equal(pre({ file_path: '.trust/progress.txt', content: 'x' }, 'write'), true);
  assert.equal(pre({ file_path: 'C:\\repo\\.trust\\progress.txt' }, 'edit'), true);
  assert.equal(pre({ file_path: '.trust/progress.txt' }, 'str_replace_editor'), true);
  // apply_patch whose diff names the ledger.
  assert.equal(pre({ command: '*** Delete File: .trust/progress.txt' }, 'apply_patch'), true);
});

test('benign calls skip the verdict machinery', () => {
  const leaks = BENIGN.filter(({ tool, input }) => pre(input, tool)).map(({ input }) => input.command ?? input.file_path);
  assert.deepEqual(leaks, [], `benign call(s) paid the gate: ${leaks.join(' | ')}`);
});

test('malformed payloads stay fail-open', () => {
  assert.equal(mayGatePreTool({}), false);
  assert.equal(mayGatePreTool({ tool_input: 'not an object' }), false);
  assert.equal(mayGatePreTool(null), false);
  // args is the alternate carrier some harnesses send.
  assert.equal(mayGatePreTool({ args: { command: 'git push' } }), true);
});

// ---- end-to-end: the fast path skips loading the verdict modules ----

function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, TNA_DEBUG_HOOK: '1', ...env },
    timeout: 30000,
  });
}

test('e2e: benign PreToolUse emits nothing and never loads tna-gate', () => {
  const r = runHook({ hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'ls -la' }, cwd: HERE });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.ok(!String(r.stderr).includes('tna-gate.mjs'), `verdict module loaded on the fast path: ${r.stderr}`);
});

test('e2e: gated PreToolUse still loads the machinery and denies without evidence', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'tna-fastpath-'));
  const r = runHook({ hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: scratch });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('e2e: ledger write via file tool still denies', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'tna-fastpath-'));
  mkdirSync(join(scratch, '.trust'), { recursive: true });
  writeFileSync(join(scratch, '.trust', 'progress.txt'), 'prior\n');
  const r = runHook({
    hook_event_name: 'PreToolUse', tool_name: 'write',
    tool_input: { file_path: join(scratch, '.trust', 'progress.txt'), content: 'overwritten' },
    cwd: scratch,
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('e2e: declined hooks consent still silences a gated payload', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'tna-fastpath-'));
  mkdirSync(join(scratch, '.trust'), { recursive: true });
  writeFileSync(join(scratch, '.trust', 'onboarding.json'),
    JSON.stringify({ schema: 1, consentedAt: '2026-11-24T00:00:00.000Z', routerVersion: '0.1.59', harness: 'test', components: { floor: true, hooks: false, overlays: true, evidenceGate: true }, did: {} }));
  const r = runHook({ hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git push' }, cwd: scratch });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('e2e: PostToolUse without a command skips the machinery', () => {
  const r = runHook({ hook_event_name: 'PostToolUse', tool_name: 'read', tool_input: { file_path: 'x.ts' }, cwd: HERE });
  assert.equal(r.status, 0);
  assert.ok(!String(r.stderr).includes('tna-gate.mjs'), `verdict module loaded for a non-shell PostToolUse: ${r.stderr}`);
});
