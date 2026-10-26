#!/usr/bin/env node
/**
 * Fail-first test for the RECORDER side of the pi/omp/dsh veto adapters (2026-10-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * The VETO side tokenises; the RECORDER side did not. Measured against the pi
 * adapter (v3, 11942 bytes) with the report's own repro:
 *
 *   section A 4/8   ← prefixed test runs never record evidence
 *   section B 15/15 ← veto side intact
 *   section C 3/5   ← heredoc bodies graded as executed code
 *
 * Consequence: on a path-based runner the gate can never OPEN. In a BB thread
 * the session cwd is the workspace root, so `cd <repo> && node x.test.mjs` is
 * the ONLY shape the agent can use — the run prints ALL PASS, records nothing,
 * and the following commit is vetoed forever with `Project state: (missing)`.
 * A veto that cannot open is a wall.
 *
 * Four defects pinned here:
 *   1. TEST_RUN was anchored at the string start, so any `cd`/`;`/`&&` prefix
 *      defeated the recorder while the veto kept firing.
 *   2. A heredoc body was split on newlines and matched as if executed, so
 *      writing a doc that MENTIONS a command was vetoed (happened twice while
 *      producing the report itself).
 *   3. Runner coverage was three shapes (`*.test.mjs`, `npm test`, `bun test`);
 *      vitest/jest/pytest/cargo/go/`npm run test:*` never recorded evidence.
 *   4. The two sides ran different segmenters, so "parity" was a convention.
 *
 * Deliberate NON-goal, stated so it is not mistaken for an oversight: a bare
 * `node t.mjs` does NOT record evidence. Covering every node script would let
 * `node deploy.mjs` open the gate, which makes the gate meaningless — the
 * runner must be recognisable as a test. Pinned by U1.
 *
 * Seam: the adapter's exported `recordedTestRun(command)` + `classifyCommand`.
 * Zero dependencies. Run: node scripts/pi-recorder.test.mjs
 */
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

/** Load one adapter. `.ts` files import directly on Node >= 22.19. */
async function loadAdapter(name) {
  const file = name === 'dsh' ? 'tna-veto.mjs' : 'tna-veto.ts';
  return import(pathToFileURL(join(ROOT, 'veto-hooks', name, file)).href);
}

function makePiHarness() {
  const handlers = new Map();
  const pi = { on(e, h) { handlers.set(e, h); return () => handlers.delete(e); } };
  return {
    pi,
    async call(event, payload, ctx) {
      const h = handlers.get(event);
      return h === undefined ? undefined : h(payload, ctx);
    },
  };
}

const ADAPTERS = ['pi', 'omp', 'dsh'];
const STATE_REL = join('.trust', 'tna-gate-state.json');

// ---- P. A prefixed test run records evidence (the wall) ----
// Same repo, same command, only a `cd` prefix differs — the exact two-row
// measurement in the report where one row landed a commit and the other did not.
for (const name of ADAPTERS) {
  const mod = await loadAdapter(name);
  const recorded = mod.recordedTestRun;
  check(`${name} P0 the adapter exports recordedTestRun (the seam this test drives)`, typeof recorded === 'function');
  if (typeof recorded !== 'function') continue;

  const MUST_RECORD = [
    ['node x.test.mjs', 'bare'],
    ['cd repo && node x.test.mjs', 'cd prefix (the defect)'],
    ['cd repo; node x.test.mjs', 'semicolon prefix'],
    ['cd a/b && node deep/x.test.mjs', 'nested path'],
    ['npm test', 'package script'],
    ['cd repo && npm test', 'cd prefix + npm test'],
    ['cd repo && node x.test.mjs && git commit -m x', 'test then commit, one line'],
  ];
  for (const [cmd, label] of MUST_RECORD) {
    check(`${name} P1 records: ${label}`, recorded(cmd) === true, cmd);
  }
}

// ---- Q. A MENTION is not a run (no false positives) ----
for (const name of ADAPTERS) {
  const mod = await loadAdapter(name);
  if (typeof mod.recordedTestRun !== 'function') continue;
  const MUST_NOT = [
    ['git commit -m "run node x.test.mjs"', 'quoted mention in a commit message'],
    ['echo node x.test.mjs', 'echoed command'],
    ['cat notes.md', 'unrelated'],
    ['npm run build', 'a non-test npm script'],
    ['git push origin master', 'unrelated irreversible action'],
  ];
  for (const [cmd, label] of MUST_NOT) {
    check(`${name} Q1 does not record: ${label}`, mod.recordedTestRun(cmd) === false, cmd);
  }
}

// ---- R. A heredoc body is DATA, not executed code ----
// Blocking prose is a false positive: it happened twice while writing the
// report itself (the write of its own repro script was vetoed).
for (const name of ADAPTERS) {
  const mod = await loadAdapter(name);
  if (typeof mod.classifyCommand !== 'function') continue;
  const HEREDOCS = [
    ["cat > p.md <<'EOF'\nRun: git commit -m x\nEOF", 'prose line'],
    ["cat > p.md <<'EOF'\nDo not run: git push\nEOF", 'prose with colon'],
    ["cat > p.md <<'EOF'\ngit commit -m x\nEOF", 'body line starts with the action'],
    ["cat > p.md <<'EOF'\n2. cd x && git commit -m y\nEOF", 'numbered step using &&'],
    ['cat > p.md <<EOF\ngit push\nEOF', 'unquoted delimiter'],
  ];
  for (const [cmd, label] of HEREDOCS) {
    check(`${name} R1 heredoc body not executed: ${label}`, mod.classifyCommand(cmd).irreversible === false, cmd);
  }
  // The command OUTSIDE the heredoc is still judged — stripping must not blind the gate.
  check(`${name} R2 an action before the heredoc is still caught`,
    mod.classifyCommand("git commit -m x && cat > p.md <<'EOF'\nhello\nEOF").irreversible === true);
  check(`${name} R3 an action AFTER the heredoc is still caught`,
    mod.classifyCommand("cat > p.md <<'EOF'\nhello\nEOF\ngit push origin master").irreversible === true);
}

