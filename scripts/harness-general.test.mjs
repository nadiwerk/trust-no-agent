#!/usr/bin/env node
/**
 * Fail-first test for docs/audit-run-blockers-2026-10-25.md — the GENERAL
 * findings, which apply to several harnesses at once.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The per-harness suites (`dsh-fixlist`, `omp-fixlist`, `pi-recorder`) each closed
 * their own adapter. This file pins the findings the audit proved are NOT
 * harness-specific, measured across every path at once:
 *
 *   #2  a RED suite recorded as green   (pi, omp, gate-hook/canonical)
 *   #3  evidence never expires          (all four)
 *   #10 wrapper/interpreter blind       (pi)
 *   #12 done-gate block-type per shape  (pi, omp, dsh)
 *   #13 ledger append-only via shell    (canonical + pi + omp)
 *   #13b denial not logged → meter blind (pi)
 *   #14 logVeto turns a non-string cwd into a literal `[object Object]` dir
 *   #4  receipt veto anchors on the wrong ledger entry (canonical)
 *
 * Each check uses the harness's REAL result shape, not a synthetic one — that is
 * the lesson the audit states explicitly: "Test yang ada sekarang hijau karena
 * memakai bentuk yang salah".
 *
 * Zero dependencies. Run: node scripts/harness-general.test.mjs
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const STATE_REL = join('.trust', 'tna-gate-state.json');
const LOG_REL = join('.trust', 'tna-gate-log.jsonl');

function makePiHarness() {
  const handlers = new Map();
  const pi = { on(e, h) { const l = handlers.get(e) ?? []; l.push(h); handlers.set(e, l); return () => {}; } };
  return {
    pi,
    async call(event, payload, ctx) {
      let out;
      for (const h of handlers.get(event) ?? []) {
        const r = await h(payload, ctx);
        if (r !== undefined) out = r;
      }
      return out;
    },
  };
}

async function loadVeto(harness) {
  const file = harness === 'dsh' ? 'tna-veto.mjs' : 'tna-veto.ts';
  return import(pathToFileURL(join(ROOT, 'veto-hooks', harness, file)).href);
}

/** Wire an adapter and return a `toolCall`/`toolResult` pair for its own contract. */
async function wireVeto(harness, dir) {
  const mod = await loadVeto(harness);
  if (harness === 'dsh') {
    const listeners = new Map();
    const ctx = {
      on(e, h) { const l = listeners.get(e) ?? []; l.push(h); listeners.set(e, l); return () => {}; },
      get(s) { return s === 'workingDirectory' ? { ensure: async (a) => { if (!a?.session) throw new Error('no agent'); return dir; }, get: (sess) => (sess ? dir : undefined) } : (s === 'tools' ? {} : undefined); },
    };
    mod.apply(ctx);
    const agent = { session: { id: 'fixture' } };
    return {
      async call(name, args) {
        const list = listeners.get('tools/pre-execute') ?? [];
        let i = 0;
        const next = async () => (i >= list.length ? { kind: 'allow' } : list[i++]({ name, agent, arguments: args }, next));
        return next();
      },
      async result(name, args, result) {
        for (const h of listeners.get('tools/result') ?? []) await h({ name, agent, arguments: args }, result);
      },
    };
  }
  const h = makePiHarness();
  mod.default(h.pi);
  return {
    async call(name, args) {
      const r = await h.call('tool_call', { toolName: name, input: args }, { cwd: dir });
      // pi/omp signal a denial with `block: true`.
      return r === undefined ? { kind: 'allow' } : { kind: r.block === true ? 'deny' : 'allow', reason: r.reason };
    },
    async result(name, args, result) {
      await h.call('tool_result', { toolName: name, input: args, ...result }, { cwd: dir });
    },
  };
}

// =====================================================================
// #2 — a RED suite must never be recorded as green (pi, omp)
// =====================================================================
for (const harness of ['pi', 'omp']) {
  const dir = mkdtempSync(join(tmpdir(), `tna-gen2-${harness}-`));
  const w = await wireVeto(harness, dir);

  // The REAL shape these harnesses send: an error flag plus an explicit exit code.
  await w.result('bash', { command: 'node x.test.mjs' }, { isError: true, exitCode: 1 });
  const afterRed = existsSync(join(dir, STATE_REL)) ? JSON.parse(readFileSync(join(dir, STATE_REL), 'utf8')) : null;
  check(`${harness} #2a a red run (isError+exitCode 1) records nothing or false`,
    afterRed === null || afterRed.testPassFresh !== true, JSON.stringify(afterRed));

  const gate = await w.call('bash', { command: 'git commit -m x' });
  check(`${harness} #2b the commit after a red run is DENIED`, gate.kind === 'deny', JSON.stringify(gate));

  // A green run with an explicit exit code must still open the gate.
  await w.result('bash', { command: 'node x.test.mjs' }, { isError: false, exitCode: 0 });
  const afterGreen = existsSync(join(dir, STATE_REL)) ? JSON.parse(readFileSync(join(dir, STATE_REL), 'utf8')) : null;
  check(`${harness} #2c a green run (exitCode 0) records true`, afterGreen?.testPassFresh === true, JSON.stringify(afterGreen));
  rmSync(dir, { recursive: true, force: true });
}

