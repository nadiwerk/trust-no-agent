#!/usr/bin/env node
/**
 * codex-reprobe.mjs — the mechanical re-probe for Codex's PostToolUse recorder.
 *
 * WHY THIS FILE EXISTS. docs/compatibility.md carries an open verdict: the
 * recorder was measured dead on codex-cli 0.163.0 (PostToolUse announced, never
 * spawned), and the re-probe on 0.166.0 was blocked because this machine has no
 * Codex credentials. An open verdict that depends on someone remembering the
 * exact probe shape is a verdict that never closes, so the shape lives here:
 * run this on any machine with a logged-in Codex and it returns an ANSWER, not
 * a retelling.
 *
 * WHAT IT MEASURES, and why each part is load-bearing:
 *   - a MARKER hook (`hook.mjs`) appends its own JSONL *before* answering, so
 *     "did the hook command execute" is provable independently of any output
 *     contract. A hook that is announced but never spawned writes no marker —
 *     that is exactly the 0.163.0 failure.
 *   - an ISOLATED `CODEX_HOME` inside a temp dir, so the probe cannot touch the
 *     operator's real hooks, trust store, or config.
 *   - a `probe.hooks.json` carrying BOTH PreToolUse and PostToolUse. PreToolUse
 *     is the CONTROL: if PreToolUse does not fire either, nothing was delivered
 *     and the PostToolUse result must not be read as "recorder broken".
 *
 * EXIT CODES (the verdict, machine-readable so CI or a human can trust it):
 *   0  PostToolUse SPAWNED the hook command  -> recorder works on this build
 *   1  PreToolUse fired but PostToolUse did not -> recorder broken (the wall)
 *   2  neither fired -> hooks never delivered; NOT a recorder verdict
 *   3  codex could not run (not logged in, missing binary) -> still unproven
 *   4  the harness could not be built (temp dir, write failure)
 *
 * Usage:
 *   node scripts/codex-reprobe.mjs                 # probe, then clean up
 *   node scripts/codex-reprobe.mjs --keep          # leave the scratch dir for inspection
 *   node scripts/codex-reprobe.mjs --json          # machine-readable result on stdout
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const JSON_OUT = args.includes('--json');

/** The marker hook: prove execution by side effect, never by output shape. */
const HOOK_JS = `import { appendFileSync } from 'node:fs';
let raw = '';
try { for await (const c of process.stdin) raw += c; } catch {}
let p = {};
try { p = JSON.parse(raw); } catch {}
appendFileSync(process.env.PROBE_LOG, JSON.stringify({
  ev: p.hook_event_name || p.event || '?',
  tool: p.tool_name || null,
  cmd: (p.tool_input && p.tool_input.command) || null,
}) + '\\n');
process.stdout.write('{}\\n');
process.exit(0);
`;

const buildHarness = () => {
  const root = mkdtempSync(join(tmpdir(), 'tna-codex-reprobe-'));
  const home = join(root, 'home');
  const work = join(root, 'work');
  const pluginDir = join(home, '.codex', 'plugins', 'tna-reprobe');
  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(work, { recursive: true });
  const log = join(root, 'probe.log');
  const hookPath = join(root, 'hook.mjs').replace(/\\/g, '/');
  writeFileSync(join(root, 'hook.mjs'), HOOK_JS);
  // Forward slashes are mandatory: a backslashed path inside JSON is eaten by
  // the parser (measured 2026-11-03 on Claude — the command became a mangled
  // single segment), which looks exactly like a hook that never ran.
  const hooks = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node ${hookPath}`, timeout: 20 }] }],
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node ${hookPath}`, timeout: 20 }] }],
    },
  };
  writeFileSync(join(pluginDir, 'probe.hooks.json'), `${JSON.stringify(hooks, null, 2)}\n`);
  writeFileSync(join(pluginDir, 'plugin.json'), `${JSON.stringify({
    name: 'tna-reprobe',
    version: '0.0.0',
    description: 'post-tool-use recorder probe (temp, deleted after the run)',
    hooks: ['./probe.hooks.json'],
  }, null, 2)}\n`);
  return { root, home, work, log, pluginDir };
};

