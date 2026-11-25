#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugin');
let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}: ${detail}`); }
};

function matches(matcher, tool) {
  return !matcher || matcher === '*' || new RegExp(`^(?:${matcher})$`).test(tool);
}

// Select and resolve the distributed registration, rather than invoking a
// hard-coded gate that an installed host might never call.
function dispatch(config, cwd, tool, input) {
  const hook = (config.hooks?.PreToolUse ?? [])
    .filter(group => matches(group.matcher, tool))
    .flatMap(group => group.hooks ?? [])
    .find(entry => /gate-hook\.mjs/.test(entry.command ?? ''));
  if (!hook) return { routed: false, status: null, stdout: '', stderr: 'no gate registration' };
  const command = /^node "([^"]+)"$/.exec(hook.command);
  if (!command) return { routed: true, status: null, stdout: '', stderr: 'unsupported command shape' };
  const script = command[1]
    .replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN)
    .replace('${PLUGIN_ROOT}', PLUGIN);
  const result = spawnSync(process.execPath, [script], {
    cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, APPDATA: cwd },
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd }),
  });
  return { routed: true, status: result.status, stdout: result.stdout ?? '',
    stderr: result.error?.message ?? result.stderr ?? '' };
}

function deniesLedger(result) {
  try {
    const verdict = JSON.parse(result.stdout).hookSpecificOutput;
    return result.routed && result.status === 0
      && verdict?.permissionDecision === 'deny'
      && /append-only/i.test(verdict.permissionDecisionReason ?? '');
  } catch { return false; }
}

const fixture = mkdtempSync(join(tmpdir(), 'tna-ledger-routing-'));
try {
  mkdirSync(join(fixture, '.trust'));
  writeFileSync(join(fixture, '.trust', 'progress.txt'), 'existing history\n');
  writeFileSync(join(fixture, '.trust', 'tna-gate-state.json'), JSON.stringify({
    testPassFresh: true, command: 'node check.test.mjs', updatedAt: new Date().toISOString(),
  }));
  for (const name of ['hooks.json', 'codex.hooks.json']) {
    const config = JSON.parse(readFileSync(join(PLUGIN, 'hooks', name), 'utf8'));
    for (const [tool, inputFor] of [
      ['Write', file_path => ({ file_path, content: 'replacement' })],
      ['Edit', file_path => ({ file_path, old_string: 'existing history', new_string: 'replacement' })],
    ]) {
      const denied = dispatch(config, fixture, tool, inputFor('.trust/progress.txt'));
      check(`${name} ${tool} ledger overwrite is routed and denied despite fresh evidence`,
        deniesLedger(denied), JSON.stringify(denied));
      const allowed = dispatch(config, fixture, tool, inputFor('src/domain.mjs'));
      check(`${name} ${tool} ordinary write remains allowed`,
        allowed.routed && allowed.status === 0 && allowed.stdout.trim() === '', JSON.stringify(allowed));
    }
    const appended = dispatch(config, fixture, 'Bash', { command: 'echo history >> .trust/progress.txt' });
    check(`${name} safe ledger append remains allowed`,
      appended.routed && appended.status === 0 && appended.stdout.trim() === '', JSON.stringify(appended));
    if (name === 'codex.hooks.json') {
      const patch = target => `*** Begin Patch\n*** Update File: ${target}\n@@\n-old\n+new\n*** End Patch`;
      const denied = dispatch(config, fixture, 'apply_patch', { command: patch('.trust/progress.txt') });
      check('Codex patch cannot overwrite the ledger', deniesLedger(denied), JSON.stringify(denied));
      const allowed = dispatch(config, fixture, 'apply_patch', { command: patch('src/domain.mjs') });
      check('Codex non-ledger patch remains allowed',
        allowed.routed && allowed.status === 0 && allowed.stdout.trim() === '', JSON.stringify(allowed));
    }
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL EXPECTATIONS HOLD');
process.exitCode = failures ? 1 : 0;
