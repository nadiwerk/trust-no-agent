#!/usr/bin/env node
/**
 * Fail-first test for the omp adapter set (docs/omp-fix-list-2026-10-25.md).
 *
 * WHY THIS EXISTS (and why the existing suite was green through all of it)
 * ------------------------------------------------------------------------
 * `scripts/veto-adapter.test.mjs` covers `tna-veto.ts` for pi AND omp (K/L/M/N),
 * but nothing imported `tna-discipline.ts` or `tna-receipts-gate.ts` at all. The
 * one defect that mattered most — arming being silently discarded — is invisible
 * unless the handler's return value is pushed through the harness's own merge
 * helper, so no test could have caught it. This file does that (O1).
 *
 * Items map 1:1 to the fix-list numbers.
 * Zero dependencies. Run: node scripts/omp-fixlist.test.mjs
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/** A fake omp hook host: handlers by event, invoked like the runtime. */
function makeHarness() {
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
  };
  return {
    pi,
    async call(event, payload, ctx) {
      const list = handlers.get(event) ?? [];
      let out;
      for (const h of list) {
        const r = await h(payload, ctx);
        if (r !== undefined) out = r;
      }
      return out;
    },
  };
}

/**
 * omp's OWN merge helper, transcribed from `dist/cli.js`:
 *
 *   let { additionalContext, input, ...rest } = a;  n = rest
 *   Tdt: return { ...rest, ...(input !== undefined ? { input } : {}) }
 *
 * This is the whole point of O1: a handler that returns `{tasks}` without an
 * `input` key is discarded without an error, and a test that only reads
 * `result.tasks` stays green on that code.
 */
function ompMerge(original, handlerResult) {
  if (handlerResult === undefined || handlerResult === null) return original;
  const { additionalContext, input, ...rest } = handlerResult;
  return { ...rest, ...(input !== undefined ? { input } : {}) };
}

// ---- O1. Delegation arming reaches the tool call (harness merge) ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')).href);
  const h = makeHarness();
  mod.default(h.pi);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp1-'));

  const single = { task: 'fix the parser bug' };
  const r1 = await h.call('tool_call', { type: 'tool_call', toolName: 'task', toolCallId: 't1', input: single }, { cwd: dir });
  check('O1a the handler returns a top-level `input` key', r1?.input !== undefined, JSON.stringify(Object.keys(r1 ?? {})));
  const merged1 = ompMerge(single, r1);
  check('O1b the harness merge carries the arm into the tool input',
    /delegated-execution contract/i.test(String(merged1?.input?.task ?? '')), JSON.stringify(merged1).slice(0, 160));

  const batched = { context: 'shared instructions', tasks: [{ task: 'fix the parser bug' }, { task: 'write docs' }] };
  const r2 = await h.call('tool_call', { type: 'tool_call', toolName: 'task', toolCallId: 't2', input: batched }, { cwd: dir });
  const merged2 = ompMerge(batched, r2);
  check('O1c a BATCH is armed too (tasks[] survives the merge)',
    Array.isArray(merged2?.input?.tasks) && merged2.input.tasks.every((t) => /delegated-execution contract/i.test(String(t.task ?? ''))),
    JSON.stringify(merged2).slice(0, 200));
  rmSync(dir, { recursive: true, force: true });
}

// ---- O2. Delegation veto sees omp's real wire shapes ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')).href);
  const veto = mod.default;
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp2-'));
  const h = makeHarness();
  veto(h.pi);
  const ask = (input) => h.call('tool_call', { toolName: 'task', input }, { cwd: dir });

  check('O2a single task with the action is blocked', (await ask({ task: 'git commit -m x' }))?.block === true);
  check('O2b batched tasks[] is blocked', (await ask({ tasks: [{ task: 'git commit -m x' }] }))?.block === true);
  check('O2c batched + context is blocked', (await ask({ context: 'git commit -m x', tasks: [{ task: 'do the thing' }] }))?.block === true);
  check('O2d context alone is blocked (it reaches the child prompt)',
    (await ask({ context: 'then git push origin master', task: 'do the thing' }))?.block === true);
  check('O2e a benign batch is allowed',
    (await ask({ context: 'be careful', tasks: [{ task: 'summarise the README' }] })) === undefined);
  // `name` is a UI label only — classifying it would add false positives.
  check('O2f a name-only mention is NOT treated as an instruction',
    (await ask({ name: 'git commit cleanup', task: 'summarise the README' })) === undefined);
  rmSync(dir, { recursive: true, force: true });
}

