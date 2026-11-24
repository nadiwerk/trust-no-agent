#!/usr/bin/env node
/**
 * Fail-first test for veto-hooks/gemini/hook.mjs — the Gemini CLI adapter.
 *
 * Gemini CLI already speaks snake_case (hook_event_name, tool_name,
 * tool_input, session_id, transcript_path, cwd) — the transform is mostly an
 * event-name rename: BeforeTool -> PreToolUse, AfterTool -> PostToolUse. The
 * deny contract is {"decision":"deny","reason":...} or exit 2 + stderr;
 * unlike Antigravity, empty stdout + exit 0 is a normal allow, so this
 * adapter can stay silent on the pass path.
 *
 * Input shape pinned from the live SessionStart payload captured on gemini
 * 0.66.0 (.scratch/gem-dump.jsonl) + the official hooks reference; a live
 * BeforeTool/AfterTool capture was impossible — gemini CLI is auth-blocked on
 * free-tier (IneligibleTierError 2026-11-24).
 *
 * Zero dependencies. Run: node scripts/gemini-hook.test.mjs
 * Exit 0 = every expectation holds. Exit 1 = adapter drift or a gap.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = join(ROOT, 'veto-hooks', 'gemini', 'hook.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

if (!existsSync(ADAPTER)) {
  check('adapter exists at veto-hooks/gemini/hook.mjs', false, ADAPTER);
  console.log('\n1 FAILURE(S)');
  process.exit(1);
}

const { transformPayload, translateChildOutput } = await import(pathToFileURL(ADAPTER).href);

const run = (payload, { cwd }) => spawnSync(process.execPath, [ADAPTER], {
  input: JSON.stringify(payload),
  encoding: 'utf8',
  cwd,
  timeout: 20000,
});

// --- transformPayload: gemini event names -> gate shape ---------------------

{
  const p = transformPayload({
    hook_event_name: 'BeforeTool', tool_name: 'run_shell_command',
    tool_input: { command: 'git commit -m x' }, session_id: 's1',
    transcript_path: '/t.jsonl', cwd: '/proj', timestamp: '2026-11-24T00:00:00Z',
  }).payload;
  check('BeforeTool -> PreToolUse', p.hook_event_name === 'PreToolUse');
  check('run_shell_command -> bash (SHELL_TOOLS door for the recorder)', p.tool_name === 'bash');
  check('native tool name kept', p.harness_tool === 'run_shell_command');
  check('tool_input.command carried', p.tool_input.command === 'git commit -m x');
  check('session_id carried', p.session_id === 's1');
  check('cwd carried', p.cwd === '/proj');
}

{
  const post = transformPayload({
    hook_event_name: 'AfterTool', tool_name: 'run_shell_command',
    tool_input: { command: 'false' }, tool_response: { error: 'exit 1' }, cwd: '/p',
  }).payload;
  check('AfterTool -> PostToolUse', post.hook_event_name === 'PostToolUse');
  check('tool_response error -> exitCode 1', post.tool_response && post.tool_response.exitCode === 1 && post.tool_response.error === 'exit 1');
  const okPost = transformPayload({
    hook_event_name: 'AfterTool', tool_name: 'run_shell_command',
    tool_input: { command: 'npm test' }, tool_response: { output: '2 passed' }, cwd: '/p',
  }).payload;
  check('clean tool_response -> exitCode 0 + stdout', okPost.tool_response.exitCode === 0 && okPost.tool_response.stdout === '2 passed');
}

{
  const w = transformPayload({
    hook_event_name: 'BeforeTool', tool_name: 'write_file',
    tool_input: { file_path: '.trust/progress.txt', content: 'x' }, cwd: '/p',
  }).payload;
  check('write_file -> write (ledger guard sees it)', w.tool_name === 'write' && w.tool_input.file_path === '.trust/progress.txt');
  const e = transformPayload({
    hook_event_name: 'BeforeTool', tool_name: 'replace',
    tool_input: { file_path: 'a.md' }, cwd: '/p',
  }).payload;
  check('replace -> edit', e.tool_name === 'edit');
}

{
  const p = transformPayload({ hook_event_name: 'SessionStart', source: 'startup', cwd: '/p' }).payload;
  check('SessionStart passes through', p.hook_event_name === 'SessionStart');
}

{
  const p = transformPayload({ hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command: 'ls' } }).payload;
  check('payload gains cwd when gemini sends none', typeof p.cwd === 'string' && p.cwd.length > 0);
  const kept = transformPayload({ hook_event_name: 'BeforeTool', tool_name: 'x', tool_input: {}, cwd: '/real/dir' }).payload;
  check('an explicit payload.cwd is never overwritten', kept.cwd === '/real/dir');
}

// --- translateChildOutput: gate deny -> gemini decision ----------------------

{
  const deny = JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r1',
  } });
  const t = translateChildOutput(deny, 0);
  const out = JSON.parse(t.stdout);
  check('permissionDecision deny -> decision deny + reason', out.decision === 'deny' && out.reason === 'r1');
  const quiet = translateChildOutput('', 0);
  check('silent child stays silent (gemini: empty+exit0 = allow)', quiet.stdout === '');
  const crashed = translateChildOutput('', 1);
  check('crashed child fails OPEN', crashed.code === 0 && crashed.stdout === '');
}

// --- end-to-end against a fake project --------------------------------------

const project = mkdtempSync(join(tmpdir(), 'gem-hook-project-'));
try {
  const blocked = run({
    hook_event_name: 'BeforeTool', tool_name: 'run_shell_command',
    tool_input: { command: 'git commit -m x' }, cwd: project, session_id: 's1',
  }, { cwd: project });
  const bOut = JSON.parse(blocked.stdout || '{}');
  check('e2e: commit without evidence -> decision deny', blocked.status === 0 && bOut.decision === 'deny',
    `status=${blocked.status} out=${blocked.stdout.slice(0, 200)}`);

  const benign = run({
    hook_event_name: 'BeforeTool', tool_name: 'run_shell_command',
    tool_input: { command: 'echo hi' }, cwd: project, session_id: 's1',
  }, { cwd: project });
  check('e2e: benign echo -> silent allow', benign.status === 0 && !benign.stdout.includes('deny'),
    `status=${benign.status} out=${benign.stdout.slice(0, 200)}`);

  const garbage = spawnSync(process.execPath, [ADAPTER], { input: 'not json', encoding: 'utf8', cwd: project, timeout: 20000 });
  check('unparsable stdin fails open silently', garbage.status === 0 && !garbage.stdout.includes('deny'));
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL EXPECTATIONS HOLD' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