const readMarkers = (log) => {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { ev: 'unparsable', raw: l }; }
  });
};

const finish = (code, verdict, detail, extra = {}) => {
  const payload = { verdict, detail, ...extra };
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else {
    process.stdout.write(`codex-reprobe: ${verdict}\n`);
    for (const line of detail.split('\n')) process.stdout.write(`  ${line}\n`);
  }
  process.exit(code);
};

const main = () => {
  const shell = process.platform === 'win32';
  const which = spawnSync('codex', ['--version'], { encoding: 'utf8', shell });
  if (which.status !== 0) {
    finish(3, 'UNPROVEN — codex binary not runnable', String(which.stderr || which.error || '').slice(0, 300));
  }
  const version = String(which.stdout || '').trim();

  // Credentials are checked BEFORE the probe, because an unauthenticated run
  // dies at the API call and produces zero hook activity — which would be
  // indistinguishable from "hooks never delivered" if we did not separate them.
  const status = spawnSync('codex', ['login', 'status'], { encoding: 'utf8', shell });
  const statusText = `${status.stdout || ''}${status.stderr || ''}`;
  if (/not logged in/i.test(statusText)) {
    finish(3, 'UNPROVEN — codex has no credentials on this machine',
      `codex ${version}; \`codex login status\` reports "Not logged in".\n`
      + 'This is an environment block, NOT a recorder verdict: nothing here says the\n'
      + 'recorder works or fails. Log in (or set CODEX_API_KEY) and re-run this script.', { version });
  }

  let h;
  try { h = buildHarness(); }
  catch (err) { finish(4, 'HARNESS BUILD FAILED', String(err && err.message)); }

  const run = spawnSync('codex', [
    'exec', '--skip-git-repo-check', '--dangerously-bypass-hook-trust',
    'Run exactly this one shell command: echo tna-reprobe-marker',
  ], {
    cwd: h.work,
    encoding: 'utf8',
    shell,
    env: { ...process.env, CODEX_HOME: h.home, PROBE_LOG: h.log },
    timeout: 180000,
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  const markers = readMarkers(h.log);
  const pre = markers.filter((m) => /^pre/i.test(String(m.ev)));
  const post = markers.filter((m) => /^post/i.test(String(m.ev)));
  const extra = {
    version,
    markers: markers.length,
    preToolUse: pre.length,
    postToolUse: post.length,
    kept: KEEP ? h.root : null,
  };
  if (!KEEP) rmSync(h.root, { recursive: true, force: true });

  if (post.length > 0) {
    finish(0, 'RECORDER WORKS — PostToolUse spawned the hook command on this build',
      `codex ${version}: PreToolUse fired ${pre.length}x, PostToolUse fired ${post.length}x.\n`
      + 'docs/compatibility.md known limit 3 can be re-measured; the explicit\n'
      + 'record-test-evidence.mjs door is no longer the ONLY way to open the gate.', extra);
  }
  if (pre.length > 0) {
    finish(1, 'RECORDER STILL BROKEN — PreToolUse fired, PostToolUse never spawned',
      `codex ${version}: PreToolUse fired ${pre.length}x, PostToolUse fired 0x.\n`
      + 'The 0.163.0 wall reproduces on this build: the gate can DENY but only the\n'
      + 'explicit `record-test-evidence.mjs` path can open it.', extra);
  }
  finish(2, 'UNPROVEN — neither hook fired; hooks were not delivered at all',
    `codex ${version}: 0 markers written.\n`
    + 'This is NOT a recorder verdict. The plugin was not registered or not trusted,\n'
    + 'so the probe never reached the code under test. Check the run output below.\n'
    + output.split('\n').slice(-12).join('\n'), extra);
};

main();