// ---- O4. Wrappers and interpreters ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')).href);
  const h = makeHarness();
  mod.default(h.pi);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp4-'));
  const shell = (command) => h.call('tool_call', { toolName: 'bash', input: { command } }, { cwd: dir });

  for (const command of [
    'sudo git commit -m x',
    'bash -c "git commit -m x"',
    'sh -c "git push"',
    'env FOO=1 git commit -m x',
    'sudo -u root git commit -m x',
    'nohup git push origin master',
  ]) {
    check(`O4 blocks: ${command}`, (await shell(command))?.block === true, command);
  }
  for (const command of ['git status', 'bash -c "git status"', 'sudo ls -la', 'echo "git commit"']) {
    check(`O4 allows: ${command}`, (await shell(command)) === undefined, command);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- O5. An unknown outcome records NOTHING (never a guessed pass) ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')).href);
  const h = makeHarness();
  mod.default(h.pi);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp5-'));
  const STATE = join(dir, '.trust', 'tna-gate-state.json');

  await h.call('tool_result', { toolName: 'bash', input: { command: 'node x.test.mjs' } }, { cwd: dir });
  check('O5a isError ABSENT records nothing', !existsSync(STATE), 'state file written');

  await h.call('tool_result', { toolName: 'bash', input: { command: 'node x.test.mjs' }, isError: true }, { cwd: dir });
  check('O5b isError true records testPassFresh=false',
    JSON.parse(readFileSync(STATE, 'utf8')).testPassFresh === false);

  await h.call('tool_result', { toolName: 'bash', input: { command: 'node x.test.mjs' }, isError: false }, { cwd: dir });
  check('O5c isError false records testPassFresh=true',
    JSON.parse(readFileSync(STATE, 'utf8')).testPassFresh === true);
  rmSync(dir, { recursive: true, force: true });
}

// ---- O6. Evidence expires ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')).href);
  const h = makeHarness();
  mod.default(h.pi);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp6-'));
  mkdirSync(join(dir, '.trust'), { recursive: true });
  const STATE = join(dir, '.trust', 'tna-gate-state.json');

  writeFileSync(STATE, JSON.stringify({ testPassFresh: true, updatedAt: '2020-01-01T00:00:00.000Z' }));
  const stale = await h.call('tool_call', { toolName: 'bash', input: { command: 'git commit -m x' } }, { cwd: dir });
  check('O6a a 2020 state does not open the gate', stale?.block === true, JSON.stringify(stale));

  writeFileSync(STATE, JSON.stringify({ testPassFresh: true, updatedAt: new Date().toISOString() }));
  const fresh = await h.call('tool_call', { toolName: 'bash', input: { command: 'git commit -m x' } }, { cwd: dir });
  check('O6b fresh evidence still opens it', fresh === undefined, JSON.stringify(fresh));
  rmSync(dir, { recursive: true, force: true });
}

// ---- O7. A denial is logged for the meter ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')).href);
  const h = makeHarness();
  mod.default(h.pi);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp7-'));
  const LOG = join(dir, '.trust', 'tna-gate-log.jsonl');

  await h.call('tool_call', { toolName: 'bash', input: { command: 'git commit -m x' } }, { cwd: dir });
  check('O7a a denial writes .trust/tna-gate-log.jsonl', existsSync(LOG));

  if (existsSync(LOG)) {
    const { parseVetoLog } = await import(pathToFileURL(join(HERE, 'gate-meter.mjs')).href);
    const { fires } = parseVetoLog(readFileSync(LOG, 'utf8'));
    check('O7b the meter counts it', fires === 1, String(fires));
    const line = JSON.parse(readFileSync(LOG, 'utf8').trim().split('\n')[0]);
    check('O7c the line names the harness and command',
      line.harness === 'omp' && /git commit/.test(line.command), JSON.stringify(line));
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- O8. The done-gate counts VERIFICATION, not mere work ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-receipts-gate.ts')).href);
  const run = async (toolNames, text) => {
    const h = makeHarness();
    mod.default(h.pi);
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
      { role: 'assistant', content: toolNames.map((name) => ({ type: 'toolCall', name })) },
      { role: 'assistant', content: [{ type: 'text', text }] },
    ];
    return h.call('session_stop', { messages }, {});
  };

  check('O8a write-only + "Shipped." is BLOCKED', (await run(['write'], 'Shipped.'))?.decision === 'block');
  check('O8b read-only + "Done." is BLOCKED', (await run(['read'], 'Done.'))?.decision === 'block');
  check('O8c grep + "Done." is accepted (it can prove something)', (await run(['grep'], 'Done.'))?.decision === undefined);
  check('O8d bash + "Done." is accepted', (await run(['bash'], 'Done.'))?.decision === undefined);
  check('O8e no tools + "Done." is still blocked', (await run([], 'Done.'))?.decision === 'block');
}

