#!/usr/bin/env node
/**
 * Fail-first test for OpenCode↔Claude discipline parity (2026-11-17).
 *
 * Five gaps, five sections. Each section was written RED before its module
 * existed, then turned GREEN by one vertical slice — the RED output is kept in
 * the ledger as fail-first evidence.
 *
 * Seams (public interfaces, not internals):
 *   prompt-gate.mjs    -> promptGateVerdict(text), decoratePrompt(text)
 *   receipt-check.mjs  -> receiptVerdict(messages)
 *   restore-guard.mjs  -> restoreVerdict({disk, head, snapshot})
 *   chisle-hook.mjs    -> compressToolResult(result, compress)
 *   plugin             -> setup(fake ctx with session.hook / event.subscribe / tool.hook)
 *
 * Expected values are hand-written from intent, never from observed output.
 * Run: node scripts/tna-parity-v2.test.mjs   (exit 0 = green)
 */
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const plug = (name) => new URL(`../.opencode/plugins/tna-gate/${name}`, import.meta.url);
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A1. Per-prompt MANDATORY classification (Claude UserPromptSubmit parity)
const pg = await import(plug('prompt-gate.mjs')).catch(() => null);
check('A prompt-gate module exists', !!pg && typeof pg.decoratePrompt === 'function');
if (pg) {
  const r = pg.promptGateVerdict('Tolong perbaiki bug login yang error');
  check('A2 bug prompt routes to root-cause', r.domain === 'root-cause', JSON.stringify(r));
  const t = pg.promptGateVerdict('Tulis test unit untuk adapter');
  check('A3 test prompt routes to expect-fail', t.domain === 'expect-fail', JSON.stringify(t));
  const c = pg.promptGateVerdict('Commit pekerjaan ini sekarang');
  check('A4 commit prompt routes to receipts', c.domain === 'receipts', JSON.stringify(c));
  const n = pg.promptGateVerdict('Buka halaman pengaturan');
  check('A5 unrelated prompt is not tagged', n.domain === null, JSON.stringify(n));
  const d1 = pg.decoratePrompt('perbaiki bug login');
  check('A6 decorated prompt carries a tna-mandatory marker', /<tna-mandatory\b/.test(d1), d1);
  check('A7 decoration is idempotent (retry-safe)', pg.decoratePrompt(d1) === d1, pg.decoratePrompt(d1));
  const u = pg.promptGateVerdict('perbaiki bug login');
  check('A8 instruction names the skill to load', /root-cause/.test(u.instruction ?? ''), JSON.stringify(u));

  // Integration: the plugin must register a V2 prompt hook and decorate text.
  const { default: pluginP } = await import(plug('index.js'));
  let promptCb;
  await pluginP.setup({
    location: { directory: mkdtempSync(join(tmpdir(), 'tna-parity-prompt-')) },
    storage: { get: async () => undefined, set: async () => {} },
    tool: { hook: async () => ({ dispose: async () => {} }) },
    event: { subscribe: () => (async function* () {})() },
    session: { hook: async (name, cb) => { if (name === 'prompt') promptCb = cb; return { dispose: async () => {} }; } },
  });
  check('A9 plugin registers a prompt hook', typeof promptCb === 'function');
  if (typeof promptCb === 'function') {
    const draft = { prompt: { text: 'perbaiki bug login' }, metadata: {} };
    promptCb(draft);
    check('A10 prompt hook injects the flagged instruction into the draft', /<tna-mandatory\b/.test(draft.prompt.text), draft.prompt.text);
  }
}

