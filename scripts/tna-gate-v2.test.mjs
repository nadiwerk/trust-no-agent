#!/usr/bin/env node
/**
 * Fail-first test for the opencode V2 veto adapter (ticket 08, AC-08a).
 *
 * Zero dependencies (node builtins only). Run: node scripts/tna-gate-v2.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = adapter or contract drift.
 *
 * Seam: .opencode/plugins/tna-gate/index.js — a V2 plugin directory
 * (export default { id, setup }) registering ctx.tool.hook("execute.before").
 * The V2 hook receives ONE argument `input` with { tool, input } (per the
 * live workflow-delegation plugin on this machine + the official V2 migration
 * guide); deny is by throwing. Fixtures drive a FAKE ctx capturing the hook,
 * plus real temp dirs for state — never the repo's own .trust/. Expected
 * verdicts are hand-written literals from the ticket's intent, never from
 * running the code.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import plugin from '../.opencode/plugins/tna-gate/index.js';
import { observeAfter } from './tna-gate.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};
const freshDir = () => mkdtempSync(join(tmpdir(), 'tna-gate-v2-'));

// Minimal fake ctx: captures the execute.before hook, exposes a directory
// and an in-memory storage (the V2 durable-write surface).
const fakeCtx = (directory) => {
  const hooks = {};
  const mem = new Map();
  return {
    directory,
    location: { directory },
    storage: {
      get: async (k) => mem.get(k),
      set: async (k, v) => { mem.set(k, v); },
    },
    tool: {
      hook: async (name, fn) => {
        hooks[name] = fn;
        return { dispose: async () => { delete hooks[name]; } };
      },
    },
    hooks,
    _mem: mem,
  };
};

const throwsWith = async (fn) => {
  try { await fn(); } catch (e) { return String(e?.message ?? e); }
  return null;
};

// ---- A. V2 plugin shape (AC-08a: directory plugin, export default, id+setup) ----
{
  check('A1 plugin has a stable id', plugin?.id === 'tna-gate', String(plugin?.id));
  check('A2 plugin exposes an async setup', typeof plugin?.setup === 'function', typeof plugin?.setup);
}

// ---- B. Veto over the V2 single-argument hook ----
{
  const dir = freshDir();
  const ctx = fakeCtx(dir);
  await plugin.setup(ctx);
  check('B0 setup registers execute.before', typeof ctx.hooks['execute.before'] === 'function');
  const deny = await throwsWith(() => ctx.hooks['execute.before']({
    tool: 'bash', sessionID: 's', input: { command: 'git commit -m "feat: x"' },
  }));
  check('B1 commit with no state file THROWS', typeof deny === 'string' && deny.length > 0, String(deny));
  check('B2 the denial names the missing evidence (not a silent block)',
    typeof deny === 'string' && /fresh test/i.test(deny), String(deny));
}

// ---- C. Fresh pass opens the gate (same boundary, same state — ticket 01/02 reused) ----
{
  const dir = freshDir();
  await observeAfter(dir, { tool: 'bash', sessionID: 's', args: { command: 'node scripts/x.test.mjs' } }, { title: '', output: 'ALL PASS', metadata: {} });
  const ctx = fakeCtx(dir);
  await plugin.setup(ctx);
  let threw = null;
  try {
    await ctx.hooks['execute.before']({ tool: 'bash', sessionID: 's', input: { command: 'git commit -m "feat: x"' } });
  } catch (e) { threw = e; }
  check('C1 commit after a passing test run does NOT throw', threw === null, String(threw?.message ?? threw));
}

// ---- D. Fail-open preserved — non-irreversible tools never deny ----
{
  const dir = freshDir();
  const ctx = fakeCtx(dir);
  await plugin.setup(ctx);
  let threw = null;
  try {
    await ctx.hooks['execute.before']({ tool: 'read', sessionID: 's', input: { filePath: 'docs/x.md' } });
  } catch (e) { threw = e; }
  check('D1 read with empty state does NOT throw', threw === null, String(threw?.message ?? threw));
}

// ---- E. Denial persists to storage (the live FS-write finding, ticket 08) ----
{
  const dir = freshDir();
  const ctx = fakeCtx(dir);
  await plugin.setup(ctx);
  await throwsWith(() => ctx.hooks['execute.before']({
    tool: 'shell', sessionID: 's', input: { command: 'git commit -m "feat: x"' },
  }));
  const log = ctx._mem.get('tna-gate-log') || [];
  check('E1 the denial is logged to storage (not the hook FS)',
    log.length === 1 && /git commit/.test(log[0].command), JSON.stringify(log));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
