#!/usr/bin/env node
/**
 * Fail-first test for the DeepSeek Harness veto plugin (veto-hooks/dsh/tna-veto.mjs).
 *
 * Why a separate adapter: dsh has no hook JSON file and no `tool_call` event.
 * Its extension point is a cordis service waterfall — `tools/pre-execute`
 * (documented in @deepseek-ai/dsh-tools: "Allow, deny, cancel, or ask before
 * dispatch"), returning `{ kind: 'deny', reason }`. Before this adapter, dsh
 * shipped the router and the skills but NO veto: the framework's central
 * promise ("irreversible actions need sign-off plus fresh evidence") was prose
 * there, and prose is exactly what the framework exists to stop relying on.
 *
 * The seam is the plugin's own public contract: `apply(ctx)` registers
 * listeners on a cordis-like context. The test drives a fake ctx and asserts
 * the DENIAL and the RECORDED STATE — never internal structure.
 *
 * Zero dependencies. Run: node scripts/dsh-veto.test.mjs
 * Exit 0 = every expectation holds. Exit 1 = the adapter drifted or a hole reopened.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ADAPTER = join(ROOT, 'veto-hooks', 'dsh', 'tna-veto.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/**
 * A fake cordis context: records listeners by event name and resolves the two
 * services the plugin injects (`tools` for registration order, and
 * `workingDirectory` for the project cwd — the real dsh contract is
 * `workingDirectory.ensure(agent, signal)`).
 */
function makeCtx(cwd) {
  const listeners = new Map();
  const ctx = {
    cwd,
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return () => {};
    },
    get(service) {
      if (service === 'workingDirectory') {
        return { ensure: async () => cwd };
      }
      if (service === 'tools') return {};
      return undefined;
    },
  };
  return {
    ctx,
    async fire(event, ...args) {
      const list = listeners.get(event) ?? [];
      let index = 0;
      // Waterfall: each listener receives `next` that advances to the following
      // one, with the harness default (`allow`) as the terminal value.
      const next = async () => {
        if (index >= list.length) return { kind: 'allow' };
        const handler = list[index++];
        return handler(...args, next);
      };
      return next();
    },
    count(event) { return (listeners.get(event) ?? []).length; },
  };
}

const STATE_REL = join('.trust', 'tna-gate-state.json');
const agent = { session: { id: 'session-test' }, sessionId: 'session-test' };

const mod = await import(pathToFileURL(ADAPTER).href);
check('P1 the adapter exports a cordis plugin shape (name + apply)', typeof mod.name === 'string' && typeof mod.apply === 'function');
check('P2 the adapter declares its service dependencies', Array.isArray(mod.inject) && mod.inject.includes('tools'));

// ---- Q. The veto itself ----
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-dsh-q-'));
  const h = makeCtx(dir);
  mod.apply(h.ctx);

  const denied = await h.fire('tools/pre-execute', { name: 'bash', arguments: { command: 'git commit -m x' }, agent });
  check('Q1 an irreversible action without evidence is DENIED', denied?.kind === 'deny', JSON.stringify(denied));
  check('Q2 the denial carries a human reason', typeof denied?.reason === 'string' && denied.reason.length > 0, JSON.stringify(denied));
  check('Q3 the reason names the action', /git commit/i.test(String(denied?.reason ?? '')), String(denied?.reason));

  const readOnly = await h.fire('tools/pre-execute', { name: 'bash', arguments: { command: 'git status' }, agent });
  check('Q4 a read-only call is allowed', readOnly?.kind === 'allow', JSON.stringify(readOnly));

  const nonShell = await h.fire('tools/pre-execute', { name: 'read', arguments: { path: 'a.md' }, agent });
  check('Q5 a non-shell tool is allowed', nonShell?.kind === 'allow', JSON.stringify(nonShell));

  // Both dsh shell tools are covered — `pwsh` is a first-class tool on Windows.
  const pwsh = await h.fire('tools/pre-execute', { name: 'pwsh', arguments: { command: 'git push origin master' }, agent });
  check('Q6 the pwsh tool is covered too', pwsh?.kind === 'deny', JSON.stringify(pwsh));

  // git global options do not launder the subcommand (same hole as pi/omp).
  for (const command of ['git -C . commit -m x', 'git --no-pager push origin master']) {
    const v = await h.fire('tools/pre-execute', { name: 'bash', arguments: { command }, agent });
    check(`Q7 blocks laundered: ${command}`, v?.kind === 'deny', JSON.stringify(v));
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- R. The recorder: the gate must be able to OPEN ----
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-dsh-r-'));
  const h = makeCtx(dir);
  mod.apply(h.ctx);
  check('R1 registers a result observer', h.count('tools/result') > 0);

  writeFileSync(join(dir, 'x.test.mjs'), 'process.exit(0);\n');
  await h.fire('tools/result',
    { name: 'bash', arguments: { command: 'node x.test.mjs' }, agent },
    { isError: false, content: [{ type: 'text', text: 'ok' }] });

  const statePath = join(dir, STATE_REL);
  check('R2 a green test run writes the evidence file', existsSync(statePath));
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    check('R3 recorded testPassFresh=true', state.testPassFresh === true, JSON.stringify(state));
  } else {
    check('R3 recorded testPassFresh=true', false, 'no state file');
  }

  const open = await h.fire('tools/pre-execute', { name: 'bash', arguments: { command: 'git commit -m x' }, agent });
  check('R4 the gate OPENS after fresh evidence', open?.kind === 'allow', JSON.stringify(open));

  await h.fire('tools/result',
    { name: 'bash', arguments: { command: 'node x.test.mjs' }, agent },
    { isError: true, content: [{ type: 'text', text: 'boom' }] });
  const closed = await h.fire('tools/pre-execute', { name: 'bash', arguments: { command: 'git commit -m x' }, agent });
  check('R5 a red test run closes the gate again', closed?.kind === 'deny', JSON.stringify(closed));

  const dir2 = mkdtempSync(join(tmpdir(), 'tna-dsh-r2-'));
  const h2 = makeCtx(dir2);
  mod.apply(h2.ctx);
  await h2.fire('tools/result',
    { name: 'bash', arguments: { command: 'echo hi' }, agent },
    { isError: false, content: [{ type: 'text', text: 'hi' }] });
  check('R6 a non-test command writes no evidence', existsSync(join(dir2, STATE_REL)) === false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(dir2, { recursive: true, force: true });
}