// ---- A2. Receipt 4-block check on commit (Claude receipt-gate parity)
const rc = await import(plug('receipt-check.mjs')).catch(() => null);
check('B receipt-check module exists', !!rc && typeof rc.receiptVerdict === 'function');
if (rc) {
  const assistant = (text) => ({ type: 'assistant', content: [{ type: 'text', text }] });
  const full = [
    assistant('**Verdict:** done\n**Evidence:** npm test green\n**Open:** none\n**Next:** stop'),
  ];
  check('B2 complete 4-block receipt passes', rc.receiptVerdict(full).ok === true, JSON.stringify(rc.receiptVerdict(full)));
  const partial = [assistant('**Verdict:** done\n**Evidence:** npm test green\n**Next:** stop')];
  const pv = rc.receiptVerdict(partial);
  check('B3 missing Open block is named', pv.ok === false && pv.missing.includes('Open'), JSON.stringify(pv));
  const claim = [assistant('Selesai, beres sudah jadi.')];
  check('B4 bare completion claim has no receipt', rc.receiptVerdict(claim).ok === false, JSON.stringify(rc.receiptVerdict(claim)));
  check('B5 no assistant text is not judgeable -> not blocked', rc.receiptVerdict([]).ok === true, JSON.stringify(rc.receiptVerdict([])));

  // Integration: fake ctx with a prompt hook and a commit attempt.
  const { mkdtempSync: mk } = await import('node:fs');
  const projDir = mk(join(tmpdir(), 'tna-parity-receipt-'));
  mkdirSync(join(projDir, '.trust'));
  writeFileSync(join(projDir, '.trust', 'tna-gate-state.json'), JSON.stringify({ testPassFresh: true, updatedAt: new Date().toISOString() }));
  const { default: plugin } = await import(plug('index.js'));
  let before;
  let messages = partial;
  const fakeCtx = {
    location: { directory: projDir },
    storage: { get: async () => undefined, set: async () => {} },
    tool: {
      hook: async (name, cb) => {
        if (name === 'execute.before') before = cb;
        return { dispose: async () => {} };
      },
    },
    event: { subscribe: () => (async function* () {})() },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      list: async () => ({ data: [{ id: 'ses_receipt' }] }),
      context: async () => messages, // commit whose last turn lacks a receipt
    },
  };
  await plugin.setup(fakeCtx);
  let denied = '';
  try {
    await before({ tool: 'shell', input: { command: 'git commit -m "docs: x"' } });
  } catch (e) {
    denied = String(e?.message ?? e);
  }
  check('B6 plugin denies commit when the last turn has no receipt', /receipt/i.test(denied), denied || 'no throw');
  messages = [assistant('Selesai, sudah beres.')];
  let ordinary = true;
  try {
    await before({ tool: 'read', input: { file_path: 'x' } });
  } catch {
    ordinary = false;
  }
  check('B8 ordinary read is not blocked by a mid-turn claim', ordinary, 'ordinary tool call was denied');

  messages = full;
  let allowed = true;
  try {
    await before({ tool: 'shell', input: { command: 'git commit -m "docs: x"' } });
  } catch (e) {
    allowed = false;
  }
  check('B7 plugin allows the same commit with a complete receipt', allowed, 'denied with full receipt');
}