// ---- S. Runner coverage (the same wall by another route) ----
for (const name of ADAPTERS) {
  const mod = await loadAdapter(name);
  if (typeof mod.recordedTestRun !== 'function') continue;
  const RUNNERS = [
    'npm run test:unit', 'npm run test', 'pnpm test', 'yarn test',
    'npx vitest run', 'vitest', 'jest', 'pytest -q',
    'cargo test', 'go test ./...', 'bun test',
    'node x.test.js', 'node x.test.ts',
  ];
  for (const cmd of RUNNERS) {
    check(`${name} S1 records: ${cmd}`, mod.recordedTestRun(cmd) === true, cmd);
  }
}

// ---- T. The veto side is untouched (no regression from the recorder patch) ----
{
  const { classifyAction } = await import(pathToFileURL(join(ROOT, 'scripts', 'action-gate.mjs')).href);
  const corpus = [
    'git commit -m x', 'git -C . commit --allow-empty -m x', 'git --no-pager push origin master',
    'git -c user.name=x commit -m x', 'npm publish', 'rm -rf dist',
    'git status', 'git -C . status', 'ls -la', 'node scripts/eval.mjs',
    'cd repo && git commit -m x', 'echo hi; git push', 'git commit-tree x',
    'npm test', 'node x.test.mjs',
  ];
  for (const name of ADAPTERS) {
    const mod = await loadAdapter(name);
    const drift = [];
    for (const cmd of corpus) {
      const adapter = mod.classifyCommand(cmd).irreversible;
      const canonical = classifyAction({ tool: 'bash', args: { command: cmd }, evidence: {} }).gated;
      if (adapter !== canonical) drift.push(`${JSON.stringify(cmd)}: adapter=${adapter} canonical=${canonical}`);
    }
    check(`${name} T1 veto grammar still matches the canonical gate on ${corpus.length} commands`,
      drift.length === 0, drift.join(' | '));
  }
}

// ---- U. Deliberate exclusion: a bare node script is not a test ----
for (const name of ADAPTERS) {
  const mod = await loadAdapter(name);
  if (typeof mod.recordedTestRun !== 'function') continue;
  check(`${name} U1 a bare script does not open the gate (node deploy.mjs)`,
    mod.recordedTestRun('node deploy.mjs') === false);
  check(`${name} U2 nor does a build step (node build.mjs)`,
    mod.recordedTestRun('node build.mjs') === false);
}

// ---- V. End-to-end through the adapter's own handler: prefix opens the gate ----
for (const name of ADAPTERS) {
  const mod = await loadAdapter(name);
  const dir = mkdtempSync(join(tmpdir(), `tna-rec-${name}-`));
  if (name === 'dsh') {
    const listeners = new Map();
    const ctx = {
      on(e, h) { const l = listeners.get(e) ?? []; l.push(h); listeners.set(e, l); return () => {}; },
      get(s) { return s === 'workingDirectory' ? { ensure: async () => dir } : (s === 'tools' ? {} : undefined); },
    };
    mod.apply(ctx);
    const fire = async (event, ...args) => {
      const list = listeners.get(event) ?? [];
      let i = 0;
      const next = async () => (i >= list.length ? { kind: 'allow' } : list[i++](...args, next));
      return next();
    };
    const agent = { id: 'fixture' };
    // dsh reports the outcome in the RESULT TEXT, not via isError: a clean run
    // is a text block with no `[exit code: N]` marker (dsh omits it for 0).
    await fire('tools/result',
      { name: 'bash', agent, arguments: { command: 'cd . && node x.test.mjs' } },
      { isError: false, content: [{ type: 'text', text: 'ALL PASS\n' }] });
    check(`${name} V1 a prefixed green run writes the evidence file`, existsSync(join(dir, STATE_REL)));
    const gate = await fire('tools/pre-execute', { name: 'bash', agent, arguments: { command: 'git commit -m x' } });
    check(`${name} V2 the gate OPENS after a prefixed green run`, gate?.kind === 'allow', JSON.stringify(gate));
  } else {
    const h = makePiHarness();
    mod.default(h.pi);
    await h.call('tool_result', {
      toolName: 'bash', input: { command: 'cd . && node x.test.mjs' }, isError: false,
    }, { cwd: dir });
    check(`${name} V1 a prefixed green run writes the evidence file`, existsSync(join(dir, STATE_REL)));
    const gate = await h.call('tool_call', { toolName: 'bash', input: { command: 'git commit -m x' } }, { cwd: dir });
    check(`${name} V2 the gate OPENS after a prefixed green run`, gate === undefined, JSON.stringify(gate));
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
