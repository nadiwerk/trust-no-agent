#!/usr/bin/env node
/**
 * Fail-first test for the dsh fix-list (docs/dsh-fix-list-2026-10-25.md).
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/dsh-veto.test.mjs` and `scripts/dsh-discipline.test.mjs` were green
 * while eight defects were live, because they used SYNTHETIC fixtures instead of
 * dsh's real shapes:
 *
 *   - they passed `isError: true` for a red suite, but dsh reports non-zero exit
 *     in the RESULT TEXT as `[exit code: N]` and keeps `isError: false`
 *     (@deepseek-ai/dsh-tool-bash: "Non-zero exits are reported, not errored");
 *   - they used `block.type === 'tool_use'`, but dsh emits `"tool-call"`
 *     (@deepseek-ai/dsh-agent-loop);
 *   - they never exercised `sudo`/`bash -c`, shell redirects to the ledger, a
 *     stale evidence file, `terminal_send`, or the veto-fire log.
 *
 * A green suite on the wrong fixture is worse than no suite: it certifies the
 * bug. This file uses the real shapes, quoted from the packages.
 *
 * One entry per fix-list item, same numbering (F1..F10 ↔ #1..#10).
 * Zero dependencies. Run: node scripts/dsh-fixlist.test.mjs
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VETO = join(ROOT, 'veto-hooks', 'dsh', 'tna-veto.mjs');
const DISCIPLINE = join(ROOT, 'veto-hooks', 'dsh', 'tna-discipline.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/**
 * A fake cordis context: waterfall + emit, with the two services dsh injects.
 *
 * `workingDirectory` mirrors the REAL contract (dsh-working-directory):
 * `ensure(agent, signal)` needs a live agent and throws on anything else, while
 * `get(session)` reads the same fact from `agent.session`. The fixture agent
 * therefore carries a `session` — a plain `{id}` object is NOT a valid agent and
 * would exercise the fallback instead of the path production takes.
 */
function makeCtx(cwd) {
  const listeners = new Map();
  const ctx = {
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return () => {};
    },
    get(service) {
      if (service === 'workingDirectory') {
        return {
          ensure: async (agent) => {
            if (!agent?.session) throw new TypeError('Invalid value used as weak map key');
            return cwd;
          },
          get: (session) => (session ? cwd : undefined),
        };
      }
      if (service === 'tools') return {};
      return undefined;
    },
  };
  return {
    ctx,
    async waterfall(event, ...args) {
      const list = listeners.get(event) ?? [];
      let i = 0;
      const next = async () => (i >= list.length ? { kind: 'allow' } : list[i++](...args, next));
      return next();
    },
    async emit(event, ...args) {
      for (const h of listeners.get(event) ?? []) await h(...args);
    },
  };
}

/** A live-agent stand-in: the plugin only reads `agent.session`. */
const AGENT = { session: { id: 'fixture-session' } };
const STATE = join('.trust', 'tna-gate-state.json');
const LOG = join('.trust', 'tna-gate-log.jsonl');

