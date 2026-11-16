#!/usr/bin/env node
/**
 * Devin hook adapter — runs the repo's Claude-format gates under Devin hooks.
 *
 * Devin fires the same lifecycle events as Claude Code but with its own tool
 * names (exec/edit/write/run_subagent), a {success, output, error}
 * tool_response, and a different deny contract: top-level
 * {"decision":"block"} or exit 2. It ignores
 * hookSpecificOutput.permissionDecision, so without this adapter a veto prints
 * JSON and the action goes through.
 *
 * Contract: FAIL-OPEN. Unknown target, missing target script, unparsable
 * stdin, child crash or timeout all exit 0. Only a real gate verdict blocks.
 *
 * Wiring (project's .devin/hooks.v1.json, trust-no-agent as a sibling checkout):
 *   node "${DEVIN_PROJECT_DIR:-.}/../trust-no-agent/veto-hooks/devin/hook.mjs" <target>
 *
 * The project is DEVIN_PROJECT_DIR, else cwd. gate-hook and reinject resolve
 * inside this repo; the other targets are project-owned scripts and are
 * skipped when the project does not ship them.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TNA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT = resolve(process.env.DEVIN_PROJECT_DIR || process.cwd());
const CHILD_TIMEOUT_MS = 20000;

// On Windows the hook runner's PATH often lacks sh/python; prefer explicit
// overrides and the standard install paths, else the bare name.
function firstExisting(candidates) {
  return candidates.find((c) => c && existsSync(c)) ?? candidates[candidates.length - 1];
}
const SH_EXE = firstExisting([
  process.env.DEVIN_SH_EXE,
  'C:/Program Files/Git/bin/sh.exe',
  'C:/Program Files/Git/usr/bin/sh.exe',
  'sh',
]);
const PYTHON_EXE = firstExisting([
  process.env.DEVIN_PYTHON_EXE,
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Programs/Python/Python311/python.exe`,
  'python',
]);

const CLAUDE_TOOL = {
  exec: 'Bash', get_output: 'Bash', write_to_process: 'Bash', kill_shell: 'Bash',
  edit: 'Edit', write: 'Write', apply_patch: 'Edit', notebook_edit: 'NotebookEdit', notebook_read: 'Read',
  read: 'Read', grep: 'Grep', glob: 'Glob', webfetch: 'WebFetch', web_search: 'WebSearch',
  run_subagent: 'Agent', read_subagent: 'Task', skill: 'Skill', todo_write: 'TodoWrite',
  ask_user_question: 'AskUserQuestion', request_scope: 'RequestScope',
};

function clonePayload(payload) {
  try { return JSON.parse(JSON.stringify(payload ?? {})); } catch { return {}; }
}

/** Pure: the payload the child gate should see on stdin. */
export function transformPayload(target, payload) {
  const p = clonePayload(payload);
  if (target === 'orchestrator-brief' && p.tool_name === 'run_subagent') {
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
    p.tool_name = 'Agent';
    p.tool_input = {
      ...input,
      prompt: typeof input.task === 'string' ? input.task : '',
      description: typeof input.title === 'string' ? input.title : '',
    };
  } else if (target === 'gate-hook' && p.hook_event_name === 'PostToolUse'
    && p.tool_response && typeof p.tool_response === 'object') {
    const tr = { ...p.tool_response };
    if (typeof tr.output === 'string' && tr.stdout === undefined) tr.stdout = tr.output;
    if (tr.exitCode === undefined && typeof tr.success === 'boolean') tr.exitCode = tr.success ? 0 : 1;
    p.tool_response = tr;
  } else if (target === 'impeccable' && typeof p.tool_name === 'string') {
    p.tool_name = CLAUDE_TOOL[p.tool_name] ?? p.tool_name;
  }
  return { payload: p };
}

/** Pure: rewrites the Claude/Codex deny shape into Devin's block contract. */
export function translateChildOutput(stdout, code) {
  if (code !== 0) return { stdout, code };
  const text = String(stdout ?? '').trim();
  if (!text.startsWith('{')) return { stdout, code };
  let obj;
  try { obj = JSON.parse(text); } catch { return { stdout, code }; }
  const hso = obj?.hookSpecificOutput;
  if (hso?.permissionDecision === 'deny') {
    const reason = String(hso.permissionDecisionReason ?? 'denied by policy');
    return { stdout: JSON.stringify({ decision: 'block', reason }) + '\n', code: 0 };
  }
  return { stdout, code };
}

export const TARGETS = Object.freeze({
  'gate-hook': { argv: [process.execPath, join(TNA, 'plugin', 'scripts', 'gate-hook.mjs')], stdin: 'payload' },
  'reinject': { argv: [process.execPath, join(TNA, 'scripts', 'reinject.mjs')], stdin: 'none', wrapContext: true },
  'orchestrator-brief': {
    argv: [process.execPath, join(PROJECT, 'scripts', 'orchestrator-brief.mjs'), '--pretool'], stdin: 'payload',
  },
  'sentinel': { argv: [process.execPath, join(PROJECT, 'scripts', 'sentinel-guard.mjs'), '--hook'], stdin: 'none' },
  'impeccable': {
    argv: [SH_EXE, join(PROJECT, '.claude', 'skills', 'impeccable', 'scripts', 'impeccable'), 'hook'], stdin: 'payload',
  },
  'task-state': { argv: [process.execPath, join(PROJECT, 'scripts', 'task-state-guard.mjs')], stdin: 'none' },
  'restore': { argv: [SH_EXE, join(PROJECT, 'scripts', 'restore-tooling.sh')], stdin: 'none' },
  'jev-guard': { argv: [PYTHON_EXE, join(PROJECT, '.devin', 'scripts', 'jev-guard.py')], stdin: 'payload' },
});

function runTarget(target, rawStdin) {
  const def = TARGETS[target];
  if (!def) return { code: 0, stdout: '', stderr: '' };
  // `sh`/`python` exit 2 on a missing script and Devin reads exit 2 as a veto.
  if (!existsSync(def.argv[1])) {
    return { code: 0, stdout: '', stderr: `[devin-hook] ${target}: target missing, skipped: ${def.argv[1]}\n` };
  }

  let payload = {};
  try { payload = rawStdin.trim() ? JSON.parse(rawStdin) : {}; } catch { payload = {}; }
  const input = def.stdin === 'payload' ? JSON.stringify(transformPayload(target, payload).payload) : '';

  const r = spawnSync(def.argv[0], def.argv.slice(1), {
    input, cwd: PROJECT, env: process.env, encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS, shell: false, windowsHide: true,
  });
  if (r.error) return { code: 0, stdout: '', stderr: `[devin-hook] ${target}: ${r.error.message}\n` };

  const stdout = r.stdout ?? '';
  if (def.wrapContext) {
    const hookEventName = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'SessionStart';
    const text = stdout.trim();
    return {
      code: 0,
      stdout: text ? JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } }) + '\n' : '',
      stderr: r.stderr ?? '',
    };
  }
  const t = translateChildOutput(stdout, r.status ?? 0);
  return { code: t.code, stdout: t.stdout, stderr: r.stderr ?? '' };
}

function main() {
  const target = process.argv[2];
  if (!target) return 0;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { raw = ''; }
  const r = runTarget(target, raw);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code === 2 ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main()); } catch { process.exit(0); }
}
