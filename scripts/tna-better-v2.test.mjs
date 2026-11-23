#!/usr/bin/env node
/**
 * Fail-first test: OpenCode-backed improvements over Claude Code (2026-11-17).
 *
 * 1. restore: Claude restores a missing file from a snapshot that may be older
 *    than HEAD. OpenCode prefers HEAD (authoritative) and audits EVERY verdict.
 * 2. /output-trim: Claude has on/off only. OpenCode adds `status` reading the real
 *    savings stats — an extra capability, not just parity.
 *
 * Run: node scripts/tna-better-v2.test.mjs (exit 0 = green)
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const plug = (n) => new URL(`../.opencode/plugins/tna-gate/${n}`, import.meta.url);
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const mod = await import(plug('restore-guard.mjs')).catch(() => null);
check('R0 restore-guard module exports restorePlan', !!mod && typeof mod.restorePlan === 'function');
if (mod && typeof mod.restorePlan === 'function') {
  const p1 = mod.restorePlan({ disk: null, head: 'HEAD content', snapshot: 'old snapshot' });
  check('R1 missing file is restored from HEAD, not a stale snapshot', p1.action === 'restored' && p1.content === 'HEAD content' && p1.target === 'disk', JSON.stringify(p1));
  const p2 = mod.restorePlan({ disk: null, head: null, snapshot: 'snapshot' });
  check('R2 snapshot is the fallback when HEAD is unavailable', p2.content === 'snapshot' && p2.target === 'disk', JSON.stringify(p2));
  const p3 = mod.restorePlan({ disk: 'wip', head: 'committed', snapshot: 'committed' });
  check('R3 dirty disk is never written', p3.action === 'warn' && p3.content === null, JSON.stringify(p3));
  const p4 = mod.restorePlan({ disk: 'fresh', head: 'fresh', snapshot: 'stale' });
  check('R4 stale snapshot is refreshed from disk', p4.action === 'refreshed' && p4.content === 'fresh' && p4.target === 'snapshot', JSON.stringify(p4));
}

// Integration: real git repo, deleted tracked file, stale snapshot.
const { default: plugin } = await import(plug('index.js'));
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-restore-git-'));
  mkdirSync(join(dir, '.trust', 'keep'), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), 'HEAD version\n');
  writeFileSync(join(dir, '.trust', 'keep', 'AGENTS.md'), 'STALE snapshot\n');
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', 'AGENTS.md'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  } catch {
    console.log('SKIP - git init failed, R5 not judged');
  }
  const { unlinkSync } = await import('node:fs');
  unlinkSync(join(dir, 'AGENTS.md'));
  const events = [{ type: 'session.created', data: { sessionID: 'ses_restore_git' } }];
  await plugin.setup({
    location: { directory: dir },
    storage: { get: async () => undefined, set: async () => {} },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    event: { subscribe: () => (async function* () { for (const e of events) yield e; })() },
    session: { hook: async () => ({ dispose: async () => {} }), list: async () => ({ data: [] }) },
  });
  await new Promise((r) => setTimeout(r, 1200));
  let restored;
  try { restored = readFileSync(join(dir, 'AGENTS.md'), 'utf8'); } catch {}
  check('R5 real missing file is restored from HEAD bytes', restored === 'HEAD version\n', JSON.stringify(restored));
  const logPath = join(dir, '.trust', 'tna-gate-log.jsonl');
  let audit = '';
  try { audit = readFileSync(logPath, 'utf8'); } catch {}
  check('R6 restore verdict is audited', /opencode-v2-restore/.test(audit) && /restored/.test(audit), audit.slice(-200));
}

// Command registration: /output-trim with on/off/status.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-output-trim-cmd-'));
  const flagPath = join(dir, '.output-trim-active');
  process.env.OUTPUT_TRIM_FLAG_PATH = flagPath;
  writeFileSync(join(dir, 'output-trim-stats.json'), JSON.stringify({ savedChars: 4321, events: 2 }));
  process.env.OUTPUT_TRIM_STATE_DIR = dir;
  let registered = [];
  let promptText = '';
  const fakeCtx = {
    location: { directory: dir },
    storage: { get: async () => undefined, set: async () => {} },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    event: { subscribe: () => (async function* () {})() },
    command: { transform: async (fn) => { fn({ add: (c) => registered.push(c) }); return { dispose: async () => {} }; } },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      list: async () => ({ data: [] }),
      prompt: async (p) => { promptText = p.text; },
    },
  };
  await plugin.setup(fakeCtx);
  const cmd = registered.find((c) => c.name === 'output-trim');
  check('C1 plugin registers a /output-trim command', !!cmd, JSON.stringify(registered.map((c) => c.name)));
  if (cmd) {
    await cmd.execute({ sessionID: 'ses1', prompt: { text: 'off' }, delivery: 'steer' });
    check('C2 /output-trim off writes the flag file', readFileSync(flagPath, 'utf8') === 'off');
    await cmd.execute({ sessionID: 'ses1', prompt: { text: 'status' }, delivery: 'steer' });
    check('C3 /output-trim status reports real savings (better than Claude)', /4321/.test(promptText), promptText.slice(0, 160));
    await cmd.execute({ sessionID: 'ses1', prompt: { text: 'on' }, delivery: 'steer' });
    check('C4 /output-trim on restores the flag', readFileSync(flagPath, 'utf8') === 'on');
  }
  delete process.env.OUTPUT_TRIM_FLAG_PATH;
  delete process.env.OUTPUT_TRIM_STATE_DIR;
}

console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
