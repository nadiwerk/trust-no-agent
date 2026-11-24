#!/usr/bin/env node
/**
 * Antigravity CLI (agy) hook adapter — runs the repo's gate-hook under agy
 * hooks.
 *
 * agy fires camelCase events (hookEventName) with the tool call nested as
 * toolCall.{name,args} and the shell command under args.CommandLine. Its deny
 * contract is {"decision":"deny","reason":...} — and unlike Devin, agy fails
 * CLOSED: an empty, malformed, or crashed hook output is read as a deny
 * (measured live 2026-11-24 on agy 1.5.14: a probe printing {} blocked echo;
 * a broken exit-1 global hook blocked every tool call). This adapter
 * therefore ALWAYS prints an explicit decision on PreToolUse — allow
 * included — and {} on other events (the shape proven live).
 *
 * Contract: FAIL-OPEN. Unparsable stdin, missing target script, child crash
 * or timeout all print an explicit allow and exit 0. Only a real gate verdict
 * denies.
 *
 * Wiring (project's .agents/hooks.json or global ~/.gemini/config/hooks.json):
 *   "tna-veto": {
 *     "PreToolUse":  [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node <abs>/veto-hooks/antigravity/hook.mjs", "timeout": 20 }] }],
 *     "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node <abs>/veto-hooks/antigravity/hook.mjs", "timeout": 20 }] }]
 *   }
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TNA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(TNA, 'plugin', 'scripts', 'gate-hook.mjs');
const CHILD_TIMEOUT_MS = 20000;

function clonePayload(payload) {
  try { return JSON.parse(JSON.stringify(payload ?? {})); } catch { return {}; }
}

// Gate-recognized names (action-gate SHELL_TOOLS / LEDGER_WRITE_TOOLS). The
// native name survives in payload.harness_tool for the veto log — mapped
// names are what classifyAction and observeAfter key on, so a test run
// through run_command records evidence instead of vanishing (the same
// fail-open hole Devin's unmapped `exec` has).
const TOOL_MAP = {
  run_command: 'bash',
  write_to_file: 'write',
  replace_file_content: 'edit',
  multi_replace_file_content: 'multiedit',
};

function isLedgerPath(p) {
  const n = String(p ?? '').replace(/\\/g, '/').toLowerCase();
  return n === '.trust/progress.txt' || n.endsWith('/.trust/progress.txt');
}

/** Pure: the payload the gate should see on stdin. */
export function transformPayload(payload) {
  const a = clonePayload(payload);
  const p = { ...a };
  if (typeof a.hookEventName === 'string') p.hook_event_name = a.hookEventName;
  const call = a.toolCall && typeof a.toolCall === 'object' ? a.toolCall : null;
  if (call) {
    const name = String(call.name ?? '');
    p.tool_name = TOOL_MAP[name] ?? name;
    if (TOOL_MAP[name]) p.harness_tool = name;
    const args = call.args && typeof call.args === 'object' ? { ...call.args } : {};
    if (args.command === undefined && typeof args.CommandLine === 'string') args.command = args.CommandLine;
    if (args.file_path === undefined && typeof args.TargetFile === 'string') args.file_path = args.TargetFile;
    if (args.file_path === undefined && Array.isArray(args.TargetFiles)) {
      // Multi-target writes surface ONE file_path to the ledger guard — pick
      // the dangerous target if the ledger is among them, else the first.
      const targets = args.TargetFiles.map((t) => t?.TargetFile).filter(Boolean);
      args.file_path = targets.find(isLedgerPath) ?? targets[0];
    }
    p.tool_input = args;
    delete p.toolCall;
  }
  if (typeof a.conversationId === 'string') p.session_id = a.conversationId;
  if (typeof a.transcriptPath === 'string') p.transcript_path = a.transcriptPath;
  if (typeof p.cwd !== 'string' || !p.cwd) p.cwd = process.cwd();
  if (p.hook_event_name === 'PostToolUse' && !p.tool_response) {
    const error = typeof a.error === 'string' && a.error ? a.error : null;
    p.tool_response = { error, exitCode: error ? 1 : 0 };
  }
  return { payload: p };
}

/**
 * Pure: rewrites the gate's Claude deny shape into agy's decision contract.
 * agy treats a missing decision as a deny, so a child with nothing to say on
 * PreToolUse still produces {"decision":"allow"}; other events emit {} (the
 * shape proven live on agy 1.5.14).
 */
export function translateChildOutput(stdout, code, hookEventName) {
  const text = String(stdout ?? '').trim();
  if (code === 0 && text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      if (obj?.hookSpecificOutput?.permissionDecision === 'deny') {
        const reason = String(obj.hookSpecificOutput.permissionDecisionReason ?? 'denied by policy');
        return { stdout: JSON.stringify({ decision: 'deny', reason }) + '\n', code: 0 };
      }
    } catch { /* fall through to the event default */ }
  }
  // No verdict: explicit allow on PreToolUse, {} elsewhere.
  return { stdout: (hookEventName === 'PreToolUse' ? JSON.stringify({ decision: 'allow' }) : '{}') + '\n', code: 0 };
}

function run(rawStdin, hookEventName) {
  if (!existsSync(GATE)) {
    return translateChildOutput('', 0, hookEventName); // missing target: allow
  }
  let payload = {};
  try { payload = rawStdin.trim() ? JSON.parse(rawStdin) : {}; } catch { payload = {}; }
  const input = JSON.stringify(transformPayload(payload).payload);
  const r = spawnSync(process.execPath, [GATE], {
    input, cwd: resolve(process.cwd()), env: process.env, encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS, shell: false, windowsHide: true,
  });
  if (r.error) return translateChildOutput('', 0, hookEventName);
  return translateChildOutput(r.stdout ?? '', r.status ?? 0, hookEventName);
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { raw = ''; }
  let event = 'PreToolUse';
  try { event = String(JSON.parse(raw).hookEventName || 'PreToolUse'); } catch { /* default */ }
  const r = run(raw, event);
  if (r.stdout) process.stdout.write(r.stdout);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main()); } catch {
    // Last resort: never fail closed — an uncaught adapter error must not
    // freeze the harness's tool calls.
    try { process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n'); } catch { /* nothing */ }
    process.exit(0);
  }
}
