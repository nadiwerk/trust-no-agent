#!/usr/bin/env node
/**
 * Fail-first test for the pi discipline extension (veto-hooks/pi/tna-discipline.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * pi shipped ONLY the veto. Measured 2026-10-25: `~/.pi/agent/extensions/` held
 * tna-veto.ts and nothing else — no floor injection, no per-prompt MANDATORY
 * classification, no completion-claim gate. So on pi the framework's four Iron
 * Laws were never in context, the trigger matrix never fired, and a "done" claim
 * with no verification in the turn passed silently. The veto blocked the last
 * action while the reasoning that produces that action was unguarded — the exact
 * split TNA exists to remove.
 *
 * omp already carries the same three layers (tna-discipline.ts +
 * tna-receipts-gate.ts). This is the port, not a new design.
 *
 * Seam: the extension's own contract — `default(pi)` registers handlers, and
 * the test drives a fake harness. Assertions are on OBSERVABLE effects
 * (injected prompt text, returned block decisions), never internals.
 *
 * Zero dependencies. Run: node scripts/pi-discipline.test.mjs
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ADAPTER = join(ROOT, 'veto-hooks', 'pi', 'tna-discipline.ts');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

function makeHarness() {
  const handlers = new Map();
  return {
    pi: {
      on(event, handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return () => {};
      },
    },
    async fire(event, payload = {}, ctx = {}) {
      const list = handlers.get(event) ?? [];
      const results = [];
      for (const handler of list) results.push(await handler(payload, ctx));
      return results;
    },
    count(event) { return (handlers.get(event) ?? []).length; },
  };
}

/** A repo with a router, so the floor has something real to quote. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'tna-pi-disc-'));
  // All four laws are required: extractFloor refuses a half floor by design, so
  // a fixture missing one would (correctly) fall through to the installed
  // router and this test would grade the wrong file.
  writeFileSync(join(dir, 'AGENTS.md'), [
    '# Test router',
    '',
    '## 2. Trigger matrix',
    '',
    '| Situation | Load |',
    '|---|---|',
    '| Writing tests | `expect-fail` **MANDATORY** |',
    '',
    '### The four Iron Laws',
    '',
    '1. No acting until the user confirms shared understanding.',
    '2. No production code without a failing test first.',
    '3. No completion claims without fresh verification evidence.',
    '4. No expensive, irreversible, or shared-system action without explicit sign-off.',
    '',
    '### MANDATORY discipline skills — no self-trigger, no exception',
    '',
    '- `expect-fail` — before writing any test.',
    '- `root-cause` — before proposing any fix.',
    '- `receipts` — before any done claim.',
    '',
  ].join('\n'));
  mkdirSync(join(dir, '.trust'), { recursive: true });
  return dir;
}

const mod = await import(pathToFileURL(ADAPTER).href);
check('U1 the extension exports a default factory', typeof mod.default === 'function');

// ---- U. The floor: the router reaches the session ----
{
  const dir = makeRepo();
  const h = makeHarness();
  mod.default(h.pi);
  check('U2 registers a before_agent_start handler', h.count('before_agent_start') > 0);

  const [result] = await h.fire('before_agent_start', {
    systemPrompt: 'BASE SYSTEM PROMPT',
    prompt: 'hello',
  }, { cwd: dir });

  const injected = String(result?.systemPrompt ?? '');
  check('U3 the system prompt is extended, not replaced', injected.startsWith('BASE SYSTEM PROMPT'), injected.slice(0, 80));
  check('U4 the floor carries the Iron Laws', /Iron Law/i.test(injected), injected.slice(0, 200));
  check('U5 the floor names the MANDATORY skills', /expect-fail/i.test(injected));
  check('U6 the floor is quoted from the project router (source = the fixture, laws verbatim)',
    injected.includes(dir) && /No production code without a failing test first/.test(injected),
    injected.slice(0, 300));
  rmSync(dir, { recursive: true, force: true });
}

// ---- V. MANDATORY classification per prompt ----
// A prompt that touches a MANDATORY domain must get a LOAD directive; a neutral
// prompt must not. The classifier is a keyword signal, so this asserts the
// directive appears — never that a rule was "violated".
{
  const dir = makeRepo();
  const h = makeHarness();
  mod.default(h.pi);

  const [testPrompt] = await h.fire('before_agent_start', {
    systemPrompt: 'BASE',
    prompt: 'fix this failing test, it is broken',
  }, { cwd: dir });
  const testText = String(testPrompt?.systemPrompt ?? '');
  check('V1 a bug/test prompt gets a LOAD directive', /expect-fail|root-cause/i.test(testText), testText.slice(-400));

  const [donePrompt] = await h.fire('before_agent_start', {
    systemPrompt: 'BASE',
    prompt: 'ship it, mark it done',
  }, { cwd: dir });
  const doneText = String(donePrompt?.systemPrompt ?? '');
  check('V2 a completion prompt gets the receipts directive', /receipts/i.test(doneText), doneText.slice(-400));

  const h2 = makeHarness();
  mod.default(h2.pi);
  const [neutral] = await h2.fire('before_agent_start', {
    systemPrompt: 'BASE',
    prompt: 'what is the weather like today',
  }, { cwd: dir });
  const neutralText = String(neutral?.systemPrompt ?? '');
  check('V3 a neutral prompt gets no domain directive',
    !/MANDATORY DOMAIN DETECTED/i.test(neutralText), neutralText.slice(-300));
  rmSync(dir, { recursive: true, force: true });
}

// ---- W. The completion-claim gate ----
// A closing claim with no verifying tool call in the turn must be flagged.
// The gate is advisory-or-block by env, exactly like the omp port.
{
  const dir = makeRepo();
  const h = makeHarness();
  mod.default(h.pi);
  check('W1 registers a settle-boundary handler', h.count('agent_before_settle') > 0);

  const claimMessages = [
    { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Done. All tests pass and it is fixed.' }] },
  ];

  const [blocked] = await h.fire('agent_before_settle', {
    entries: [], continue: false, outcome: 'completed', messages: claimMessages,
  }, { cwd: dir });
  check('W2 a bare completion claim is flagged', blocked?.continue === true || /receipts|verification/i.test(JSON.stringify(blocked ?? {})), JSON.stringify(blocked ?? {}).slice(0, 300));

  // A turn that actually ran a checkable tool is left alone.
  const evidenced = [
    { role: 'user', content: [{ type: 'text', text: 'run the tests' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Done. All tests pass.' }, { type: 'tool_use', name: 'bash' }] },
  ];
  const h2 = makeHarness();
  mod.default(h2.pi);
  const [clean] = await h2.fire('agent_before_settle', {
    entries: [], continue: false, outcome: 'completed', messages: evidenced,
  }, { cwd: dir });
  check('W3 an evidenced turn is not flagged', clean?.continue !== true, JSON.stringify(clean ?? {}).slice(0, 200));

  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