// ---- S. Parity with the canonical gate (the copy cannot drift) ----
{
  const { classifyAction } = await import(pathToFileURL(join(ROOT, 'scripts', 'action-gate.mjs')).href);
  const corpus = [
    'git commit -m x', 'git -C . commit --allow-empty -m x', 'git --no-pager push origin master',
    'git -c user.name=x commit -m x', 'git --git-dir=.git commit -m x', 'npm publish', 'rm -rf dist',
    'git status', 'git -C . status', 'git --no-pager log --oneline -5', 'ls -la',
    'node scripts/eval.mjs', 'cd repo && git commit -m x', 'npm test; git push origin master',
    // Widened 2026-11-03 with the canonical gate's new coverage (see the pi/omp
    // parity corpus for the reasoning: a copy that lags allows what the
    // canonical gate refuses).
    'git.exe push origin master',
    '"C:\\Program Files\\Git\\cmd\\git.exe" push origin master',
    'rm -r -f dist', 'rm -fr dist', 'rm -f -r dist', 'rm --recursive --force dist',
    'Remove-Item -Recurse -Force dist', 'del /s /q dist', 'rd /s /q dist',
    'pnpm publish', 'yarn publish', 'yarn npm publish',
    'gh pr merge 12 --squash', 'gh release create v1 --notes x',
    'git push --dry-run', 'git commit --help', 'npm publish --dry-run',
    'pnpm publish --dry-run', 'gh pr merge --help', 'git commit -m "--help"',
    'git push -o --dry-run origin master',
    'rm dist', 'del dist', 'Remove-Item -Force dist', 'gh pr view 12', 'pnpm install',
  ];
  const drift = [];
  for (const command of corpus) {
    const adapter = mod.classifyCommand(command).irreversible;
    const canonical = classifyAction({ tool: 'bash', args: { command }, evidence: {} }).gated;
    if (adapter !== canonical) drift.push(`${JSON.stringify(command)}: adapter=${adapter} canonical=${canonical}`);
  }
  check(`S1 adapter grammar matches the canonical gate on ${corpus.length} commands`, drift.length === 0, drift.join(' | '));
}

// ---- T. The private ledger is append-only (2026-10-25) ----
// The canonical classifier gates a write/edit whose target IS
// `.trust/progress.txt` regardless of evidence — fresh evidence cannot restore
// overwritten history (incident 2026-10-18; it recurred for real on 2026-10-25
// as a UTF-16 corruption). The adapter must draw the same boundary.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-dsh-t-'));
  const h = makeCtx(dir);
  mod.apply(h.ctx);

  for (const toolName of ['write', 'edit']) {
    const v = await h.fire('tools/pre-execute', {
      name: toolName,
      arguments: { path: join(dir, '.trust', 'progress.txt'), content: 'clobbered' },
      agent,
    });
    check(`T1 ${toolName} to the ledger is denied`, v?.kind === 'deny', JSON.stringify(v));
  }

  // Fresh evidence must NOT open this one: history cannot be restored.
  mkdirSync(join(dir, '.trust'), { recursive: true });
  writeFileSync(join(dir, STATE_REL), JSON.stringify({ testPassFresh: true }));
  const withEvidence = await h.fire('tools/pre-execute', {
    name: 'write', arguments: { path: join(dir, '.trust', 'progress.txt'), content: 'x' }, agent,
  });
  check('T2 fresh evidence does NOT open a ledger overwrite', withEvidence?.kind === 'deny', JSON.stringify(withEvidence));

  const sibling = await h.fire('tools/pre-execute', {
    name: 'write', arguments: { path: join(dir, 'notes-on-progress.txt'), content: 'ok' }, agent,
  });
  check('T3 a look-alike path stays open', sibling?.kind === 'allow', JSON.stringify(sibling));
  rmSync(dir, { recursive: true, force: true });
}