// ---- O9. The floor resolves from the SESSION cwd, never a stale fallback ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')).href);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp9-'));
  writeFileSync(join(dir, 'AGENTS.md'), [
    '# project router',
    '1. No acting until shared understanding is confirmed.',
    '2. No production behavior change without observing a failing test first.',
    '3. No completion claims without fresh verification output.',
    '4. No expensive, irreversible, or shared-system action without sign-off.',
    '',
    '### 2. MANDATORY discipline skills',
    '',
    'PROJECT-MARKER-LINE',
  ].join('\n'));

  const resolved = mod.resolveFloor(dir);
  check('O9a the project router wins', resolved?.source === dir, JSON.stringify(resolved?.source));
  check('O9b the floor carries the project content', /PROJECT-MARKER-LINE/.test(resolved?.floor ?? ''));

  // A directory with no router at all must NOT silently yield a stale router
  // that claims rules it does not contain. Fail-open means "no floor", honestly.
  const empty = mkdtempSync(join(tmpdir(), 'tna-omp9b-'));
  const none = mod.resolveFloor(empty);
  const staleFallback = none && /\.omo[\\/]agent[\\/]hooks[\\/]router/.test(String(none.source));
  check('O9c an unadopted directory does not borrow the stale ~/.omo router', !staleFallback,
    JSON.stringify(none?.source));
  rmSync(dir, { recursive: true, force: true });
  rmSync(empty, { recursive: true, force: true });
}

// ---- O9d. The hook uses ctx.cwd, not process.cwd() ----
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')).href);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp9d-'));
  writeFileSync(join(dir, 'AGENTS.md'), [
    '# project router',
    '1. No acting until shared understanding is confirmed.',
    '2. No production behavior change without observing a failing test first.',
    '3. No completion claims without fresh verification output.',
    '4. No expensive, irreversible, or shared-system action without sign-off.',
    '',
    '### 2. MANDATORY discipline skills',
    'CTX-CWD-MARKER',
  ].join('\n'));

  const h = makeHarness();
  mod.default(h.pi);
  const r = await h.call('before_agent_start', { prompt: 'hello' }, { cwd: dir });
  check('O9d the floor is resolved from ctx.cwd', /CTX-CWD-MARKER/.test(String(r?.message?.content ?? '')),
    String(r?.message?.content ?? '').slice(0, 120));
  rmSync(dir, { recursive: true, force: true });
}

// ---- O11. MANDATORY classifier parity with the canonical gate ----
{
  const omp = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')).href);
  const canonical = await import(pathToFileURL(join(HERE, 'mandatory-gate.mjs')).href);

  for (const text of [
    'sudah saya baca file itu, lanjut saja',
    'jangan push dulu ya',
    'tidak perlu commit sekarang',
    'no need to write a test for this',
  ]) {
    const v = omp.classifyPrompt(text);
    const fired = Object.entries(v).filter(([, on]) => on).map(([k]) => k);
    check(`O11 no domain fires: "${text}"`, fired.length === 0, JSON.stringify(v));
  }
  for (const [text, domain] of [['tolong periksa apakah error-nya dari config', 'root-cause'], ['pr ini isinya apa?', 'receipts']]) {
    check(`O11 ${domain} still fires: "${text}"`, omp.classifyPrompt(text)[domain] === true,
      JSON.stringify(omp.classifyPrompt(text)));
  }

  const corpus = [
    'sudah saya baca file itu, lanjut saja', 'jangan push dulu ya', 'tidak perlu commit sekarang',
    'test the login flow', 'no need to write a test for this', 'tolong periksa apakah error-nya dari config',
    'pr ini isinya apa?', 'fix the bug', 'write a test for the parser', 'commit this and push it',
    'perbaiki ejaan di docs', 'the tests are red', 'done', 'selesai', 'tanpa commit', 'debug the crash',
  ];
  const drift = [];
  for (const text of corpus) {
    const a = omp.classifyPrompt(text);
    const b = canonical.classifyTask(text);
    for (const d of ['expect-fail', 'root-cause', 'receipts']) {
      if (Boolean(a[d]) !== Boolean(b[d])) drift.push(`${JSON.stringify(text)} ${d}: omp=${a[d]} canonical=${b[d]}`);
    }
  }
  check(`O11c the port agrees with scripts/mandatory-gate.mjs on ${corpus.length} sentences`,
    drift.length === 0, drift.slice(0, 4).join(' | '));
}