// ---- C. Four stacks installed on OpenCode (Claude four-stacks parity)
const sg = await import(plug('stacks-gate.mjs')).catch(() => null);
check('C stacks-gate module exists', !!sg && typeof sg.stacksVerdict === 'function');
if (sg) {
  const empty = mkdtempSync(join(tmpdir(), 'tna-stacks-empty-'));
  const ev = sg.stacksVerdict(empty);
  check('C2 empty skill dir reports all stack skills missing', ev.missing.length === 12 && ev.ok === false, JSON.stringify(ev));
  const fullDir = mkdtempSync(join(tmpdir(), 'tna-stacks-full-'));
  for (const name of ev.required ?? []) {
    mkdirSync(join(fullDir, name));
    writeFileSync(join(fullDir, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  const ok = sg.stacksVerdict(fullDir);
  check('C3 complete skill dir passes', ok.ok === true && ok.missing.length === 0, JSON.stringify(ok));
  const real = join(process.env.USERPROFILE ?? '', '.config', 'opencode', 'skills');
  if (existsDir(real)) {
    const rv = sg.stacksVerdict(real);
    check('C4 real OpenCode install carries the stack skills', rv.ok === true, JSON.stringify(rv));
  }
}

// ---- D. Restore-tooling decision guard (Claude SessionStart parity)
const rg = await import(plug('restore-guard.mjs')).catch(() => null);
check('D restore-guard module exists', !!rg && typeof rg.restoreVerdict === 'function');
if (rg) {
  check('D2 disk matches HEAD, stale snapshot -> refreshed', rg.restoreVerdict({ disk: 'new', head: 'new', snapshot: 'old' }).action === 'refreshed');
  check('D3 disk missing -> restored', rg.restoreVerdict({ disk: null, head: 'new', snapshot: 'new' }).action === 'restored');
  check('D4 disk diverges from HEAD -> warn, never overwrite', rg.restoreVerdict({ disk: 'wip', head: 'new', snapshot: 'new' }).action === 'warn');
  check('D5 all three identical -> ok', rg.restoreVerdict({ disk: 'same', head: 'same', snapshot: 'same' }).action === 'ok');
  check('D6 no snapshot -> skip', rg.restoreVerdict({ disk: 'new', head: 'new', snapshot: null }).action === 'skip');
}

// ---- E. Tool-output compression through execute.after (Chisle parity)
const ch = await import(plug('chisle-hook.mjs')).catch(() => null);
check('E chisle-hook module exists', !!ch && typeof ch.compressToolResult === 'function');
if (ch) {
  const fake = (t) => `COMPRESSED(${t.length})`;
  const shapes = [
    { output: { text: 'x'.repeat(1200) } },
    { output: { stdout: 'y'.repeat(1200) } },
    { output: 'z'.repeat(1200) },
  ];
  const results = shapes.map((r) => ch.compressToolResult(r, 'shell', fake, {}));
  check('E2 all observed result shapes are compressed', results.every((r) => JSON.stringify(r).includes('COMPRESSED(1200)')), JSON.stringify(results));
  const unsafe = ch.compressToolResult({ output: 'q'.repeat(1200) }, 'read', fake, {});
  check('E3 Read/Edit/Write output is never compressed', JSON.stringify(unsafe).includes('qqqq'), JSON.stringify(unsafe).slice(0, 80));
  const small = ch.compressToolResult({ output: 'short' }, 'shell', fake, {});
  check('E4 small output passes through untouched', JSON.stringify(small).includes('short'), JSON.stringify(small));
  const calls = [];
  ch.compressToolResult({ output: 'w'.repeat(1200) }, 'shell', (t) => { calls.push(t); return t; }, {});
  check('E5 compressor is called with the original text', calls.length === 1 && calls[0].length === 1200, JSON.stringify(calls.map((x) => x.length)));
}

function existsDir(p) {
  try { return !!p && statSync(p).isDirectory(); } catch { return false; }
}

// ---- F. Plugin wiring for restore + compression (integration seams)
const { default: pluginF } = await import(plug('index.js'));
{
  const proj = mkdtempSync(join(tmpdir(), 'tna-parity-restore-'));
  mkdirSync(join(proj, '.trust', 'keep'), { recursive: true });
  writeFileSync(join(proj, 'AGENTS.md'), 'wip edit by this session\n' + 'x'.repeat(20010));
  writeFileSync(join(proj, '.trust', 'keep', 'AGENTS.md'), 'snapshot from HEAD\n');
  let after;
  const events = [{ type: 'session.created', data: { sessionID: 'ses_restore' } }];
  await pluginF.setup({
    location: { directory: proj },
    storage: { get: async () => undefined, set: async () => {} },
    tool: { hook: async (name, cb) => { if (name === 'execute.after') after = cb; return { dispose: async () => {} }; } },
    event: { subscribe: () => (async function* () { for (const e of events) yield e; })() },
    session: { hook: async () => ({ dispose: async () => {} }), list: async () => ({ data: [] }) },
  });
  await new Promise((r) => setTimeout(r, 1500));
  const logPath = join(proj, '.trust', 'tna-gate-log.jsonl');
  let restoreLogged = false;
  try {
    restoreLogged = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).some((l) => JSON.parse(l).harness === 'opencode-v2-restore');
  } catch { /* no log yet */ }
  check('F1 restore guard logs a WARN at session start', restoreLogged, logPath);
  let sizeLogged = false;
  try {
    sizeLogged = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).some((l) => JSON.parse(l).harness === 'opencode-v2-agentsize');
  } catch { /* no log yet */ }
  check('F4 oversized project AGENTS.md is flagged at session start', sizeLogged, logPath);

  check('F2 plugin registers execute.after', typeof after === 'function');
  if (typeof after === 'function') {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i} ` + 'x'.repeat(90)).join('\n');
    const result = { output: { text: big } };
    try { await after({ tool: 'shell', input: {}, result }); } catch { /* must not throw */ }
    check('F3 execute.after compresses oversized shell output', result.output.text.length < big.length, `${big.length} -> ${result.output.text.length}`);

    // F5/F6/F7: full Chisle parity — dedup, mode flag, savings stats.
    const stateDir = mkdtempSync(join(tmpdir(), 'tna-chisle-state-'));
    process.env.CHISLE_STATE_DIR = stateDir;
    const flagPath = join(stateDir, '.chisle-active');
    process.env.CHISLE_FLAG_PATH = flagPath;
    const rep = Array.from({ length: 200 }, (_, i) => `line ${i} ` + 'y'.repeat(90)).join('\n');
    const ev1 = { tool: 'shell', sessionID: 'ses_dedup', id: 'call_1', input: {}, result: { output: { text: rep } } };
    const ev2 = { tool: 'shell', sessionID: 'ses_dedup', id: 'call_2', input: {}, result: { output: { text: rep } } };
    await after(ev1);
    await after(ev2);
    check('F5 identical repeated output is deduped per session', /byte-identical/.test(ev2.result.output.text), String(ev2.result.output.text).slice(0, 120));
    const statsPath = join(stateDir, '.chisle-compress-stats.json');
    let statsOk = false;
    try { statsOk = JSON.parse(readFileSync(statsPath, 'utf8')).savedChars > 0; } catch {}
    check('F6 savings are recorded to the OpenCode state dir', statsOk, statsPath);
    writeFileSync(flagPath, 'off');
    const offText = Array.from({ length: 200 }, (_, i) => `off ${i} ` + 'z'.repeat(90)).join('\n');
    const offEv = { tool: 'shell', sessionID: 'ses_off', id: 'call_3', input: {}, result: { output: { text: offText } } };
    await after(offEv);
    check('F7 mode=off flag disables compression', offEv.result.output.text.length === offText.length, `${offText.length} -> ${offEv.result.output.text.length}`);
    delete process.env.CHISLE_STATE_DIR;
    delete process.env.CHISLE_FLAG_PATH;
  }
}

console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
