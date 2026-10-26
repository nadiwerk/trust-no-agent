#!/usr/bin/env node
/**
 * Fail-first test for the pi and omp veto adapters (veto-hooks/{pi,omp}/tna-veto.ts).
 *
 * Why this exists — three holes measured live 2026-10-25, all in the same
 * direction: the adapter LOOKED wired (it blocked a plain `git commit`) while
 * the guarantee leaked three ways:
 *
 *   1. TOOL-NAME COVERAGE. Both adapters returned early unless
 *      `event.toolName === "bash"`. pi declares a `powershell` tool with the
 *      same `{ command }` input (dist/core/extensions/types.d.ts:
 *      PowerShellToolCallEvent), so on Windows the same irreversible action
 *      through that tool was never even looked at.
 *
 *   2. GIT GLOBAL OPTIONS. Classification was a substring test for the literal
 *      "git commit"; `git -C . commit --allow-empty` ran a real commit while
 *      the adapter saw no pattern (measured: commit 7aa82a7 landed).
 *
 *   3. NO EVIDENCE RECORDER. Neither adapter listened for a finished tool call,
 *      so `.trust/tna-gate-state.json` was never written by the harness — the
 *      gate could never open. Measured: `node x.test.mjs` ran green, then the
 *      commit was still vetoed with "Project state: (missing)". A veto that
 *      cannot open is not a gate; it is a wall, and the operator learns to
 *      bypass it.
 *
 * The seam is the adapter's own public contract: `default(pi)` registers
 * handlers on a harness object. The test drives a fake harness and asserts the
 * DENIAL and the RECORDED STATE — never internal structure.
 *
 * Zero dependencies. Run: node scripts/veto-adapter.test.mjs
 * Exit 0 = every expectation holds. Exit 1 = an adapter drifted or a hole reopened.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
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

/** A fake harness: records handlers by event name, invokes them like the runtime. */
function makeHarness() {
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  };
  return {
    pi,
    async call(event, payload, ctx) {
      const handler = handlers.get(event);
      if (handler === undefined) return undefined;
      return handler(payload, ctx);
    },
    has(event) { return handlers.has(event); },
  };
}

const STATE_REL = join('.trust', 'tna-gate-state.json');

