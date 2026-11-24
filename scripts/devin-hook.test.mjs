#!/usr/bin/env node
/**
 * Fail-first test for veto-hooks/devin/hook.mjs — the Devin hook adapter.
 *
 * Devin fires the Claude Code lifecycle events with its own tool names
 * (exec/edit/write/run_subagent), its own tool_response shape
 * ({success, output, error}) and its own deny contract (top-level
 * {"decision":"block"} or exit 2; hookSpecificOutput.permissionDecision is
 * ignored). Without the adapter every gate fires and is silently ignored.
 *
 * The project is DEVIN_PROJECT_DIR (or cwd), never the adapter's own location:
 * the adapter lives here and is called from a sibling project checkout.
 *
 * Zero dependencies. Run: node scripts/devin-hook.test.mjs
 * Exit 0 = every expectation holds. Exit 1 = adapter drift or a gap.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = join(ROOT, 'veto-hooks', 'devin', 'hook.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

if (!existsSync(ADAPTER)) {
  check('adapter exists at veto-hooks/devin/hook.mjs', false, ADAPTER);
  console.log('\n1 FAILURE(S)');
  process.exit(1);
}

const { transformPayload, translateChildOutput, TARGETS } = await import(pathToFileURL(ADAPTER).href);

const run = (target, payload, { cwd, env = {} }) => spawnSync(process.execPath, [ADAPTER, target], {
  input: JSON.stringify(payload),
  encoding: 'utf8',
  cwd,
  env: { ...process.env, DEVIN_PROJECT_DIR: '', ...env },
  timeout: 20000,
});

// --- transformPayload: Devin -> Claude shape -------------------------------

{
  const p = transformPayload('orchestrator-brief', {
    hook_event_name: 'PreToolUse', tool_name: 'run_subagent',
    tool_input: { task: 'do X', title: 't', profile: 'subagent_general' }, session_id: 's1',
  }).payload;
  check('run_subagent -> Agent', p.tool_name === 'Agent');
  check('task -> prompt, title -> description', p.tool_input.prompt === 'do X' && p.tool_input.description === 't');
  check('session_id preserved', p.session_id === 's1');
}

{
  const tr = transformPayload('gate-hook', {
    hook_event_name: 'PostToolUse', tool_name: 'exec', tool_input: { command: 'npm test' },
    tool_response: { success: true, output: '2 passed', error: null },
  }).payload.tool_response;
  check('PostToolUse output -> stdout', tr.stdout === '2 passed');
  check('PostToolUse success -> exitCode 0', tr.exitCode === 0);
  const fail = transformPayload('gate-hook', {
    hook_event_name: 'PostToolUse', tool_name: 'exec', tool_input: { command: 'false' },
    tool_response: { success: false, output: '', error: 'exit 1' },
  }).payload.tool_response;
  check('PostToolUse failure -> exitCode 1, error kept', fail.exitCode === 1 && fail.error === 'exit 1');
}

{
  const p = transformPayload('impeccable', { hook_event_name: 'PostToolUse', tool_name: 'edit' }).payload;
  check('impeccable gets Claude tool casing', p.tool_name === 'Edit');
}

{
  // Devin's live PreToolUse payload carries NO cwd field (measured 2026-11-24:
  // live denials left no gate-log entries, and a real commit into an
  // evidence-less target landed). gate-hook's evidence verdict returns null
  // without payload.cwd, so the adapter must inject the resolved PROJECT.
  const p = transformPayload('gate-hook', {
    hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' },
  }).payload;
  check('gate-hook payload gains cwd when Devin sends none', typeof p.cwd === 'string' && p.cwd.length > 0);
  const kept = transformPayload('gate-hook', {
    hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: '/real/session/dir',
  }).payload;
  check('an explicit payload.cwd is never overwritten', kept.cwd === '/real/session/dir');
}

// --- translateChildOutput: Claude deny -> Devin block -----------------------

{
  const deny = JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r1',
  } });
  const t = translateChildOutput(deny, 0);
  check('permissionDecision deny -> decision block + reason', JSON.parse(t.stdout).decision === 'block' && JSON.parse(t.stdout).reason === 'r1');
  const ctx = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'floor' } });
  check('additionalContext passes through', translateChildOutput(ctx, 0).stdout === ctx);
  check('non-JSON passes through', translateChildOutput('plain', 0).stdout === 'plain');
  check('child exit 2 stays a block', translateChildOutput('', 2).code === 2);
}

// --- target resolution -------------------------------------------------------

check('gate-hook resolves inside this repo', TARGETS['gate-hook'].argv[1] === join(ROOT, 'plugin', 'scripts', 'gate-hook.mjs'));
check('reinject resolves inside this repo', TARGETS.reinject.argv[1] === join(ROOT, 'scripts', 'reinject.mjs'));
for (const name of ['orchestrator-brief', 'gate-hook', 'sentinel', 'impeccable', 'task-state', 'restore', 'jev-guard', 'reinject']) {
  check(`target registered: ${name}`, Boolean(TARGETS[name]));
}

// --- end-to-end against a fake project ------------------------------------

const project = mkdtempSync(join(tmpdir(), 'devin-hook-project-'));
const other = mkdtempSync(join(tmpdir(), 'devin-hook-cwd-'));
try {
  mkdirSync(join(project, 'scripts'), { recursive: true });
  writeFileSync(join(project, 'scripts', 'orchestrator-brief.mjs'), `
let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const p = JSON.parse(s);
  if (p.tool_name === 'Agent' && !p.tool_input.prompt.includes('Repo rules:')) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
      permissionDecision: 'deny', permissionDecisionReason: 'brief missing discipline block' } }));
  }
});
`);
  const brief = { hook_event_name: 'PreToolUse', tool_name: 'run_subagent', tool_input: { task: 'just do it', title: 'x' } };

  const viaEnv = run('orchestrator-brief', brief, { cwd: other, env: { DEVIN_PROJECT_DIR: project } });
  check('e2e: project from DEVIN_PROJECT_DIR, deny becomes decision block',
    viaEnv.status === 0 && viaEnv.stdout.includes('"decision":"block"'), `status=${viaEnv.status} out=${viaEnv.stdout.slice(0, 160)}`);

  const viaCwd = run('orchestrator-brief', brief, { cwd: project });
  check('e2e: project falls back to cwd', viaCwd.stdout.includes('"decision":"block"'), `out=${viaCwd.stdout.slice(0, 160)}`);

  const ok = run('orchestrator-brief', { ...brief, tool_input: { task: 'Repo rules: ...', title: 'x' } }, { cwd: project });
  check('e2e: compliant brief is allowed', ok.status === 0 && !ok.stdout.includes('block'));

  // Interpreters exit 2 on a missing script and Devin reads exit 2 as a veto,
  // so an absent project target must be skipped, never spawned.
  for (const target of ['restore', 'sentinel', 'task-state', 'impeccable', 'jev-guard']) {
    const r = run(target, { hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'ls' } }, { cwd: project });
    check(`missing project target fails open: ${target}`, r.status === 0 && !r.stdout.includes('block'),
      `status=${r.status} out=${r.stdout.slice(0, 120)}`);
  }

  const unknown = run('no-such-target', {}, { cwd: project });
  check('unknown target fails open', unknown.status === 0 && unknown.stdout === '');

  // Evidence arm end-to-end: a bare project (no ledger, no state, no stamp)
  // sends the payload shape Devin really sends — no cwd. The receipt rule
  // owns only ledgered repos, so the deny must come from the missing
  // fresh-evidence precondition.
  const blocked = run('gate-hook', {
    hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' },
  }, { cwd: project });
  check('e2e: evidence arm denies a commit without fresh evidence (no payload.cwd)',
    blocked.status === 0 && blocked.stdout.includes('"decision":"block"') && blocked.stdout.includes('fresh test evidence'),
    `status=${blocked.status} out=${blocked.stdout.slice(0, 200)}`);

  const re = run('reinject', { hook_event_name: 'SessionStart' }, { cwd: project });
  let ctx = null;
  try { ctx = JSON.parse(re.stdout).hookSpecificOutput; } catch { /* reported below */ }
  check('reinject output wrapped as additionalContext', re.status === 0 && ctx?.hookEventName === 'SessionStart' && ctx.additionalContext.length > 0,
    `status=${re.status} out=${re.stdout.slice(0, 120)}`);
} finally {
  rmSync(project, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL EXPECTATIONS HOLD' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
