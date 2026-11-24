#!/usr/bin/env node
/**
 * Fail-first test for veto-hooks/antigravity/hook.mjs — the Antigravity CLI
 * (agy) hook adapter.
 *
 * agy fires camelCase lifecycle events (hookEventName) with tool calls nested
 * as toolCall.{name,args} and the shell command under args.CommandLine. Its
 * deny contract is {"decision":"deny","reason":...} — and unlike Devin, agy
 * fails CLOSED: an empty, malformed, or crashed hook output is read as a deny
 * (measured live 2026-11-24: a probe printing {} blocked echo, and ghostex's
 * broken exit-1 hook blocks every tool call on this machine). The adapter
 * must therefore ALWAYS print an explicit decision on PreToolUse, allow
 * included — silent exit 0 is a deny on this harness.
 *
 * Payload shapes here are captured live from agy 1.5.14
 * (.scratch/agy-dump.jsonl), not inferred from docs.
 *
 * Zero dependencies. Run: node scripts/antigravity-hook.test.mjs
 * Exit 0 = every expectation holds. Exit 1 = adapter drift or a gap.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = join(ROOT, 'veto-hooks', 'antigravity', 'hook.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

if (!existsSync(ADAPTER)) {
  check('adapter exists at veto-hooks/antigravity/hook.mjs', false, ADAPTER);
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

// --- transformPayload: agy camelCase -> gate shape --------------------------

{
  const p = transformPayload({
    hookEventName: 'PreToolUse',
    toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m x', WaitMsBeforeAsync: 5000 }, id: 'call_1' },
    conversationId: 'conv-1', transcriptPath: '/t.jsonl', cwd: '/proj',
  }).payload;
  check('hookEventName -> hook_event_name', p.hook_event_name === 'PreToolUse');
  check('run_command -> bash (SHELL_TOOLS door for the evidence recorder)', p.tool_name === 'bash');
  check('native tool name kept for the log', p.harness_tool === 'run_command');
  check('args.CommandLine -> tool_input.command', p.tool_input.command === 'git commit -m x');
  check('conversationId -> session_id', p.session_id === 'conv-1');
  check('transcriptPath -> transcript_path', p.transcript_path === '/t.jsonl');
  check('cwd carried through', p.cwd === '/proj');
}

{
  // Write-tool mapping: agy's TargetFile must reach the ledger guard — a
  // write_to_file aimed at .trust/progress.txt is gated by the LEDGER_WRITE_TOOLS
  // set, which only fires on recognized names + a file_path arg.
  const w = transformPayload({
    hookEventName: 'PreToolUse',
    toolCall: { name: 'write_to_file', args: { TargetFile: '.trust/progress.txt', CodeContent: 'x' } },
    cwd: '/p',
  }).payload;
  check('write_to_file -> write', w.tool_name === 'write');
  check('TargetFile -> file_path', w.tool_input.file_path === '.trust/progress.txt');
  const m = transformPayload({
    hookEventName: 'PreToolUse',
    toolCall: { name: 'multi_replace_file_content', args: { TargetFiles: [{ TargetFile: 'a.md' }, { TargetFile: '.trust/progress.txt' }] } },
    cwd: '/p',
  }).payload;
  check('multi_replace -> multiedit, ledger target surfaces', m.tool_name === 'multiedit' && m.tool_input.file_path === '.trust/progress.txt');
}

{
  // A missing cwd means gate-hook's evidence verdict returns null — fail-open
  // — so the adapter injects the resolved project dir, never overwriting a
  // real one (same doctrine as veto-hooks/devin cwd fix).
  const p = transformPayload({ hookEventName: 'PreToolUse', toolCall: { name: 'run_command', args: { CommandLine: 'ls' } } }).payload;
  check('payload gains cwd when agy sends none', typeof p.cwd === 'string' && p.cwd.length > 0);
  const kept = transformPayload({ hookEventName: 'PreToolUse', toolCall: { name: 'x', args: {} }, cwd: '/real/dir' }).payload;
  check('an explicit payload.cwd is never overwritten', kept.cwd === '/real/dir');
}

{
  const ok = transformPayload({ hookEventName: 'PostToolUse', toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } }, error: '', cwd: '/p' }).payload;
  check('PostToolUse empty error -> exitCode 0', ok.tool_response && ok.tool_response.exitCode === 0);
  const bad = transformPayload({ hookEventName: 'PostToolUse', toolCall: { name: 'run_command', args: { CommandLine: 'false' } }, error: 'exit 1', cwd: '/p' }).payload;
  check('PostToolUse error -> exitCode 1 + error kept', bad.tool_response.exitCode === 1 && bad.tool_response.error === 'exit 1');
}

// --- translateChildOutput: gate deny -> agy decision -------------------------

{
  const deny = JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r1',
  } });
  const t = translateChildOutput(deny, 0, 'PreToolUse');
  const out = JSON.parse(t.stdout);
  check('permissionDecision deny -> decision deny + reason', out.decision === 'deny' && out.reason === 'r1');

  // agy reads an absent/garbled decision as a deny — measured live. A hook
  // with nothing to say must still print an explicit allow, or every tool
  // call freezes behind a silent veto.
  const quiet = translateChildOutput('', 0, 'PreToolUse');
  check('silent child on PreToolUse still emits decision allow', JSON.parse(quiet.stdout).decision === 'allow');
  const quietPost = translateChildOutput('', 0, 'PostToolUse');
  check('silent child on PostToolUse emits {} (proven shape)', quietPost.stdout.trim() === '{}');
  const crashed = translateChildOutput('', 1, 'PreToolUse');
  check('crashed child on PreToolUse fails OPEN via explicit allow', JSON.parse(crashed.stdout).decision === 'allow' && crashed.code === 0);
}

// --- end-to-end against a fake project --------------------------------------

const project = mkdtempSync(join(tmpdir(), 'agy-hook-project-'));
try {
  // A bare project (no .trust ledger/stamp): the evidence precondition owns
  // the deny — a commit must surface as decision deny, a benign echo as allow.
  const blocked = run({
    hookEventName: 'PreToolUse',
    toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m x' } },
    cwd: project,
  }, { cwd: project });
  const bOut = JSON.parse(blocked.stdout || '{}');
  check('e2e: commit without evidence -> decision deny', blocked.status === 0 && bOut.decision === 'deny',
    `status=${blocked.status} out=${blocked.stdout.slice(0, 200)}`);

  const benign = run({
    hookEventName: 'PreToolUse',
    toolCall: { name: 'run_command', args: { CommandLine: 'echo hi' } },
    cwd: project,
  }, { cwd: project });
  const nOut = JSON.parse(benign.stdout || '{}');
  check('e2e: benign echo -> decision allow (never silent)', benign.status === 0 && nOut.decision === 'allow',
    `status=${benign.status} out=${benign.stdout.slice(0, 200)}`);

  const garbage = spawnSync(process.execPath, [ADAPTER], { input: 'not json', encoding: 'utf8', cwd: project, timeout: 20000 });
  check('unparsable stdin fails OPEN via explicit allow', garbage.status === 0 && JSON.parse(garbage.stdout || '{}').decision === 'allow',
    `status=${garbage.status} out=${String(garbage.stdout).slice(0, 120)}`);
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL EXPECTATIONS HOLD' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