// =====================================================================
// #3 — evidence expires (pi, omp)
// =====================================================================
for (const harness of ['pi', 'omp']) {
  const dir = mkdtempSync(join(tmpdir(), `tna-gen3-${harness}-`));
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, STATE_REL), JSON.stringify({ testPassFresh: true, command: 'node x.test.mjs', updatedAt: '2020-01-01T00:00:00.000Z' }));
  const w = await wireVeto(harness, dir);
  const gate = await w.call('bash', { command: 'git commit -m x' });
  check(`${harness} #3 a 2020 state does not open the gate`, gate.kind === 'deny', JSON.stringify(gate));
  rmSync(dir, { recursive: true, force: true });
}

// =====================================================================
// #10 — wrapper / interpreter shapes (pi)
// =====================================================================
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-gen10-'));
  const w = await wireVeto('pi', dir);
  for (const command of [
    'sudo git commit -m x',
    'bash -c "git commit -m x"',
    'sh -c "git push"',
    'env FOO=1 git commit -m x',
    'sudo -u root git commit -m x',
    'nohup git push origin master',
  ]) {
    const gate = await w.call('bash', { command });
    check(`pi #10 denies: ${command}`, gate.kind === 'deny', JSON.stringify(gate));
  }
  for (const command of ['git status', 'bash -c "git status"', 'sudo ls -la', 'echo "git commit"']) {
    const gate = await w.call('bash', { command });
    check(`pi #10 allows: ${command}`, gate.kind === 'allow', JSON.stringify(gate));
  }
  rmSync(dir, { recursive: true, force: true });
}

// =====================================================================
// #13 — ledger append-only on the SHELL path (pi, omp)
// =====================================================================
for (const harness of ['pi', 'omp']) {
  const dir = mkdtempSync(join(tmpdir(), `tna-gen13-${harness}-`));
  mkdirSync(join(dir, '.trust'), { recursive: true });
  // Fresh evidence, so ONLY the ledger rule can block.
  writeFileSync(join(dir, STATE_REL), JSON.stringify({ testPassFresh: true, updatedAt: new Date().toISOString() }));
  const w = await wireVeto(harness, dir);

  for (const [tool, command] of [
    ['bash', '> .trust/progress.txt'],
    ['bash', 'echo x > .trust/progress.txt'],
    ['bash', 'Set-Content .trust/progress.txt "x"'],
    ['pwsh', 'Set-Content .trust/progress.txt "x"'],
    ['pwsh', 'Out-File .trust/progress.txt'],
    ['bash', 'echo x | tee .trust/progress.txt'],
  ]) {
    const gate = await w.call(tool, { command });
    check(`${harness} #13 denies ${tool}: ${command}`, gate.kind === 'deny', JSON.stringify(gate));
  }
  for (const command of ['echo x >> .trust/progress.txt', 'cat .trust/progress.txt', 'wc -l .trust/progress.txt']) {
    const gate = await w.call('bash', { command });
    check(`${harness} #13 allows: ${command}`, gate.kind === 'allow', JSON.stringify(gate));
  }
  rmSync(dir, { recursive: true, force: true });
}

// =====================================================================
// #13b — a denial is logged so the meter can count it (pi, omp)
// =====================================================================
for (const harness of ['pi', 'omp']) {
  const dir = mkdtempSync(join(tmpdir(), `tna-gen13b-${harness}-`));
  const w = await wireVeto(harness, dir);
  await w.call('bash', { command: 'git commit -m x' });
  check(`${harness} #13b a denial writes the veto log`, existsSync(join(dir, LOG_REL)));
  if (existsSync(join(dir, LOG_REL))) {
    const { parseVetoLog } = await import(pathToFileURL(join(HERE, 'gate-meter.mjs')).href);
    const { fires } = parseVetoLog(readFileSync(join(dir, LOG_REL), 'utf8'));
    check(`${harness} #13b the meter counts it`, fires === 1, String(fires));
  }
  rmSync(dir, { recursive: true, force: true });
}

