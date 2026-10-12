#!/usr/bin/env node
/**
 * Fail-first test for the V2 storage-backed evidence store (ticket 08,
 * storage redesign: hook FS-writes vanish live, ctx.storage is the only
 * durable write).
 *
 * Zero dependencies (node builtins only). Run: node scripts/tna-store.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = store drift.
 *
 * Seam: scripts/tna-store.mjs — makeStore({ fsDir, storage }) over two
 * backends: fsDir (the project's .trust/, read by doctor/audit) and storage
 * (the plugin ctx.storage, durable in-hook). Reads prefer FS, fall back to
 * storage; writes go to storage ALWAYS (FS-write inside a hook proved lossy
 * live 2026-10-12: deny fired, .trust/ never appeared). Fixtures use real
 * temp dirs + in-memory fake storage — never the repo's own .trust/.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStore } from './tna-store.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};
const freshDir = () => mkdtempSync(join(tmpdir(), 'tna-store-'));
const memStorage = () => {
  const m = new Map();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => { m.set(k, v); },
    _map: m,
  };
};

// ---- A. Empty everywhere → no evidence (deny-safe default) ----
{
  const s = makeStore({ fsDir: freshDir(), storage: memStorage() });
  const st = await s.readState();
  check('A1 empty store reads testPassFresh:false', st.testPassFresh === false, JSON.stringify(st));
}

// ---- B. Writes land in storage (the durable backend) ----
{
  const dir = freshDir();
  const storage = memStorage();
  const s = makeStore({ fsDir: dir, storage });
  await s.writeState({ testPassFresh: true, command: 'node x.test.mjs' });
  check('B1 writeState persists to storage', (await storage.get('tna-gate-state'))?.testPassFresh === true);
  const st = await s.readState();
  check('B2 readState sees the stored pass', st.testPassFresh === true, JSON.stringify(st));
}

// ---- C. FS stays authoritative when present (doctor/audit read it) ----
{
  const dir = freshDir();
  const storage = memStorage();
  const s = makeStore({ fsDir: dir, storage });
  await s.writeState({ testPassFresh: true, command: 'node x.test.mjs' });
  // Simulate a doctor-visible FS copy (written out-of-hook by tooling):
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, '.trust', 'tna-gate-state.json'), JSON.stringify({ testPassFresh: false }));
  const st = await s.readState();
  check('C1 FS copy wins over storage when present', st.testPassFresh === false, JSON.stringify(st));
}

// ---- D. Veto log appends to storage, never throws ----
{
  const storage = memStorage();
  const s = makeStore({ fsDir: freshDir(), storage });
  check('D1 logVeto returns true', await s.logVeto({ tool: 'shell', command: 'git commit -m x' }) === true);
  check('D2 one line appended', (await storage.get('tna-gate-log') || []).length === 1);
  await s.logVeto({ tool: 'shell', command: 'git push' });
  check('D3 second denial appends', (await storage.get('tna-gate-log') || []).length === 2);
}

// ---- E. Broken storage degrades, never breaks the veto ----
{
  const bad = { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } };
  const s = makeStore({ fsDir: freshDir(), storage: bad });
  const st = await s.readState();
  check('E1 unreadable storage reads no-evidence (deny-safe)', st.testPassFresh === false, JSON.stringify(st));
  check('E2 unwritable storage returns false (never throws)', await s.logVeto({ tool: 'x', command: 'y' }) === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
