#!/usr/bin/env node
/**
 * Fail-first test for the opencode reinjection layer (Gap 1: after
 * compaction, the router floor — Iron Laws + MANDATORY section — falls out of
 * context and the ledger compensation relies on agent initiative, which evals
 * prove fails silently).
 *
 * Canonical builder: scripts/reinject.mjs (buildReinject, pure over router
 * text). The opencode port copies that module VERBATIM into the plugin dir
 * (reinject-core.mjs) and wires it to opencode V2's compaction surface:
 *
 *   event `session.compaction.ended`  ->  read the project router
 *   (WORKFLOW.md + AGENTS.md at the session directory; env TNA_ROUTER_ROOT
 *   overrides for tests) -> buildReinject(text) ->
 *   ctx.session.instructions.entry.put({ sessionID, key: 'tna-floor', value })
 *
 * Why instructions.entry (measured from the V2 plugin docs, 2026-11-15):
 * entries render as <context key="..."> blocks in the session's instructions
 * and update WITHOUT queuing a message turn — the floor returns to context at
 * the next step boundary with no transcript noise, and survives later turns.
 *
 * Run: node scripts/tna-reinject-v2.test.mjs   (exit 0 = green)
 */
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).href.replace(/file:\/\//, '');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// --- fixture: a router pair with the real shapes ----------------------------
const LAWS_TEXT = [
  '## Empat Iron Laws',
  '',
  '- No acting until the user confirms shared understanding; state the plan and wait.',
  '- No production code without a failing test written first and seen red.',
  '- No completion claims without fresh verification evidence run in this turn.',
  '- No expensive, irreversible, or shared-system action without explicit user sign-off.',
].join('\n');

const MANDATORY_TEXT = [
  '## Router',
  '',
  '### MANDATORY discipline skills — no self-trigger, no exception',
  '',
  '- **expect-fail** — load before writing any test. No production code without a failing test first.',
  '- **root-cause** — load before proposing any fix.',
  '- **receipts** — load before accepting any done claim.',
  '',
  '## Next heading',
  '',
  'body that must NOT appear in the floor',
].join('\n');

// --- unit: the plugin's floor builder ---------------------------------------
const mod = await import(new URL('../.opencode/plugins/tna-gate/reinjection.mjs', import.meta.url).href)
  .catch(() => ({ buildFloorFromRouter: null }));

check('reinjection module exists', typeof mod.buildFloorFromRouter === 'function', 'import failed — module not written yet');

if (typeof mod.buildFloorFromRouter === 'function') {
  const dir = mkdtempSync(join(tmpdir(), 'tna-reinject-'));
  writeFileSync(join(dir, 'WORKFLOW.md'), LAWS_TEXT);
  writeFileSync(join(dir, 'AGENTS.md'), MANDATORY_TEXT);

  // 1. Both halves present -> complete floor.
  const f1 = mod.buildFloorFromRouter(dir);
  check('complete floor carries the Iron Laws', /No acting until the user confirms/.test(f1) && /No expensive, irreversible/.test(f1), f1.slice(0, 200));
  check('complete floor carries the MANDATORY section', /MANDATORY discipline skills/.test(f1) && /receipts/.test(f1));
  check('floor stops at the next heading (no leak)', !f1.includes('body that must NOT appear'), f1.slice(-200));

  // 2. Missing WORKFLOW.md -> half floor that NAMES the missing half.
  const dir2 = mkdtempSync(join(tmpdir(), 'tna-reinject-'));
  writeFileSync(join(dir2, 'AGENTS.md'), MANDATORY_TEXT);
  const f2 = mod.buildFloorFromRouter(dir2);
  check('half router still emits a floor that names the missing half', f2.length > 0 && /NOT FOUND/.test(f2), f2.slice(0, 200));

  // 3. No router at all -> '' (graceful degradation, never a fake floor).
  const dir3 = mkdtempSync(join(tmpdir(), 'tna-reinject-'));
  check('empty router dir yields empty floor, no throw', mod.buildFloorFromRouter(dir3) === '');
  check('nonexistent dir yields empty floor, no throw', mod.buildFloorFromRouter(join(dir3, 'nope')) === '');
}

// --- integration: plugin wiring on a fake ctx --------------------------------
try {
  const plugMod = await import(new URL('../.opencode/plugins/tna-gate/index.js', import.meta.url).href);
  const plugin = plugMod.default;

  const routerDir = mkdtempSync(join(tmpdir(), 'tna-reinject-w-'));
  writeFileSync(join(routerDir, 'WORKFLOW.md'), LAWS_TEXT);
  writeFileSync(join(routerDir, 'AGENTS.md'), MANDATORY_TEXT);
  process.env.TNA_ROUTER_ROOT = routerDir;

  const compactionEvents = [
    { type: 'session.compaction.ended', data: { sessionID: 'ses_c1' } },
    { type: 'session.compaction.started', data: { sessionID: 'ses_c1' } }, // not the trigger
    { type: 'session.idle', data: { sessionID: 'ses_c1' } },               // not the trigger
    { type: 'session.compaction.ended', data: {} },                        // shapeless -> ignored
  ];
  const subscribeCalls = [];
  const entries = [];
  const mem = new Map();

  const fakeCtx = {
    location: { directory: routerDir },
    storage: { get: async (k) => mem.get(k), set: async (k, v) => { mem.set(k, v); } },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    event: {
      subscribe: (opts) => {
        subscribeCalls.push(opts?.types ?? []);
        return (async function* gen() { for (const e of compactionEvents) yield e; })();
      },
    },
    session: {
      instructions: {
        entry: {
          put: async (input) => { entries.push(input); return { ok: true }; },
        },
      },
    },
  };

  await plugin.setup(fakeCtx);
  await new Promise((r) => setTimeout(r, 200));

  check('plugin subscribes to the bare event stream (types is ignored by the service — measured 2026-11-15)', subscribeCalls.length >= 1, JSON.stringify(subscribeCalls));
  check('floor is attached as a keyed instruction entry', entries.length === 1 && entries[0].key === 'tna-floor', JSON.stringify(entries));
  check('entry carries the complete floor', entries.length === 1 && /No acting until the user confirms/.test(entries[0].value ?? '') && /receipts/.test(entries[0].value ?? ''), entries[0]?.value?.slice(0, 200));
  check('entry targets the compacted session', entries.length === 1 && entries[0].sessionID === 'ses_c1', JSON.stringify(entries.map((e) => e.sessionID)));
  process.env.TNA_ROUTER_ROOT = '';
} catch (e) {
  check('plugin integration importable and drivable', false, String(e));
}

// --- integration: FS mirror of the floor attachment --------------------------
// The floor attachment is observable only inside the plugin (no public API
// reads instruction entries), so a live compaction cannot be verified from
// outside. The event loop's FS access persists (measured 2026-11-15, unlike
// hook callbacks), so the attach is ALSO logged to the project's
// .trust/tna-gate-log.jsonl with its own harness tag — the audit artifact
// doctor/ledger can read.
try {
  const { mkdtempSync, writeFileSync: wf, existsSync: ex, readFileSync: rf } = await import('node:fs');
  const osMod = await import('node:os');
  const plugMod = await import(new URL('../.opencode/plugins/tna-gate/index.js', import.meta.url).href);
  const plugin = plugMod.default;

  const projDir = mkdtempSync(join(osMod.tmpdir(), 'tna-floor-fs-'));
  // A router for the floor to be built from (the done-gate block above reset
  // TNA_ROUTER_ROOT to '' — point it at a fixture router again).
  const routerFix = mkdtempSync(join(osMod.tmpdir(), 'tna-floor-router-'));
  wf(join(routerFix, 'WORKFLOW.md'), LAWS_TEXT);
  wf(join(routerFix, 'AGENTS.md'), MANDATORY_TEXT);
  process.env.TNA_ROUTER_ROOT = routerFix;
  const fakeCtx3 = {
    location: { directory: projDir },
    storage: { get: async () => undefined, set: async () => {} },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    event: { subscribe: (opts) => (async function* gen() { yield { type: 'session.compaction.ended', data: { sessionID: 'ses_floor' } }; })() },
    session: {
      instructions: { entry: { put: async () => ({ ok: true }) } },
    },
  };
  await plugin.setup(fakeCtx3);
  await new Promise((r) => setTimeout(r, 200));

  const logPath = join(projDir, '.trust', 'tna-gate-log.jsonl');
  check('floor attach is mirrored to the project FS log', ex(logPath), 'no .trust/tna-gate-log.jsonl written');
  if (ex(logPath)) {
    const line = rf(logPath, 'utf8').trim().split('\n').pop();
    const entry = JSON.parse(line);
    check('FS mirror carries the reinjection harness tag', entry.harness === 'opencode-v2-reinject' && String(entry.command).includes('ses_floor'), line ?? '');
  }
} catch (e) {
  check('floor FS-mirror integration drivable', false, String(e));
}
process.env.TNA_ROUTER_ROOT = '';

console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