// =====================================================================
// #12 — the done-gate recognises EVERY real block shape (pi, omp, dsh)
// =====================================================================
// pi emits `toolCall`, dsh emits `tool-call`, omp's adapter sees `toolCall`.
// All three spellings must count as evidence, or a turn that DID verify is
// flagged — a false positive that teaches the reader to ignore the notice.
{
  const SHAPES = ['tool-call', 'tool_use', 'toolCall'];

  // pi: agent_before_settle
  {
    const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'pi', 'tna-discipline.ts')).href);
    const h = makePiHarness();
    mod.default(h.pi);
    for (const shape of SHAPES) {
      const r = await h.call('agent_before_settle', {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
          { role: 'assistant', content: [{ type: shape, name: 'bash' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        ],
      }, { cwd: ROOT });
      const flagged = /receipts gate/.test(JSON.stringify(r ?? {}));
      check(`pi #12 "${shape}" counts as evidence (no receipts notice)`, !flagged, String(JSON.stringify(r ?? {})).slice(0, 160));
    }
  }

  // omp: session_stop
  {
    const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-receipts-gate.ts')).href);
    for (const shape of SHAPES) {
      const h = makePiHarness();
      mod.default(h.pi);
      const r = await h.call('session_stop', {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
          { role: 'assistant', content: [{ type: shape, name: 'bash' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        ],
      }, {});
      check(`omp #12 "${shape}" counts as evidence`, r?.decision !== 'block', String(JSON.stringify(r ?? {})).slice(0, 160));
    }
  }

  // dsh: agent/pre-step
  {
    const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'dsh', 'tna-discipline.mjs')).href);
    for (const shape of SHAPES) {
      const dir = mkdtempSync(join(tmpdir(), 'tna-gen12d-'));
      const listeners = new Map();
      const ctx = {
        on(e, h) { const l = listeners.get(e) ?? []; l.push(h); listeners.set(e, l); return () => {}; },
        get(s) { return s === 'workingDirectory' ? { ensure: async () => dir } : (s === 'tools' ? {} : undefined); },
      };
      mod.apply(ctx);
      const list = listeners.get('agent/pre-step') ?? [];
      let j = 0;
      const n = async () => (j >= list.length ? { kind: 'continue', messages: [] } : list[j++]({
        agent: { id: 'a' },
        messages: [
          { id: 'u', role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
          { id: 't', role: 'assistant', content: [{ type: shape, name: 'bash' }] },
          { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        ],
        step: 2, turn: 1, signal: { aborted: false },
      }, n));
      const decision = await n();
      const flagged = /receipts gate/.test(JSON.stringify(decision ?? {}));
      check(`dsh #12 "${shape}" counts as evidence`, !flagged, JSON.stringify(decision).slice(0, 160));
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// =====================================================================
// #14 — logVeto must not create a `[object Object]` directory
// =====================================================================
{
  const { logVeto } = await import(pathToFileURL(join(HERE, 'tna-gate.mjs')).href);
  const dir = mkdtempSync(join(tmpdir(), 'tna-gen14-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const ok = logVeto({ path: '/tmp/x' }, { harness: 'probe', tool: 'bash', command: 'git commit' });
    const bogus = existsSync(join(dir, '[object Object]'));
    check('#14 a non-string cwd does not create a `[object Object]` directory', !bogus, `ok=${ok}`);
    check('#14b the call reports failure instead of a false success', ok !== true, String(ok));
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
}

// =====================================================================
// #4 — the receipt veto anchors on the NEWEST ledger partition
// =====================================================================
{
  const { newestEntry, vetoVerdict } = await import(pathToFileURL(join(HERE, 'receipt-enforcement.mjs')).href);
  const D = '\u2014';
  const ledger = [
    '## 2026-10-24', '', '#### Receipt', `**Verdict** ${D} old`,
    `constraints satisfied ${D} x`,
    `evidence fresh ${D} \`node scripts/validate.mjs\` \u2192 OK`,
    `scope held ${D} x`, `subject verified ${D} x`, `fail-first proven ${D} x`,
    `**Evidence** ${D} x`, `**Open** ${D} x`, `**Next** ${D} x`, '',
    '## 2026-10-25', '', '### newest entry, closed without a receipt heading', '',
  ].join('\n');

  check('#4a the anchor is the newest partition, not the newest receipt',
    newestEntry(ledger)?.date === '2026-10-25', String(newestEntry(ledger)?.date));

  const verdict = vetoVerdict({ ledgerText: ledger, today: new Date('2026-10-25T12:00:00Z'), root: ROOT });
  check('#4b a receiptless newest entry is NOT allowed', verdict.allow !== true, JSON.stringify(verdict));
}

// =====================================================================
// #13 (canonical) — the ledger rule must also cover the PowerShell tool
// =====================================================================
// `SHELL_TOOLS` guards the ledger-overwrite branch by NAME, so a harness that
// sends `pwsh`/`PowerShell` never reached it: `pwsh Set-Content
// .trust/progress.txt` PASSED while the same command via `bash` was blocked.
{
  const { classifyAction } = await import(pathToFileURL(join(HERE, 'action-gate.mjs')).href);
  for (const [tool, command] of [
    ['pwsh', 'Set-Content .trust/progress.txt "x"'],
    ['PowerShell', 'Out-File .trust/progress.txt'],
    ['pwsh', 'echo x > .trust/progress.txt'],
    ['bash', 'Set-Content .trust/progress.txt "x"'],
  ]) {
    const r = classifyAction({ tool, args: { command }, evidence: { testPassFresh: true } });
    check(`canonical #13 blocks ${tool}: ${command}`, r.gated === true, JSON.stringify(r));
  }
  // The documented append form stays open, and ordinary pwsh commands are not gated.
  for (const [tool, command] of [
    ['pwsh', 'echo x >> .trust/progress.txt'],
    ['pwsh', 'cat .trust/progress.txt'],
    ['pwsh', 'Get-Content .trust/progress.txt'],
  ]) {
    const r = classifyAction({ tool, args: { command }, evidence: {} });
    check(`canonical #13 allows ${tool}: ${command}`, r.gated === false, JSON.stringify(r));
  }
}

// =====================================================================
// #6 / #7 — the plugin manifests wire the events the gates need
// =====================================================================
// #6 Codex had no `PostToolUse`, so nothing ever wrote tna-gate-state.json: the
// gate was a PERMANENT WALL (every commit refused, no lawful way to open it).
// #7 Claude Code had no `PostCompact`, so after a compaction the Iron Laws and
// the MANDATORY section vanished from context — the exact failure reinject.mjs
// exists to prevent — while docs claimed both were wired.
{
  const codex = JSON.parse(readFileSync(join(ROOT, 'plugin', 'hooks', 'codex.hooks.json'), 'utf8'));
  const claude = JSON.parse(readFileSync(join(ROOT, 'plugin', 'hooks', 'hooks.json'), 'utf8'));

  check('#6a the Codex manifest wires PostToolUse (the recorder)',
    Array.isArray(codex.hooks?.PostToolUse) && codex.hooks.PostToolUse.length > 0,
    Object.keys(codex.hooks ?? {}).join(','));
  check('#6b it still wires PreToolUse (the veto)',
    Array.isArray(codex.hooks?.PreToolUse) && codex.hooks.PreToolUse.length > 0);
  check('#6c the recorder points at the same gate-hook script',
    JSON.stringify(codex.hooks?.PostToolUse ?? '').includes('gate-hook.mjs'));

  check('#7a the Claude Code manifest wires PostCompact (floor re-injection)',
    Array.isArray(claude.hooks?.PostCompact) && claude.hooks.PostCompact.length > 0,
    Object.keys(claude.hooks ?? {}).join(','));
  check('#7b it keeps SessionStart, PreToolUse and PostToolUse',
    ['SessionStart', 'PreToolUse', 'PostToolUse'].every((k) => Array.isArray(claude.hooks?.[k])),
    Object.keys(claude.hooks ?? {}).join(','));
}

// =====================================================================
// #9 — the doctor finds the REAL Claude Code install (installed_plugins.json)
// =====================================================================
// The old C9 candidate was `~/.claude/plugins/<name>/.claude-plugin/plugin.json`,
// which never exists; Claude Code stores installs at
// `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. Because the first
// path was absent the check never ran, so a 0.1.50 install sat beside a 0.1.52
// repo and doctor said "version current" (that stamp is the PROJECT's, not the
// plugin's).
{
  const { installedPluginVerdict } = await import(pathToFileURL(join(HERE, 'doctor-checks.mjs')).href);

  const stale = installedPluginVerdict({
    repoVersion: '0.1.52',
    installed: [{ name: 'trust-no-agent', version: '0.1.50', installPath: '/h/.claude/plugins/cache/trust-no-agent/trust-no-agent/0.1.50' }],
  });
  check('#9a an older installed plugin is a WARN', stale.level === 'warn', JSON.stringify(stale));
  check('#9b the message names both versions', /0\.1\.50/.test(stale.message) && /0\.1\.52/.test(stale.message), stale.message);

  const current = installedPluginVerdict({
    repoVersion: '0.1.52',
    installed: [{ name: 'trust-no-agent', version: '0.1.52', installPath: '/h/x/0.1.52' }],
  });
  check('#9c a matching install passes', current.level === 'pass', JSON.stringify(current));

  const absent = installedPluginVerdict({ repoVersion: '0.1.52', installed: [] });
  check('#9d no install is a pass with a reason (not silence)', absent.level === 'pass' && /not installed/i.test(absent.message), JSON.stringify(absent));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
