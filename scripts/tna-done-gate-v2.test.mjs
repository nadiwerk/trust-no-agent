#!/usr/bin/env node
/**
 * Fail-first test for the opencode done-gate (Gap 2: completion claim with no
 * verifying tool call in the turn).
 *
 * Canonical classifier: ~/.omo/agent/hooks/done-receipt-gate.mjs (senpi Stop
 * hook, CLAIM_PATTERNS + toolsUsedThisTurn). The opencode port keeps the SAME
 * claim table and the same turn boundary — the adapter changes only WHERE the
 * events come from: opencode V2 has no Stop hook, so the plugin subscribes to
 * `session.idle` on the server event stream and flags (not blocks — the
 * session is already idle; the router's done-gate layer is "flagged").
 *
 * Fixtures use the message shape MEASURED live 2026-11-15 via
 * `opencode api session.message.list --param sessionID=...`:
 *   user      -> { type: 'user', text: '...' }
 *   assistant -> { type: 'assistant', content: [ {type:'text', text}, {type:'tool', name, state:{status}} ] }
 * Expected verdicts are hand-written literals, never read from the code.
 *
 * Run: node scripts/tna-done-gate-v2.test.mjs   (exit 0 = green)
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pluginUrl = new URL('../.opencode/plugins/tna-gate/index.js', import.meta.url);

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const user = (text) => ({ type: 'user', text });
const toolPart = (name) => ({ type: 'tool', name, state: { status: 'completed' } });
const textPart = (text) => ({ type: 'text', text });

// --- unit: doneGateVerdict -------------------------------------------------
const { doneGateVerdict } = await import(new URL('../.opencode/plugins/tna-gate/done-gate.mjs', import.meta.url)).catch(() => ({ doneGateVerdict: null }));

check('done-gate module exists', typeof doneGateVerdict === 'function', 'import failed — module not written yet');

if (typeof doneGateVerdict === 'function') {
  // 1. Claim, no tool call this turn -> flagged.
  const v1 = doneGateVerdict([
    user('perbaiki bug login'),
    { type: 'assistant', content: [textPart('Sudah diperbaiki, selesai.')] },
  ]);
  check('claim without tool call is flagged', v1.claim !== null && v1.evidence === false, JSON.stringify(v1));

  // 2. Claim WITH a tool call this turn -> not flagged.
  const v2 = doneGateVerdict([
    user('perbaiki bug login'),
    { type: 'assistant', content: [toolPart('shell'), textPart('Fixed and verified.')] },
  ]);
  check('claim with a shell tool call this turn is not flagged', v2.claim !== null && v2.evidence === true, JSON.stringify(v2));

  // 3. Plain question, no claim -> nothing.
  const v3 = doneGateVerdict([
    user('boleh dijelaskan?'),
    { type: 'assistant', content: [textPart('Boleh — jalur komunikasinya begini...')] },
  ]);
  check('benign prose produces no claim', v3.claim === null, JSON.stringify(v3));

  // 4. Tool call in an EARLIER turn does not count as this turn's evidence.
  const v4 = doneGateVerdict([
    user('tugas pertama'),
    { type: 'assistant', content: [toolPart('shell'), textPart('run 1 ok')] },
    user('lanjutkan'),
    { type: 'assistant', content: [textPart('Done, semua beres.')] },
  ]);
  check('evidence from a previous turn does not cover this claim', v4.claim !== null && v4.evidence === false, JSON.stringify(v4));

  // 5. Empty/shapeless input is safe.
  const v5a = doneGateVerdict([]);
  const v5b = doneGateVerdict(null);
  check('empty input yields no claim, no throw', v5a.claim === null && v5b.claim === null, JSON.stringify([v5a, v5b]));

  // 6b. The measured end-of-turn event on service 2.2.6 (session.idle is never
  //     emitted there) must trigger the same flag.
  const v6b = doneGateVerdict([
    user('perbaiki bug login'),
    { type: 'assistant', content: [textPart('Sudah diperbaiki, selesai.')] },
  ]);
  check('claim without tool call is flagged (verdict basis for the execution.succeeded trigger)', v6b.claim !== null && v6b.evidence === false, JSON.stringify(v6b));
  const v6 = doneGateVerdict([
    { type: 'system' }, { type: 'idle' }, { type: 'agent-switched' },
    user('selesaikan'),
    { type: 'assistant', content: [textPart('Selesai.')] },
  ]);
  check('non-conversation message kinds are skipped', v6.claim !== null && v6.evidence === false, JSON.stringify(v6));
}

// --- integration: plugin wiring on a fake ctx ------------------------------
try {
  const mod = await import(pluginUrl);
  const plugin = mod.default;

  const idleEvents = [
    { type: 'session.idle', data: { sessionID: 'ses_claim' } },
    { type: 'session.idle', data: { sessionID: 'ses_evidence' } },
    { type: 'session.idle', data: {} }, // shapeless -> ignored, no throw
    { type: 'session.execution.succeeded', data: { sessionID: 'ses_claim2' } }, // measured 2026-11-15 on service 2.2.6
  ];
  const sessions = {
    ses_claim: [
      user('perbaiki'),
      { type: 'assistant', content: [textPart('Sudah selesai.')] },
    ],
    ses_evidence: [
      user('perbaiki'),
      { type: 'assistant', content: [toolPart('shell'), textPart('Selesai.')] },
    ],
    ses_claim2: [
      user('perbaiki'),
      { type: 'assistant', content: [textPart('Beres, sudah jadi.')] },
    ],
  };
  const subscribeCalls = [];
  const mem = new Map();

  const fakeCtx = {
    location: { directory: '/tmp/whatever' },
    storage: {
      get: async (k) => mem.get(k),
      set: async (k, v) => { mem.set(k, v); },
    },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    event: {
      subscribe: (opts) => {
        subscribeCalls.push(opts?.types ?? []);
        return (async function* gen() {
          for (const e of idleEvents) yield e;
        })();
      },
    },
    session: {
      context: async ({ sessionID }) => sessions[sessionID] ?? [],
    },
  };

  let cleanup = null;
  try {
    cleanup = await plugin.setup(fakeCtx);
  } catch (e) {
    check('plugin.setup with done-gate wiring runs', false, String(e));
  }
  check('plugin.setup with done-gate wiring runs', cleanup !== null || cleanup === undefined);
  check('plugin subscribes to the bare event stream (types is ignored by the service — measured 2026-11-15)', subscribeCalls.length >= 1, JSON.stringify(subscribeCalls));

  // The idle loop is async; poll briefly for the two judged events to land.
  await new Promise((r) => setTimeout(r, 200));

  // The plugin persists flags through its OWN store built from ctx.storage
  // (the V2 durable-write surface) — observe the in-memory copy, not a
  // side channel.
  const vetoLog = (await fakeCtx.storage.get('tna-gate-log')) || [];
  const flagged = vetoLog.filter((e) => e && e.harness === 'opencode-v2-donegate');
  check('claim session is flagged in the veto log', flagged.some((e) => String(e.command).includes('ses_claim') || String(e.command).includes('selesai')), JSON.stringify(vetoLog));
  check('execution.succeeded claim session is also flagged (the 2.2.6 trigger)', flagged.some((e) => String(e.command).includes('ses_claim2')), JSON.stringify(vetoLog));
  check('evidence session is NOT flagged', !flagged.some((e) => String(e.command).includes('ses_evidence')), JSON.stringify(vetoLog));
  check('shapeless idle event did not throw or log', flagged.length <= 2, JSON.stringify(flagged.length));
} catch (e) {
  check('plugin integration importable and drivable', false, String(e));
}

// --- integration: FS mirror of the done-gate flag ---------------------------
// The veto log lives in plugin ctx.storage — durable (proven) but not
// externally readable (no public API reads plugin storage), so a live flag
// cannot be verified outside the plugin. The event loop (unlike hook
// callbacks, where FS writes are proven to vanish) MAY persist FS writes —
// unmeasured. This test pins the contract: the flag ALSO lands in the
// project's .trust/tna-gate-log.jsonl, best-effort, when the event loop's FS
// access persists; storage remains the source of truth either way.
try {
  const { mkdtempSync, writeFileSync: wf, existsSync: ex, readFileSync: rf } = await import('node:fs');
  const osMod = await import('node:os');
  const plugMod = await import(new URL('../.opencode/plugins/tna-gate/index.js', import.meta.url).href);
  const plugin = plugMod.default;

  const projDir = mkdtempSync(join(osMod.tmpdir(), 'tna-donegate-fs-'));
  const sessions = {
    ses_fs: [
      user('perbaiki'),
      { type: 'assistant', content: [textPart('Sudah selesai, beres.')] },
    ],
  };
  const idleEvents = [{ type: 'session.idle', data: { sessionID: 'ses_fs' } }];
  const fakeCtx2 = {
    location: { directory: projDir },
    storage: { get: async () => undefined, set: async () => {} }, // storage that swallows
    tool: { hook: async () => ({ dispose: async () => {} }) },
    event: { subscribe: (opts) => (async function* gen() { for (const e of idleEvents) yield e; })() },
    session: { context: async ({ sessionID }) => sessions[sessionID] ?? [] },
  };
  await plugin.setup(fakeCtx2);
  await new Promise((r) => setTimeout(r, 200));

  const logPath = join(projDir, '.trust', 'tna-gate-log.jsonl');
  check('done-gate flag is mirrored to the project FS log', ex(logPath), 'no .trust/tna-gate-log.jsonl written');
  if (ex(logPath)) {
    const entries = rf(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    // An enforcement audit entry may follow the flag entry — assert the flag
    // is present, not that it is last (contract expanded 2026-11-17).
    const flag = entries.find((e) => e.harness === 'opencode-v2-donegate');
    check('FS mirror carries the done-gate harness tag', !!flag && String(flag.command).includes('ses_fs'), JSON.stringify(entries));
  }
} catch (e) {
  check('FS mirror integration drivable', false, String(e));
}

console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