// ---- U. A patch is judged by its targets (2026-11-03) ----
// Same boundary as the canonical gate and the pi/omp adapters: an
// `apply_patch` carries its diff in `command`, so a patch that UPDATED or
// DELETED `.trust/progress.txt` rewrote the private ledger and the adapter's
// guard — reading only `path`/`file_path` — let it through. A patch whose
// CONTEXT line merely mentions an irreversible action stays open: text a tool
// will not execute is data, not an action.
{
  const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'tna-dsh-u-'));
  const h = makeCtx(dir);
  mod.apply(h.ctx);
  for (const [body, label] of [
    [patch('*** Update File: .trust/progress.txt', '@@', '-old', '+new'), 'Update File'],
    [patch('*** Delete File: .trust/progress.txt'), 'Delete File'],
    [patch('*** Update File: .trust/progress.txt', '@@', '+x', '*** Update File: src/a.ts', '+y'), 'ledger named first of two'],
  ]) {
    const v = await h.fire('tools/pre-execute', { name: 'apply_patch', arguments: { command: body }, agent });
    check(`U1 apply_patch ${label} of the ledger is denied`, v?.kind === 'deny', JSON.stringify(v));
  }
  const open = await h.fire('tools/pre-execute', {
    name: 'apply_patch',
    arguments: { command: patch('*** Update File: docs/guide.md', '@@', ' git push origin master', '+git push --force') },
    agent,
  });
  check('U2 a patch that only MENTIONS the action stays open', !open || open.kind !== 'deny', JSON.stringify(open));
  rmSync(dir, { recursive: true, force: true });
}

// ---- W. Evidence binds to the RESOLVED dir (roast r1/r3 parity) ----
// Same contract as the canonical gate and the pi/omp adapters: `cd X && test`
// certifies X when the dest exists; a dir-changer hidden in any wrapper,
// quoting, redirect, indirection, launcher payload, dir flag, or encoded
// command certifies NOTHING.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-dsh-w-'));
  mkdirSync(join(dir, 'repo'));
  const h = makeCtx(dir);
  mod.apply(h.ctx);
  await h.fire('tools/result',
    { name: 'bash', arguments: { command: 'cd repo && node x.test.mjs' }, agent },
    { isError: false, content: [{ type: 'text', text: 'ok' }] });
  const destState = join(dir, 'repo', STATE_REL);
  check('W1 a cd && test binds evidence to the resolved dir',
    existsSync(destState) && JSON.parse(readFileSync(destState, 'utf8')).testPassFresh === true
      && !existsSync(join(dir, STATE_REL)),
    `dest=${existsSync(destState)} payload=${existsSync(join(dir, STATE_REL))}`);
  rmSync(dir, { recursive: true, force: true });

  for (const [label, command] of [
    ['parens subshell', '(cd repo) && node x.test.mjs'],
    ['nested bash -c', 'bash -c "cd repo" && node x.test.mjs'],
    ['quoted prog', `'cd' repo && node x.test.mjs`],
    ['escaped prog', 'c\\d repo && node x.test.mjs'],
    ['redirect boundary', 'cd>x && node x.test.mjs'],
    ['${IFS} indirection', 'cd${IFS}repo && node x.test.mjs'],
    ['interpreter -c', 'python -c "import os;os.chdir(\'repo\')" && node x.test.mjs'],
    ['make -C flag', 'make -C repo test && node x.test.mjs'],
    ['encoded powershell', 'powershell -e Y2QgcmVwbw && node x.test.mjs'],
    ['missing dest', 'cd nope-not-here && node x.test.mjs'],
  ]) {
    const d2 = mkdtempSync(join(tmpdir(), 'tna-dsh-w2-'));
    mkdirSync(join(d2, 'repo'));
    const h2 = makeCtx(d2);
    mod.apply(h2.ctx);
    await h2.fire('tools/result',
      { name: 'bash', arguments: { command }, agent },
      { isError: false, content: [{ type: 'text', text: 'ok' }] });
    check(`W2 ${label}: records evidence NOWHERE`,
      !existsSync(join(d2, STATE_REL)) && !existsSync(join(d2, 'repo', STATE_REL)),
      `cmd=${command}`);
    rmSync(d2, { recursive: true, force: true });
  }

  const dir3 = mkdtempSync(join(tmpdir(), 'tna-dsh-w3-'));
  const h3 = makeCtx(dir3);
  mod.apply(h3.ctx);
  await h3.fire('tools/result',
    { name: 'bash', arguments: { command: 'echo "remember cd" && node x.test.mjs' }, agent },
    { isError: false, content: [{ type: 'text', text: 'ok' }] });
  check('W3 a quoted non-dir-change mention still binds to cwd',
    existsSync(join(dir3, STATE_REL)), `state=${existsSync(join(dir3, STATE_REL))}`);
  rmSync(dir3, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
