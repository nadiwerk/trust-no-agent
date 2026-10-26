#!/usr/bin/env node
/**
 * Fail-first test for TOOL COVERAGE beyond shell tools (2026-10-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * The adapters guard any tool carrying `{ command }` (bash/powershell/pwsh/
 * shell/exec_command). But two harnesses also expose tools that RUN CODE without
 * a `command` field — enumerated from the installed packages, not assumed:
 *
 *   omp  `eval`    — a JS/Python cell with Bun.$ / subprocess; declared in
 *                    @oh-my-pi/pi-coding-agent (BUILTIN_TOOL_NAMES includes
 *                    `eval`, approval: "exec").
 *   dsh  `ralph`, `workflow`, `subagent` — long-running orchestrators that fan
 *                    out child agents which can themselves run shell
 *                    (@deepseek-ai/dsh-tool-{ralph,workflow,subagent}).
 *
 * A `git commit` issued inside an eval cell or a workflow script never passes
 * through the `command` path, so today it is not examined at all. This test
 * pins the coverage that closes that: the SAME execution-position classifier
 * runs over the code/script text of those tools.
 *
 * What is deliberately NOT done: blocking `eval` outright. An eval cell that
 * only computes a number is not an irreversible action; the classifier decides
 * on the payload, exactly as it does for a shell string.
 *
 * Zero dependencies. Run: node scripts/veto-tool-coverage.test.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

function makePiHarness() {
  const handlers = new Map();
  const pi = { on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event); } };
  return {
    pi,
    async call(event, payload, ctx) {
      const h = handlers.get(event);
      return h === undefined ? undefined : h(payload, ctx);
    },
    has: (event) => handlers.has(event),
  };
}

function makeDshCtx(cwd) {
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
      if (service === 'tools') return {};
      return undefined;
    },
  };
  return {
    ctx,
    async fire(event, ...args) {
      const list = listeners.get(event) ?? [];
      let i = 0;
      const next = async () => (i >= list.length ? { kind: 'allow' } : list[i++](...args, next));
      return next();
    },
  };
}

const STATE_REL = join('.trust', 'tna-gate-state.json');

// ---- C1. omp `eval`: a cell that runs an irreversible shell command is gated ----
{
  const adapter = (await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')).href)).default;
  const h = makePiHarness();
  adapter(h.pi);
  const dir = mkdtempSync(join(tmpdir(), 'tna-eval-omp-'));

  const commit = await h.call('tool_call', {
    toolName: 'eval',
    input: { language: 'js', code: 'await Bun.$`git commit -m x`.quiet();' },
  }, { cwd: dir });
  check('C1a eval running a git commit is blocked', commit?.block === true, JSON.stringify(commit));

  const pyCommit = await h.call('tool_call', {
    toolName: 'eval',
    input: { language: 'py', code: 'import subprocess\nsubprocess.run(["git", "commit", "-m", "x"])' },
  }, { cwd: dir });
  check('C1b a python cell shelling out to git commit is blocked', pyCommit?.block === true, JSON.stringify(pyCommit));

  const math = await h.call('tool_call', {
    toolName: 'eval',
    input: { language: 'js', code: 'return 2 + 2;' },
  }, { cwd: dir });
  check('C1c an eval cell that computes is NOT blocked', math === undefined, JSON.stringify(math));

  // Fresh evidence opens it, exactly like a shell command: the boundary is the
  // ACTION, not the tool.
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, STATE_REL), JSON.stringify({ testPassFresh: true, updatedAt: new Date().toISOString() }));
  const withEvidence = await h.call('tool_call', {
    toolName: 'eval',
    input: { language: 'js', code: 'await Bun.$`git commit -m x`;' },
  }, { cwd: dir });
  check('C1d fresh evidence opens the eval gate too', withEvidence === undefined, JSON.stringify(withEvidence));
  rmSync(dir, { recursive: true, force: true });
}

// ---- C2. omp `eval` recorder: a green test run inside a cell is evidence ----
{
  const adapter = (await import(pathToFileURL(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')).href)).default;
  const h = makePiHarness();
  adapter(h.pi);
  const dir = mkdtempSync(join(tmpdir(), 'tna-eval-rec-'));
  await h.call('tool_result', {
    toolName: 'eval',
    input: { language: 'js', code: 'await Bun.$`node x.test.mjs`;' },
    isError: false,
  }, { cwd: dir });
  check('C2 a test run inside an eval cell writes evidence', existsSync(join(dir, STATE_REL)));
  rmSync(dir, { recursive: true, force: true });
}

// ---- C3. dsh `workflow` / `ralph` / `subagent`: a script that commits is gated ----
// `agent` is part of the real execution object (the adapter resolves the project
// cwd through `workingDirectory.ensure(exec.agent, signal)`); a fixture without
// it would silently fall back to process.cwd() and read THIS repo's evidence.
{
  const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', 'dsh', 'tna-veto.mjs')).href);
  const dir = mkdtempSync(join(tmpdir(), 'tna-dsh-orch-'));
  const h = makeDshCtx(dir);
  mod.apply(h.ctx);
  const agent = { id: 'fixture-agent' };

  const workflow = await h.fire('tools/pre-execute', {
    name: 'workflow',
    agent,
    arguments: { script: 'const a = await agent("commit the work: git commit -m x");' },
  });
  check('C3a a workflow script that commits is denied', workflow?.kind === 'deny', JSON.stringify(workflow));

  const ralph = await h.fire('tools/pre-execute', {
    name: 'ralph',
    agent,
    arguments: { objective: 'loop until `git push origin master` succeeds' },
  });
  check('C3b a ralph objective that pushes is denied', ralph?.kind === 'deny', JSON.stringify(ralph));

  const subagent = await h.fire('tools/pre-execute', {
    name: 'subagent',
    agent,
    arguments: { prompt: 'run npm publish for the release' },
  });
  check('C3c a subagent prompt that publishes is denied', subagent?.kind === 'deny', JSON.stringify(subagent));

  const harmless = await h.fire('tools/pre-execute', {
    name: 'workflow',
    agent,
    arguments: { script: 'const r = await agent("summarise the README");' },
  });
  check('C3d a workflow that does no irreversible action is allowed', harmless?.kind === 'allow', JSON.stringify(harmless));

  // Evidence opens the same gate.
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, STATE_REL), JSON.stringify({ testPassFresh: true, updatedAt: new Date().toISOString() }));
  const open = await h.fire('tools/pre-execute', {
    name: 'workflow',
    agent,
    arguments: { script: 'git commit -m x' },
  });
  check('C3e fresh evidence opens the orchestrator gate', open?.kind === 'allow', JSON.stringify(open));
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