/** Fresh isolated repo + wired plugin. */
async function freshVeto() {
  const dir = mkdtempSync(join(tmpdir(), 'tna-dshfix-'));
  const mod = await import(pathToFileURL(VETO).href);
  const h = makeCtx(dir);
  mod.apply(h.ctx);
  return { dir, h, mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** dsh's REAL result shape for a finished shell call. */
const resultText = (text) => ({ isError: false, content: [{ type: 'text', text }] });

// ---- F1. validate.mjs: file names in backticks are not skill names ----
// Prose that names `cordis.patch.yml` / `tna-veto.mjs` / `testPassFresh` used to
// fail CI, so no dsh doc change could land.
{
  const r = spawnSync(process.execPath, [join(HERE, 'validate.mjs')], { cwd: ROOT, encoding: 'utf8' });
  check('F1 scripts/validate.mjs exits 0', r.status === 0, `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-400));
  check('F1b the error names a file, not a skill',
    !/unknown skill: `(cordis\.patch\.yml|tna-veto\.mjs|testPassFresh)`/.test(r.stdout ?? ''), r.stdout ?? '');
}

// ---- F2. A RED suite must not record green evidence ----
// dsh: non-zero exit is TEXT (`[exit code: 1]`), `isError` stays false. The old
// recorder read `isError !== true` and therefore certified every red run.
{
  const { dir, h, cleanup } = await freshVeto();
  await h.emit('tools/result',
    { name: 'bash', agent: AGENT, arguments: { command: 'node x.test.mjs' } },
    resultText('FAIL x.test.mjs\n1 failing\n[exit code: 1]'));

  const state = existsSync(join(dir, STATE)) ? JSON.parse(readFileSync(join(dir, STATE), 'utf8')) : null;
  check('F2a a red run does not record testPassFresh=true',
    state === null || state.testPassFresh !== true, JSON.stringify(state));

  const gate = await h.waterfall('tools/pre-execute',
    { name: 'bash', agent: AGENT, arguments: { command: 'git commit -m x' } });
  check('F2b the commit after a red run is DENIED', gate?.kind === 'deny', JSON.stringify(gate));
  cleanup();
}

// ---- F2c. A GREEN suite (no exit marker = exit 0) records evidence ----
{
  const { dir, h, cleanup } = await freshVeto();
  await h.emit('tools/result',
    { name: 'bash', agent: AGENT, arguments: { command: 'node x.test.mjs' } },
    resultText('ALL PASS\n'));
  const state = existsSync(join(dir, STATE)) ? JSON.parse(readFileSync(join(dir, STATE), 'utf8')) : null;
  check('F2c a green run records testPassFresh=true', state?.testPassFresh === true, JSON.stringify(state));
  const gate = await h.waterfall('tools/pre-execute',
    { name: 'bash', agent: AGENT, arguments: { command: 'git commit -m x' } });
  check('F2d the commit after a green run is ALLOWED', gate?.kind === 'allow', JSON.stringify(gate));
  cleanup();
}

// ---- F2e. An explicit `[exit code: 0]` is green; unknown shapes record nothing ----
{
  const { dir, h, cleanup } = await freshVeto();
  await h.emit('tools/result',
    { name: 'bash', agent: AGENT, arguments: { command: 'npm test' } },
    resultText('ok\n[exit code: 0]'));
  check('F2e an explicit exit code 0 records evidence',
    JSON.parse(readFileSync(join(dir, STATE), 'utf8')).testPassFresh === true);
  cleanup();

  const second = await freshVeto();
  await second.h.emit('tools/result',
    { name: 'bash', agent: second.h && AGENT, arguments: { command: 'node x.test.mjs' } },
    { isError: false, content: [] }); // no text at all: unknown, not pass
  const st = existsSync(join(second.dir, STATE)) ? JSON.parse(readFileSync(join(second.dir, STATE), 'utf8')) : null;
  check('F2f an unreadable result records NOTHING (unknown is not pass)',
    st === null || st.testPassFresh !== true, JSON.stringify(st));
  second.cleanup();
}

// ---- F2g. Only the LAST command's exit status counts ----
// A shell reports the status of the last command in the line. Measured live
// 2026-10-25: `node y.test.mjs; "exit=$LASTEXITCODE"` on a RED suite left no
// non-zero marker (the echo exited 0), so "no marker = clean" certified it and
// the commit landed.
{
  const { dir, h, cleanup } = await freshVeto();
  // NOT evidence: something other than the test determines the exit status.
  for (const command of [
    'node y.test.mjs; "exit=$LASTEXITCODE"',
    'node y.test.mjs && git commit -m x',
    'cd . && node y.test.mjs; echo done',
  ]) {
    await h.emit('tools/result',
      { name: 'bash', agent: AGENT, arguments: { command } },
      resultText('ALL PASS\n'));
    const state = existsSync(join(dir, STATE)) ? JSON.parse(readFileSync(join(dir, STATE), 'utf8')) : null;
    check(`F2g a trailing non-test command records nothing: ${command}`,
      state === null || state.testPassFresh !== true, JSON.stringify(state));
    if (existsSync(join(dir, STATE))) rmSync(join(dir, STATE), { force: true });
  }

  // IS evidence: the test is the last command, so its status IS the line's.
  // This is the BB-thread shape (`cd <repo> && node x.test.mjs`) and must stay
  // accepted — refusing it rebuilds the wall the pi report closed.
  for (const command of [
    'cd . && node y.test.mjs',
    'cd repo && node deep/x.test.mjs',
    'cd repo; npm test',
  ]) {
    await h.emit('tools/result',
      { name: 'bash', agent: AGENT, arguments: { command } },
      resultText('ALL PASS\n'));
    const state = existsSync(join(dir, STATE)) ? JSON.parse(readFileSync(join(dir, STATE), 'utf8')) : null;
    check(`F2h a prefixed test still records evidence: ${command}`,
      state?.testPassFresh === true, JSON.stringify(state));
    if (existsSync(join(dir, STATE))) rmSync(join(dir, STATE), { force: true });
  }
  cleanup();
}

// ---- F3. Evidence expires ----
// `recordEvidence` always wrote `updatedAt`; `readEvidence` never read it, so one
// green run opened the gate in that repo FOREVER.
{
  const { dir, h, cleanup } = await freshVeto();
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, STATE),
    JSON.stringify({ testPassFresh: true, command: 'node x.test.mjs', updatedAt: '2020-01-01T00:00:00.000Z' }));
  const gate = await h.waterfall('tools/pre-execute',
    { name: 'bash', agent: AGENT, arguments: { command: 'git commit -m x' } });
  check('F3 stale evidence (2020) does NOT open the gate', gate?.kind === 'deny', JSON.stringify(gate));

  writeFileSync(join(dir, STATE),
    JSON.stringify({ testPassFresh: true, command: 'node x.test.mjs', updatedAt: new Date().toISOString() }));
  const fresh = await h.waterfall('tools/pre-execute',
    { name: 'bash', agent: AGENT, arguments: { command: 'git commit -m x' } });
  check('F3b fresh evidence still opens it', fresh?.kind === 'allow', JSON.stringify(fresh));
  cleanup();
}

// ---- F4. Wrappers and interpreters ----
// `classifyCommand` only looked at the first word: `sudo` became the head and a
// quoted `bash -c` payload was never seen.
{
  const { dir, h, cleanup } = await freshVeto();
  const MUST_DENY = [
    'sudo git commit -m x',
    'bash -c "git commit -m x"',
    'sh -c "git push"',
    'sudo -u root git commit -m x',
    'env GIT_AUTHOR_NAME=x git commit -m x',
    'bash -lc "git commit -m x"',
    'nohup git push origin master',
  ];
  for (const command of MUST_DENY) {
    const gate = await h.waterfall('tools/pre-execute', { name: 'bash', agent: AGENT, arguments: { command } });
    check(`F4 denies: ${command}`, gate?.kind === 'deny', JSON.stringify(gate));
  }
  for (const command of ['git status', 'bash -c "git status"', 'sudo ls -la', 'echo "git commit"']) {
    const gate = await h.waterfall('tools/pre-execute', { name: 'bash', agent: AGENT, arguments: { command } });
    check(`F4 allows: ${command}`, gate?.kind === 'allow', JSON.stringify(gate));
  }
  cleanup();
}

// ---- F5. Ledger append-only on the SHELL path ----
// The ledger check lived only in the WRITE_TOOLS branch, so a redirect or
// `Set-Content` from bash/pwsh overwrote the private history unchallenged.
{
  const { dir, h, cleanup } = await freshVeto();
  const DENY = [
    ['bash', '> .trust/progress.txt'],
    ['bash', 'echo x > .trust/progress.txt'],
    ['bash', 'Set-Content .trust/progress.txt "x"'],
    ['pwsh', 'Set-Content .trust/progress.txt "x"'],
    ['bash', 'Out-File .trust/progress.txt'],
    ['bash', 'echo x | tee .trust/progress.txt'],
  ];
  for (const [tool, command] of DENY) {
    const gate = await h.waterfall('tools/pre-execute', { name: tool, agent: AGENT, arguments: { command } });
    check(`F5 denies ${tool}: ${command}`, gate?.kind === 'deny', JSON.stringify(gate));
  }
  // The documented contract is the append form: it must stay open.
  for (const command of ['echo x >> .trust/progress.txt', 'cat .trust/progress.txt', 'wc -l .trust/progress.txt']) {
    const gate = await h.waterfall('tools/pre-execute', { name: 'bash', agent: AGENT, arguments: { command } });
    check(`F5 allows: ${command}`, gate?.kind === 'allow', JSON.stringify(gate));
  }
  cleanup();
}

// ---- F6. The done-gate must SEE dsh's real tool block type ----
// dsh emits `block.type === "tool-call"`; the adapter only knew 'tool_use' and
// 'toolCall', so a claim that HAD run its tests still got the receipts notice.
{
  const mod = await import(pathToFileURL(DISCIPLINE).href);
  const run = async (messages) => {
    const dir = mkdtempSync(join(tmpdir(), 'tna-dsh6-'));
    const h = makeCtx(dir);
    mod.apply(h.ctx);
    const decision = await h.waterfall('agent/pre-step',
      { agent: AGENT, messages, step: 2, turn: 1, signal: { aborted: false } });
    rmSync(dir, { recursive: true, force: true });
    return JSON.stringify(decision?.messages ?? []);
  };

  const claim = { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Done — the fix is in.' }] };
  const withToolCall = await run([
    { id: 'u1', role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
    claim,
    { id: 't1', role: 'assistant', content: [{ type: 'tool-call', name: 'bash', arguments: {} }] },
  ]);
  check('F6a a "tool-call" block counts as evidence (no receipts notice)',
    !/receipts gate/.test(withToolCall), withToolCall.slice(0, 300));

  const withoutEvidence = await run([
    { id: 'u2', role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
    claim,
  ]);
  check('F6b a claim with NO tool call is still flagged',
    /receipts gate/.test(withoutEvidence), withoutEvidence.slice(0, 300));
}

// ---- F7. MANDATORY classifier parity with the canonical gate ----
// The dsh table matched bare `test`/`fix`/`salah`, so ordinary prose fired three
// false positives in four sentences and the notice became noise.
{
  const dsh = await import(pathToFileURL(DISCIPLINE).href);
  const canonical = await import(pathToFileURL(join(HERE, 'mandatory-gate.mjs')).href);

  const MUST_NOT_FIRE = [
    'fix the typo in the heading',
    'what does the test runner print',
    'perbaiki ejaan di docs',
  ];
  for (const text of MUST_NOT_FIRE) {
    const v = dsh.classifyPrompt(text);
    const fired = Object.entries(v).filter(([, on]) => on).map(([k]) => k);
    check(`F7 no domain fires: "${text}"`, fired.length === 0, JSON.stringify(v));
  }
  const MUST_FIRE = [
    ['fix the bug', 'root-cause'],
    ['write a test for the parser', 'expect-fail'],
    ['commit this and push it', 'receipts'],
  ];
  for (const [text, domain] of MUST_FIRE) {
    check(`F7 ${domain} fires: "${text}"`, dsh.classifyPrompt(text)[domain] === true,
      JSON.stringify(dsh.classifyPrompt(text)));
  }

  // Parity: the port must agree with the canonical classifier on a corpus.
  const corpus = [
    'fix the typo in the heading', 'what does the test runner print', 'perbaiki ejaan di docs',
    'fix the bug', 'write a test for the parser', 'commit this and push it',
    'no need to write a test', 'jangan tulis test dulu', 'the tests are red',
    'add unit tests for the parser', 'why does the build fail', 'ship it',
    'tanpa commit', 'debug the crash', 'done', 'selesai',
  ];
  const drift = [];
  for (const text of corpus) {
    const a = dsh.classifyPrompt(text);
    const b = canonical.classifyTask(text);
    for (const domain of ['expect-fail', 'root-cause', 'receipts']) {
      if (Boolean(a[domain]) !== Boolean(b[domain])) drift.push(`${JSON.stringify(text)} ${domain}: dsh=${a[domain]} canonical=${b[domain]}`);
    }
  }
  check(`F7c the port agrees with scripts/mandatory-gate.mjs on ${corpus.length} sentences`,
    drift.length === 0, drift.slice(0, 4).join(' | '));
}

// ---- F8. A denial leaves a trace the meter can count ----
{
  const { dir, h, cleanup } = await freshVeto();
  await h.waterfall('tools/pre-execute',
    { name: 'bash', agent: AGENT, arguments: { command: 'git commit -m x' } });
  check('F8a a denial writes .trust/tna-gate-log.jsonl', existsSync(join(dir, LOG)));

  if (existsSync(join(dir, LOG))) {
    const { parseVetoLog } = await import(pathToFileURL(join(HERE, 'gate-meter.mjs')).href);
    const { fires } = parseVetoLog(readFileSync(join(dir, LOG), 'utf8'));
    check('F8b the meter counts it as 1 veto fire', fires === 1, String(fires));
    const line = JSON.parse(readFileSync(join(dir, LOG), 'utf8').trim().split('\n')[0]);
    check('F8c the line names the harness, tool and command',
      line.harness === 'dsh' && line.tool === 'bash' && /git commit/.test(line.command), JSON.stringify(line));
  }
  // An ALLOWED call must not be logged (the meter counts vetoes, not traffic).
  await h.emit('tools/result', { name: 'bash', agent: AGENT, arguments: { command: 'ls' } }, resultText('ok'));
  const lines = existsSync(join(dir, LOG)) ? readFileSync(join(dir, LOG), 'utf8').trim().split('\n').filter(Boolean) : [];
  check('F8d an allowed call adds no line', lines.length === 1, String(lines.length));
  cleanup();
}

// ---- F9. `terminal_send` is a shell surface ----
// dsh's persistent terminal carries the command in `text`, not `command`, so a
// commit typed into a terminal session bypassed the veto entirely.
{
  const { dir, h, cleanup } = await freshVeto();
  const gate = await h.waterfall('tools/pre-execute',
    { name: 'terminal_send', agent: AGENT, arguments: { sessionId: 's1', text: 'git commit -m x' } });
  check('F9 terminal_send with a commit is denied', gate?.kind === 'deny', JSON.stringify(gate));

  const benign = await h.waterfall('tools/pre-execute',
    { name: 'terminal_send', agent: AGENT, arguments: { sessionId: 's1', text: 'ls -la' } });
  check('F9b terminal_send with a read-only command stays open', benign?.kind === 'allow', JSON.stringify(benign));
  cleanup();
}

// ---- F10. The payload install path must not no-op silently ----
// Run from `~/.dsh/skills/setup-tna/`, `ROOT` is the skill folder: it carries
// `veto-hooks/` but no `skills/`, so skill installation silently copied nothing
// while the receipt still said the floor was consented.
{
  const sandbox = mkdtempSync(join(tmpdir(), 'tna-payload-'));
  const payload = join(sandbox, '.dsh', 'skills', 'setup-tna');
  mkdirSync(join(payload, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'onboarding.mjs'), join(payload, 'scripts', 'onboarding.mjs'));
  cpSync(join(ROOT, 'veto-hooks'), join(payload, 'veto-hooks'), { recursive: true });

  const repo = join(sandbox, 'repo');
  mkdirSync(join(repo, '.dsh'), { recursive: true });
  writeFileSync(join(repo, 'AGENTS.md'), '# project router\n');
  writeFileSync(join(repo, '.gitignore'), '.trust/\n');

  const answers = JSON.stringify({ components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: [] });
  const r = spawnSync(process.execPath, [join(payload, 'scripts', 'onboarding.mjs'), '--from-chat', answers], {
    cwd: repo, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: join(sandbox, 'home'), USERPROFILE: join(sandbox, 'home') },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

  // Either it installs the skills, or it FAILS LOUDLY naming the reason.
  // The one unacceptable outcome is "success" with zero skills copied.
  const skillsInstalled = existsSync(join(repo, '.agents', 'skills', 'receipts', 'SKILL.md'));
  const failedLoudly = r.status !== 0 && /skills/i.test(out);
  check('F10 the payload path either installs skills or fails loudly (never a silent no-op)',
    skillsInstalled || failedLoudly, `exit=${r.status} skills=${skillsInstalled} :: ${out.slice(-400)}`);
  rmSync(sandbox, { recursive: true, force: true });
}

// ---- F11. An unresolvable project must FAIL CLOSED, never read another repo ----
// Measured live 2026-10-25 on the composed acp tree: the same commit returned
// deny/deny/allow across three calls in one boot because `resolveCwd` degraded
// to `process.cwd()`, which is whatever directory dsh was launched from — a
// session working in repo A read repo B's evidence. An unresolvable project is
// now a deny with the reason named.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-nocwd-'));
  const mod = await import(pathToFileURL(VETO).href);
  const listeners = new Map();
  const ctx = {
    on(e, h) { const l = listeners.get(e) ?? []; l.push(h); listeners.set(e, l); return () => {}; },
    // workingDirectory exists but refuses every agent, and get() yields nothing.
    get(s) {
      if (s === 'workingDirectory') return { ensure: async () => { throw new Error('no live agent'); }, get: () => undefined };
      if (s === 'tools') return {};
      return undefined;
    },
  };
  mod.apply(ctx);
  const fire = async (exec) => {
    const list = listeners.get('tools/pre-execute') ?? [];
    let i = 0;
    const next = async () => (i >= list.length ? { kind: 'allow' } : list[i++](exec, next));
    return next();
  };

  const gate = await fire({ name: 'bash', agent: { id: 'not-a-live-agent' }, arguments: { command: 'git commit -m x' } });
  check('F11 an unresolvable project is DENIED (no cwd guessing)', gate?.kind === 'deny', JSON.stringify(gate));
  check('F11b the reason names the cause', /working directory/i.test(gate?.reason ?? ''), gate?.reason ?? '');

  // And the recorder must not write into a directory it cannot attribute.
  await (async () => {
    for (const h of listeners.get('tools/result') ?? []) {
      await h({ name: 'bash', agent: { id: 'not-a-live-agent' }, arguments: { command: 'node x.test.mjs' } },
        { isError: false, content: [{ type: 'text', text: 'ALL PASS' }] });
    }
  })();
  check('F11c the recorder writes nothing without a project', !existsSync(join(dir, STATE)), dir);
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