for (const harnessName of ['pi', 'omp']) {
  const adapterPath = join(ROOT, 'veto-hooks', harnessName, 'tna-veto.ts');
  const mod = await import(pathToFileURL(adapterPath).href);
  const adapter = mod.default;

  // ---- K. Tool-name coverage: the same action through any shell tool ----
  // `powershell` is declared by pi's own type surface with the same `command`
  // input. A gate that only watches `bash` is bypassed by asking for the
  // other shell — no adversarial intent required, just a Windows session.
  {
    const h = makeHarness();
    adapter(h.pi);
    const dir = mkdtempSync(join(tmpdir(), `tna-${harnessName}-k-`));
    const v = await h.call('tool_call', { toolName: 'powershell', input: { command: 'git commit -m x' } }, { cwd: dir });
    check(`${harnessName} K1 powershell git commit is blocked`, v?.block === true, JSON.stringify(v));
    const okRead = await h.call('tool_call', { toolName: 'powershell', input: { command: 'git status' } }, { cwd: dir });
    check(`${harnessName} K2 powershell read-only stays open`, okRead === undefined, JSON.stringify(okRead));
    rmSync(dir, { recursive: true, force: true });
  }

  // ---- L. git global options do not launder the subcommand ----
  {
    const h = makeHarness();
    adapter(h.pi);
    const dir = mkdtempSync(join(tmpdir(), `tna-${harnessName}-l-`));
    for (const command of ['git -C . commit -m x', 'git --no-pager push origin master', 'git -c user.name=x commit -m x']) {
      const v = await h.call('tool_call', { toolName: 'bash', input: { command } }, { cwd: dir });
      check(`${harnessName} L1 blocks laundered: ${command}`, v?.block === true, JSON.stringify(v));
    }
    const status = await h.call('tool_call', { toolName: 'bash', input: { command: 'git -C . status' } }, { cwd: dir });
    check(`${harnessName} L2 read-only git stays open`, status === undefined, JSON.stringify(status));
    rmSync(dir, { recursive: true, force: true });
  }

  // ---- M. The recorder: a green test run opens the gate, a red one does not ----
  // Without this the veto is permanent: nothing in the harness ever writes the
  // evidence file, so every irreversible action is refused forever.
  {
    const h = makeHarness();
    adapter(h.pi);
    const dir = mkdtempSync(join(tmpdir(), `tna-${harnessName}-m-`));
    writeFileSync(join(dir, 'x.test.mjs'), 'process.exit(0);\n');

    check(`${harnessName} M1 registers a tool_result recorder`, h.has('tool_result') === true);

    await h.call('tool_result', {
      toolName: 'bash',
      input: { command: 'node x.test.mjs' },
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }, { cwd: dir });

    const statePath = join(dir, STATE_REL);
    check(`${harnessName} M2 a green test run writes the evidence file`, existsSync(statePath));
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      check(`${harnessName} M3 recorded testPassFresh=true`, state.testPassFresh === true, JSON.stringify(state));
    } else {
      check(`${harnessName} M3 recorded testPassFresh=true`, false, 'no state file');
    }

    const open = await h.call('tool_call', { toolName: 'bash', input: { command: 'git commit -m x' } }, { cwd: dir });
    check(`${harnessName} M4 the gate OPENS after fresh evidence`, open === undefined, JSON.stringify(open));

    // A red run must close it again — a stale true after a failing suite is the
    // exact hole tna-gate.mjs's observeAfter was built to close.
    await h.call('tool_result', {
      toolName: 'bash',
      input: { command: 'node x.test.mjs' },
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    }, { cwd: dir });
    const closed = await h.call('tool_call', { toolName: 'bash', input: { command: 'git commit -m x' } }, { cwd: dir });
    check(`${harnessName} M5 a red test run closes the gate again`, closed?.block === true, JSON.stringify(closed));

    // A non-test command records nothing (it is not evidence).
    const dir2 = mkdtempSync(join(tmpdir(), `tna-${harnessName}-m2-`));
    const h2 = makeHarness();
    adapter(h2.pi);
    await h2.call('tool_result', {
      toolName: 'bash', input: { command: 'echo hello' }, content: [{ type: 'text', text: 'hello' }], isError: false,
    }, { cwd: dir2 });
    check(`${harnessName} M6 a non-test command writes no evidence`, existsSync(join(dir2, STATE_REL)) === false);
    rmSync(dir, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
}

// ---- N. Parity with the canonical gate (the copy cannot drift) ----
// The adapters are self-contained copies of the grammar in
// scripts/action-gate.mjs because onboarding installs them where scripts/ does
// not exist. That duplication is only safe while it is PINNED: for every
// command below, the adapter and the canonical classifier must agree. A future
// edit to one side alone fails here instead of shipping a silent divergence.
{
  const { classifyAction } = await import(pathToFileURL(join(ROOT, 'scripts', 'action-gate.mjs')).href);
  const corpus = [
    'git commit -m x',
    'git -C . commit --allow-empty -m x',
    'git --no-pager push origin master',
    'git -c user.name=x commit -m x',
    'git --git-dir=.git commit -m x',
    'npm publish',
    'rm -rf dist',
    'git status',
    'git -C . status',
    'git --no-pager log --oneline -5',
    'ls -la',
    'node scripts/eval.mjs',
    'cd repo && git commit -m x',
    'npm test; git push origin master',
  ];
  for (const harnessName of ['pi', 'omp']) {
    const mod = await import(pathToFileURL(join(ROOT, 'veto-hooks', harnessName, 'tna-veto.ts')).href);
    const drift = [];
    for (const command of corpus) {
      const adapter = mod.classifyCommand(command).irreversible;
      const canonical = classifyAction({ tool: 'bash', args: { command }, evidence: {} }).gated;
      if (adapter !== canonical) drift.push(`${JSON.stringify(command)}: adapter=${adapter} canonical=${canonical}`);
    }
    check(`${harnessName} N1 adapter grammar matches the canonical gate on ${corpus.length} commands`,
      drift.length === 0, drift.join(' | '));
  }
}

// ---- T. The private ledger is append-only on every adapter (2026-10-25) ----
// The canonical classifier gates a `write`/`edit` whose target IS
// `.trust/progress.txt` regardless of evidence — fresh evidence cannot restore
// overwritten history (ledger-overwrite incident 2026-10-18; it happened again
// for real on 2026-10-25 as a UTF-16 corruption). The adapters only looked at
// `command`, so a `write`/`edit` to the ledger sailed through. This is the same
// boundary the canonical gate draws, checked here on the adapter's own surface.
for (const harnessName of ['pi', 'omp']) {
  const adapter = (await import(pathToFileURL(join(ROOT, 'veto-hooks', harnessName, 'tna-veto.ts')).href)).default;
  const h = makeHarness();
  adapter(h.pi);
  const dir = mkdtempSync(join(tmpdir(), `tna-${harnessName}-t-`));

  for (const toolName of ['write', 'edit']) {
    const v = await h.call('tool_call', {
      toolName,
      input: { path: join(dir, '.trust', 'progress.txt'), content: 'clobbered' },
    }, { cwd: dir });
    check(`${harnessName} T1 ${toolName} to the ledger is blocked`, v?.block === true, JSON.stringify(v));
  }

  // Fresh evidence must NOT open this one: history cannot be restored.
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, STATE_REL), JSON.stringify({ testPassFresh: true }));
  const withEvidence = await h.call('tool_call', {
    toolName: 'write', input: { path: join(dir, '.trust', 'progress.txt'), content: 'x' },
  }, { cwd: dir });
  check(`${harnessName} T2 fresh evidence does NOT open a ledger overwrite`, withEvidence?.block === true, JSON.stringify(withEvidence));

  // A sibling that merely mentions the name is not the ledger.
  const sibling = await h.call('tool_call', {
    toolName: 'write', input: { path: join(dir, 'notes-on-progress.txt'), content: 'ok' },
  }, { cwd: dir });
  check(`${harnessName} T3 a look-alike path stays open`, sibling === undefined, JSON.stringify(sibling));

  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
