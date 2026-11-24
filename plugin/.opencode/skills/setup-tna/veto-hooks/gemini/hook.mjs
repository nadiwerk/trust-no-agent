#!/usr/bin/env node
/**
 * Gemini CLI hook adapter — runs the repo's gate-hook under gemini hooks.
 *
 * Gemini CLI already speaks snake_case (hook_event_name, tool_name,
 * tool_input, session_id, transcript_path, cwd). The transform is an
 * event-name rename — BeforeTool -> PreToolUse, AfterTool -> PostToolUse —
 * plus tool_response normalization so the evidence recorder sees exitCode.
 * The deny contract is {"decision":"deny","reason":...} (or exit 2 + stderr);
 * empty stdout + exit 0 is a normal allow, so the pass path stays silent.
 *
 * Contract: FAIL-OPEN. Unparsable stdin, missing target script, child crash
 * or timeout all exit 0 silently. Only a real gate verdict denies.
 *
 * Wiring (project's .gemini/settings.json or global ~/.gemini/settings.json):
 *   "hooks": {
 *     "BeforeTool": [{ "hooks": [{ "type": "command", "command": "node <abs>/veto-hooks/gemini/hook.mjs", "timeout": 20000 }] }],
 *     "AfterTool":  [{ "hooks": [{ "type": "command", "command": "node <abs>/veto-hooks/gemini/hook.mjs", "timeout": 20000 }] }]
 *   }
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TNA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(TNA, 'plugin', 'scripts', 'gate-hook.mjs');
const CHILD_TIMEOUT_MS = 20000;

const EVENT_MAP = { BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse' };

// Gate-recognized names (action-gate SHELL_TOOLS / LEDGER_WRITE_TOOLS) — a
// test run through run_shell_command must record evidence, and a write_file
// at the ledger must reach the append-only guard. Native name kept in
// payload.harness_tool for the veto log.
const TOOL_MAP = { run_shell_command: 'bash', write_file: 'write', replace: 'edit' };

function clonePayload(payload) {
  try { return JSON.parse(JSON.stringify(payload ?? {})); } catch { return {}; }
}

/** Pure: the payload the gate should see on stdin. */
export function transformPayload(payload) {
  const p = clonePayload(payload);
  if (EVENT_MAP[p.hook_event_name]) p.hook_event_name = EVENT_MAP[p.hook_event_name];
  if (TOOL_MAP[p.tool_name]) {
    p.harness_tool = p.tool_name;
    p.tool_name = TOOL_MAP[p.tool_name];
  }
  if (typeof p.cwd !== 'string' || !p.cwd) p.cwd = process.cwd();
  if (p.hook_event_name === 'PostToolUse' && p.tool_response && typeof p.tool_response === 'object') {
    const tr = { ...p.tool_response };
    if (typeof tr.output === 'string' && tr.stdout === undefined) tr.stdout = tr.output;
    if (tr.exitCode === undefined) tr.exitCode = tr.error ? 1 : 0;
    p.tool_response = tr;
  }
  return { payload: p };
}

/** Pure: rewrites the gate's Claude deny shape into gemini's decision contract. */
export function translateChildOutput(stdout, code) {
  const text = String(stdout ?? '').trim();
  if (code === 0 && text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      if (obj?.hookSpecificOutput?.permissionDecision === 'deny') {
        const reason = String(obj.hookSpecificOutput.permissionDecisionReason ?? 'denied by policy');
        return { stdout: JSON.stringify({ decision: 'deny', reason }) + '\n', code: 0 };
      }
    } catch { /* fall through to silent allow */ }
  }
  return { stdout: '', code: 0 };
}

function run(rawStdin) {
  if (!existsSync(GATE)) return { stdout: '', code: 0 };
  let payload = {};
  try { payload = rawStdin.trim() ? JSON.parse(rawStdin) : {}; } catch { payload = {}; }
  const input = JSON.stringify(transformPayload(payload).payload);
  const r = spawnSync(process.execPath, [GATE], {
    input, cwd: resolve(process.cwd()), env: process.env, encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS, shell: false, windowsHide: true,
  });
  if (r.error) return { stdout: '', code: 0 };
  return translateChildOutput(r.stdout ?? '', r.status ?? 0);
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { raw = ''; }
  const r = run(raw);
  if (r.stdout) process.stdout.write(r.stdout);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main()); } catch { process.exit(0); }
}