// ---- O11d. Host-injected instruction blocks are not user prompts ----
{
  const omp = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')).href);
  const userText = 'Tolong temukan error di omp';
  // Both shapes a host injects: with the `Instructions from:` preamble, and the
  // router's own section headings inlined without any preamble (measured).
  const prefixedBlock = [
    'Instructions from: C:\\Users\\Lenovo\\.config\\the coding agent\\AGENTS.md',
    '# Trust No Agent — discipline floor',
    'Three skills are MANDATORY: expect-fail, root-cause, receipts.',
    'Before any "done" claim, commit, or PR: load receipts.',
  ].join('\n');
  const inlineBlock = [
    '## 1. Klasifikasi sebelum apa pun',
    '**Menulis test tidak pernah `fast`.**',
    '## 2. Trigger matrix',
    '| Menulis test / test-first | `expect-fail` **WAJIB** |',
    '| Sebelum klaim "done", commit, atau PR | `receipts` **WAJIB** |',
    '## 3. Aturan inti',
    '- Sebelum commit/PR: `receipts` - lampirkan bukti.',
  ].join('\n');

  const plain = omp.classifyPrompt(userText);
  check('O11d the user text alone flags only root-cause',
    plain['root-cause'] === true && !plain['expect-fail'] && !plain.receipts, JSON.stringify(plain));

  const withPrefixed = omp.classifyPrompt(`${prefixedBlock}\n\n${userText}`);
  check('O11e a prefixed host block does not amplify the verdict',
    withPrefixed['expect-fail'] === false && withPrefixed.receipts === false, JSON.stringify(withPrefixed));

  const withInline = omp.classifyPrompt(`${userText}\n\n${inlineBlock}`);
  check('O11f an inlined router block does not amplify the verdict',
    withInline['expect-fail'] === false && withInline.receipts === false, JSON.stringify(withInline));

  // The gate must still fire on a REAL request that follows a host block.
  const real = omp.classifyPrompt(`${inlineBlock}\n\nplease commit this and push it`);
  check('O11g a real request after a host block still fires receipts', real.receipts === true, JSON.stringify(real));
}

// ---- O10. Multi-harness install: a leftover dir must not suppress omp ----
// Measured 2026-10-25 (fix-list #10): this repo has `.opencode/` AND `.pi/`, so
// `detectHarness` returned `opencode`, the stamp recorded `copiedAdapters` for pi
// only, and the omp adapters on disk came from a `--refresh` sweep with no
// provenance. A single leftover directory made the omp install silently empty.
{
  const { detectHarness, detectHarnessFamilies } = await import(pathToFileURL(join(ROOT, 'scripts', 'onboarding.mjs')).href);
  const dir = mkdtempSync(join(tmpdir(), 'tna-omp10-'));
  mkdirSync(join(dir, '.opencode'), { recursive: true });
  mkdirSync(join(dir, '.omp'), { recursive: true });
  mkdirSync(join(dir, '.pi'), { recursive: true });

  const families = detectHarnessFamilies(dir);
  check('O10a every harness dir on disk is detected', ['opencode', 'omp', 'pi'].every((f) => families.includes(f)),
    JSON.stringify(families));
  check('O10b detectHarness still names ONE primary (back-compat)',
    typeof detectHarness(dir) === 'string', String(detectHarness(dir)));
  rmSync(dir, { recursive: true, force: true });
}

// ---- O3. The installed skill payload is not stale ----
// Measured 2026-10-25 (fix-list #3): `~/.agents/skills/setup-tna/veto-hooks/omp/`
// held ONLY a 3382-byte tna-veto.ts (pre-2026-10-25: `toolName !== "bash"`, no
// recorder, no discipline adapter), and its onboarding.mjs was 32102 bytes with
// no `--refresh`. An adopter following the official skill instruction therefore
// installed a veto that could never OPEN. Doctor PASSed on the live adapters
// while saying nothing about the payload the next install would use.
{
  const { payloadDriftVerdict } = await import(pathToFileURL(join(ROOT, 'scripts', 'doctor-checks.mjs')).href);
  const stale = payloadDriftVerdict({
    pairs: [{ installed: '/h/.agents/skills/setup-tna/veto-hooks/omp/tna-veto.ts', state: 'drift', installedHash: '9e143c540210', shippedHash: '391535585f0b' }],
  });
  check('O3a a stale installed payload is a WARN', stale.level === 'warn', JSON.stringify(stale));
  check('O3b the message names the payload path and the refresh command',
    /setup-tna/.test(stale.message) && /--refresh|sync-payloads/.test(stale.message), stale.message);

  const current = payloadDriftVerdict({
    pairs: [{ installed: '/h/.agents/skills/setup-tna/veto-hooks/omp/tna-veto.ts', state: 'current' }],
  });
  check('O3c a current payload passes', current.level === 'pass', JSON.stringify(current));

  const none = payloadDriftVerdict({ pairs: [] });
  check('O3d no installed payload is a pass (not installed here)', none.level === 'pass', JSON.stringify(none));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
