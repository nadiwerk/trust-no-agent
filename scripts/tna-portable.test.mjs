#!/usr/bin/env node
/**
 * Fail-first test for veto portability (full-enforcement ticket 01, AC1).
 *
 * Zero dependencies (node builtins only). Run: node scripts/tna-portable.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = portability drift.
 *
 * Seam: .opencode/plugins/tna-gate/ copied to a temp dir, imported, and
 * driven — the exact adopter path (copy the directory into any project).
 * A plugin importing outside its own directory dies on arrival there, so the
 * test asserts BOTH containment (no `../` escapes in any plugin file) AND
 * behavior (copied copy denies a commit without evidence). Expected verdicts
 * are hand-written literals from the ticket intent.
 */
import { mkdtempSync, readdirSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PLUGIN_DIR = join(ROOT, '.opencode', 'plugins', 'tna-gate');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const throwsWith = async (fn) => {
  try { await fn(); } catch (e) { return String(e?.message ?? e); }
  return null;
};
const fakeCtx = (directory) => {
  const hooks = {};
  const mem = new Map();
  return {
    directory,
    location: { directory },
    storage: { get: async (k) => mem.get(k), set: async (k, v) => { mem.set(k, v); } },
    tool: { hook: async (name, fn) => { hooks[name] = fn; return { dispose: async () => {} }; } },
    hooks,
  };
};

// ---- A. Self-containment — no import escapes the plugin directory ----
{
  const files = readdirSync(PLUGIN_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  check('A0 the plugin directory holds an entry point', files.includes('index.js'), files.join(','));
  const escapes = [];
  for (const f of files) {
    const src = readFileSync(join(PLUGIN_DIR, f), 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (m[1].startsWith('.') && m[1].includes('..')) escapes.push(`${f}: ${m[1]}`);
    }
  }
  check('A1 no plugin file imports outside its own directory', escapes.length === 0, escapes.join('; '));
}

// ---- B. Behavior from a relocated copy — the adopter path ----
{
  const dest = mkdtempSync(join(tmpdir(), 'tna-portable-'));
  for (const f of readdirSync(PLUGIN_DIR)) copyFileSync(join(PLUGIN_DIR, f), join(dest, f));
  mkdirSync(join(dest, '.trust'), { recursive: true });
  let plugin = null;
  let loadErr = null;
  try {
    plugin = (await import(pathToFileURL(join(dest, 'index.js')).href)).default;
  } catch (e) { loadErr = e; }
  check('B0 relocated copy loads', plugin !== null, String(loadErr?.message ?? loadErr));
  if (plugin) {
    const ctx = fakeCtx(dest);
    await plugin.setup(ctx);
    const deny = await throwsWith(() => ctx.hooks['execute.before']({
      tool: 'shell', sessionID: 's', input: { command: 'git commit -m "feat: x"' },
    }));
    check('B1 relocated copy denies a commit without evidence',
      typeof deny === 'string' && /fresh test/i.test(deny), String(deny));
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
