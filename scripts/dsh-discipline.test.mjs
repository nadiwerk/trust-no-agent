#!/usr/bin/env node
/**
 * Fail-first test for the dsh discipline plugin (veto-hooks/dsh/tna-discipline.mjs).
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured 2026-10-25: dsh had the veto and (via its own AGENTS.md reading) a
 * partial floor — but no per-prompt MANDATORY classification and no
 * completion-claim gate. On dsh, "I'll write the test after" and "done" with no
 * verification both passed silently. The router's prose was present; the
 * mechanical boundary around the MANDATORY domains was not.
 *
 * dsh has no `tool_call`-style prompt hook, but it does have the cordis
 * waterfall `agent/pre-step` (payload `{ agent, messages, step, signal }`,
 * decision `{ messages, ... }`) — the same seam dsh-time-context and
 * dsh-agent-instructions use to inject context. That is the port target.
 *
 * Seam: the plugin's own contract — `apply(ctx)` registers listeners on a
 * cordis-like context. Assertions are on OBSERVABLE effects (messages appended
 * to the step decision), never internals.
 *
 * Zero dependencies. Run: node scripts/dsh-discipline.test.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ADAPTER = join(ROOT, 'veto-hooks', 'dsh', 'tna-discipline.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

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
      if (service === 'workingDirectory') return { ensure: async () => cwd };
      return undefined;
    },
  };
  return {
    ctx,
    async fire(event, ...args) {
      const list = listeners.get(event) ?? [];
      let index = 0;
      const next = async () => {
        if (index >= list.length) return { kind: 'continue', messages: [] };
        const handler = list[index++];
        return handler(...args, next);
      };
      return next();
    },
    count(event) { return (listeners.get(event) ?? []).length; },
  };
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'tna-dsh-disc-'));
  writeFileSync(join(dir, 'AGENTS.md'), [
    '# Test router',
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

const agent = { session: { id: 'session-test' }, sessionId: 'session-test' };

const mod = await import(pathToFileURL(ADAPTER).href);
check('X1 the plugin exports a cordis plugin shape (name + apply)', typeof mod.name === 'string' && typeof mod.apply === 'function');
check('X2 the plugin registers an agent/pre-step listener', (() => {
  const h = makeCtx(process.cwd());
  mod.apply(h.ctx);
  return h.count('agent/pre-step') > 0;
})());

// ---- Y. MANDATORY classification per step ----
{
  const dir = makeRepo();
  const h = makeCtx(dir);
  mod.apply(h.ctx);

  const flagged = await h.fire('agent/pre-step', {
    agent, messages: [], step: 1, turn: 1,
  }, async () => ({ kind: 'continue', messages: [] }));
  // Step 1 has no user prompt text of its own in this fake; the classifier reads
  // the newest user message, so feed one.
  const withPrompt = await h.fire('agent/pre-step', {
    agent,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'the tests are failing, fix the bug' }] }],
    step: 1, turn: 1,
  }, async () => ({ kind: 'continue', messages: [] }));

  const text = JSON.stringify(withPrompt ?? {});
  check('Y1 a MANDATORY-domain prompt gets a LOAD directive', /MANDATORY DOMAIN DETECTED/i.test(text), text.slice(0, 400));
  check('Y2 the directive names the flagged skills', /expect-fail|root-cause/i.test(text), text.slice(0, 400));

  const neutral = await h.fire('agent/pre-step', {
    agent,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'what is the weather today' }] }],
    step: 1, turn: 1,
  }, async () => ({ kind: 'continue', messages: [] }));
  check('Y3 a neutral prompt adds nothing', !/MANDATORY DOMAIN DETECTED/i.test(JSON.stringify(neutral ?? {})), JSON.stringify(neutral ?? {}).slice(0, 200));

  // The plugin must never swallow a rejection decision from a later listener.
  const rejected = await h.fire('agent/pre-step', {
    agent, messages: [], step: 1, turn: 1,
  }, async () => ({ kind: 'reject', reason: 'nope' }));
  check('Y4 a reject decision passes through untouched', rejected?.kind === 'reject', JSON.stringify(rejected ?? {}));
  rmSync(dir, { recursive: true, force: true });
}

// ---- Z. The completion-claim gate ----
{
  const dir = makeRepo();
  const h = makeCtx(dir);
  mod.apply(h.ctx);

  const claim = await h.fire('agent/pre-step', {
    agent,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done. All tests pass and it is fixed.' }] },
    ],
    step: 2, turn: 1,
  }, async () => ({ kind: 'continue', messages: [] }));
  check('Z1 a bare completion claim gets the receipts notice', /receipts gate|verification/i.test(JSON.stringify(claim ?? {})), JSON.stringify(claim ?? {}).slice(0, 300));

  const evidenced = await h.fire('agent/pre-step', {
    agent,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'run the tests' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'Done. All tests pass.' },
        { type: 'tool_use', name: 'bash' },
      ] },
    ],
    step: 2, turn: 1,
  }, async () => ({ kind: 'continue', messages: [] }));
  check('Z2 an evidenced turn is not flagged', !/receipts gate/i.test(JSON.stringify(evidenced ?? {})), JSON.stringify(evidenced ?? {}).slice(0, 200));

  rmSync(dir, { recursive: true, force: true });
}

// ---- AA. next() is called exactly once (regression, 2026-10-25) ----
// The first version of this plugin called `next()` a second time from its catch
// block. The waterfall's index had already advanced, so the second call resolved
// undefined and the harness died with "Cannot read properties of undefined
// (reading 'kind')" — measured live on `dsh --profile headless`. A discipline
// plugin that crashes the session is worse than no plugin, so the call count is
// pinned here.
{
  const dir = makeRepo();
  let calls = 0;
  const listeners = [];
  const ctx = {
    on(_event, handler) { listeners.push(handler); return () => {}; },
    get(service) {
      if (service === 'workingDirectory') return { ensure: async () => dir };
      return undefined;
    },
  };
  mod.apply(ctx);

  // Drive the real waterfall shape: the terminal default returns {kind:'enter'}.
  // The handler is async (it lazily imports createUserMessage), so it MUST be
  // awaited — a sync read sees only the pending promise and every injection
  // assertion silently reads an empty decision.
  const handler = listeners[0];
  const result = await handler(
    { agent, messages: [{ role: 'user', content: [{ type: 'text', text: 'the tests are failing' }] }], step: 1, turn: 1 },
    async () => { calls += 1; return { kind: 'enter', messages: [] }; },
  );
  check('AA1 next() is called exactly once', calls === 1, `calls=${calls}`);
  check('AA2 the decision kind survives the injection', result?.kind === 'enter', JSON.stringify(result ?? {}).slice(0, 200));

  // A throwing terminal must not be retried either: the plugin returns undefined
  // and lets the harness own the failure.
  const calls2 = { n: 0 };
  const h2 = makeCtx(dir);
  mod.apply(h2.ctx);
  const thrown = await h2.fire('agent/pre-step', { agent, messages: [], step: 1, turn: 1 },
    async () => { calls2.n += 1; throw new Error('downstream boom'); }).catch(() => 'threw');
  check('AA3 a throwing downstream is not retried', calls2.n === 1, `calls=${calls2.n} result=${JSON.stringify(thrown ?? {}).slice(0, 120)}`);
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
