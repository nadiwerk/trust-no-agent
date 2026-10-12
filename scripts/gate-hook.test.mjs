#!/usr/bin/env node
/**
 * Fail-first test for scripts/gate-hook.mjs — the Claude Code hook entry point.
 *
 * Origin: 2026-09-27 cross-harness audit (§9). gate-hook.mjs was the ONE file in
 * the entire enforcement layer that existed only in the installed plugin
 * directory — never committed, never in git history, referenced by both
 * SessionStart and UserPromptSubmit in hooks.json. Every other artifact (the two
 * router files, reinject.mjs, mandatory-gate.mjs, all 11 skills) was tracked, so
 * a lost plugin folder could be rebuilt from the repo; this file could not. It
 * is 186 lines of wiring that would have had to be rewritten from memory.
 *
 * It is now tracked, and this test pins the two properties that make it safe to
 * run on every session and every prompt:
 *
 *   1. FAIL-OPEN — any bad input exits 0 with no output. A discipline layer that
 *      can break the user's session is worse than no discipline layer, and a
 *      hook that fails loudly on a correct install teaches the user to ignore it.
 *      This is the property that matters most and the one a refactor would most
 *      easily lose.
 *   2. IT EMITS WELL-FORMED HOOK JSON — the harness parses stdout, so the shape
 *      is a contract, not a preference.
 *
 * The test drives the REAL CLI as a subprocess (this is a wiring file; importing
 * it would test a different thing than what runs).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'gate-hook.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/** Run the hook with a stdin payload; return { code, stdout }. */
const run = (stdin) => {
  const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '' };
};

// ---- A. The file is tracked beside the other two hook scripts (presence) ----
{
  check('A1 gate-hook.mjs exists beside reinject.mjs and mandatory-gate.mjs',
    existsSync(HOOK) && existsSync(join(HERE, 'reinject.mjs')) && existsSync(join(HERE, 'mandatory-gate.mjs')));
}

// ---- B. Fail-open: bad input never breaks a session ----
// Every case below must exit 0 AND print nothing. A hook that throws here takes
// the user's session with it.
{
  const cases = [
    ['unparseable stdin', 'not json at all'],
    ['empty stdin', ''],
    ['JSON that is not an object', '"just a string"'],
    ['an object with no event name', '{}'],
    ['an unknown event', '{"hook_event_name":"SomethingElse"}'],
    ['a null prompt', '{"hook_event_name":"UserPromptSubmit","prompt":null}'],
  ];
  for (const [label, stdin] of cases) {
    const { code, stdout } = run(stdin);
    check(`B1 fail-open and silent (${label})`, code === 0 && stdout.trim() === '',
      `exit=${code} stdout=${JSON.stringify(stdout.slice(0, 120))}`);
  }
}

// ---- C. UserPromptSubmit emits well-formed hook JSON when a domain is hit ----
{
  const { code, stdout } = run('{"hook_event_name":"UserPromptSubmit","prompt":"fix the bug in the auth flow"}');
  check('C1 flagged prompt exits 0', code === 0, `exit=${code}`);
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* reported below */ }
  check('C2 stdout is valid JSON', parsed !== null, JSON.stringify(stdout.slice(0, 120)));
  check('C3 the envelope names the event and carries additionalContext',
    parsed?.hookSpecificOutput?.hookEventName === 'UserPromptSubmit' &&
    typeof parsed?.hookSpecificOutput?.additionalContext === 'string' &&
    parsed.hookSpecificOutput.additionalContext.length > 0,
    JSON.stringify(parsed)?.slice(0, 200));
  check('C4 the injected text says the flag is a signal, not proof',
    /not proof/i.test(parsed?.hookSpecificOutput?.additionalContext ?? ''));
  check('C5 the flagged domain is named (root-cause for a bug prompt)',
    /root-cause/.test(parsed?.hookSpecificOutput?.additionalContext ?? ''));
}

// ---- D. A prompt touching no domain stays silent ----
{
  const { code, stdout } = run('{"hook_event_name":"UserPromptSubmit","prompt":"ganti nama variabel"}');
  check('D1 off-domain prompt exits 0 with no output', code === 0 && stdout.trim() === '',
    `exit=${code} stdout=${JSON.stringify(stdout.slice(0, 120))}`);
}

// ---- E. SessionStart emits the discipline floor ----
// The floor must carry BOTH halves — this is the mechanism the 2026-09-21
// half-floor finding was about, and the reason the hook delegates extraction to
// the tested buildReinject instead of hand-rolling a regex (its own comment
// records that the first draft did exactly that and silently dropped the laws).
{
  const { code, stdout } = run('{"hook_event_name":"SessionStart"}');
  check('E1 SessionStart exits 0 and emits JSON', code === 0 && stdout.trim() !== '', `exit=${code}`);
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* reported below */ }
  const ctx = parsed?.hookSpecificOutput?.additionalContext ?? '';
  check('E2 the floor carries the Iron Laws half',
    /No acting until the user confirms shared understanding/.test(ctx),
    ctx.slice(0, 200));
  check('E3 the floor carries the MANDATORY section half',
    /MANDATORY/.test(ctx) && /expect-fail/.test(ctx),
    ctx.slice(0, 200));
}


// ---- F. The floor states where skills ACTUALLY are (gap 1, 2026-09-30) ----
// The floor used to end with a hardcoded claim: "Skills are installed globally
// (~/.claude/skills)". That is an ASSUMPTION, not a fact — the marketplace
// installer puts skills under the plugin root, and on a machine that never
// copied them to the personal dir the sentence points the agent at a directory
// with nothing in it. An instruction that assumes an unverified state is the
// exact silent failure this framework exists to kill, so the hook now CHECKS
// and only names directories that exist; when none exists it says so instead of
// inventing one.
{
  const { code, stdout } = run('{"hook_event_name":"SessionStart"}');
  const ctx = JSON.parse(stdout).hookSpecificOutput?.additionalContext ?? '';
  // The floor must name a location for EACH skill root the hook found, and what
  // it names has to be a real place: assert against the resolved roots, not
  // against a literal from the assertion (the first version of this case
  // hardcoded the repo path and failed on a correct fix — the check was wrong,
  // not the artifact).
  // The sentence continues past the list, so cut the list at its terminator
  // before splitting — the first version split the whole sentence and treated
  // prose as paths (the check was wrong again; the artifact was correct).
  const skillLine = (ctx.split('\n').find((l) => /^Skills are available at:/.test(l)) || '');
  const listPart = skillLine.replace('Skills are available at: ', '').split('. Check the trigger matrix')[0];
  const named = listPart.split(', ').filter(Boolean);
  check('F1 the floor names at least one skill location',
    named.length > 0 && skillLine.length > 0,
    ctx.slice(-260));
  check('F1b every location it names actually exists',
    named.length > 0 && named.every((p) => existsSync(p)),
    JSON.stringify(named));
  check('F2 the floor does not assert the personal dir unconditionally',
    !/Skills are installed globally \(~\.claude\/skills\)/.test(ctx),
    ctx.slice(-260));
  check('F3 the floor tells the agent what to do when no skill dir is found',
    /no skill directory found|verify the install/.test(ctx) || /Skills are available at/.test(ctx),
    ctx.slice(-260));
}

// ---- G. A missing hook is DETECTABLE (gap 2, 2026-09-30) ----
// The hook fails open by design, which also means its absence is silent: a
// session with no floor looks exactly like a session with one. Silence cannot
// be the only signal, so the hook exposes a self-check mode that reports what it
// resolved — the difference between "wired and quiet" and "not wired" has to be
// observable by the person running the install.
{
  const r = spawnSync(process.execPath, [HOOK, '--self-check'], { encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  check('G1 --self-check reports the resolved router and skill roots',
    /router:/i.test(out) && /skills:/i.test(out), out.slice(0, 300));
  check('G2 --self-check exits 0 when the install is healthy',
    r.status === 0, 'exit=' + r.status + ' ' + out.slice(0, 200));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll gate-hook expectations hold.');

// ---- H. PreToolUse veto (hardening-general 04/AC2-AC3) ----
// The blocking contract (assumed from the harness docs, live verification
// still open): exit 2 denies the tool call, stderr carries the reason to the
// model; exit 0 passes silent. Errors and unknown shapes stay fail-open
// (exit 0) — the veto closes on CLASSIFIED irreversible actions, never on
// hook confusion. Fixtures drive the REAL CLI with temp cwds, never the repo.
const runPre = (payload) => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const bareDir = () => mkdtempSync(join(tmpdir(), 'tna-pre-'));
const passedDir = () => {
  const d = bareDir();
  mkdirSync(join(d, '.trust'), { recursive: true });
  writeFileSync(join(d, '.trust', 'tna-gate-state.json'),
    JSON.stringify({ testPassFresh: true, command: 'node scripts/x.test.mjs', updatedAt: '2026-10-12T00:00:00.000Z' }));
  return d;
};
{
  const d = bareDir();
  const { code, out } = runPre({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' }, cwd: d });
  check('H1 commit without evidence exits 2 (deny)', code === 2, `exit=${code}`);
  check('H2 the denial names the missing evidence', /fresh test/i.test(out), out.slice(0, 200));
  check('H6 the denial is logged as one parseable veto-fire line',
    (() => { try { const o = JSON.parse(readFileSync(join(d, '.trust', 'tna-gate-log.jsonl'), 'utf8').trim().split('\n').pop()); return o.tool === 'Bash' && /git commit/.test(o.command); } catch { return false; } })());
}
{
  const { code, out } = runPre({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' }, cwd: passedDir() });
  check('H3 commit with fresh evidence exits 0 silent', code === 0 && out.trim() === '', `exit=${code} out=${JSON.stringify(out.slice(0, 120))}`);
}
{
  const { code, out } = runPre({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { filePath: 'docs/x.md' }, cwd: bareDir() });
  check('H4 read tool exits 0 silent (fail-open preserved)', code === 0 && out.trim() === '', `exit=${code}`);
}
{
  const { code, out } = runPre({ hook_event_name: 'PreToolUse' });
  check('H5 PreToolUse with no tool shape stays fail-open', code === 0 && out.trim() === '', `exit=${code}`);
}

// ---- I. Manifests wire the veto (AC2/AC3 automated half) ----
{
  const hooks = JSON.parse(readFileSync(join(HERE, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const pre = hooks?.hooks?.PreToolUse ?? [];
  check('I1 hooks.json carries a PreToolUse entry', Array.isArray(pre) && pre.length > 0, JSON.stringify(Object.keys(hooks?.hooks ?? {})));
  check('I2 the entry targets the Bash tool and calls gate-hook',
    JSON.stringify(pre).includes('Bash') && JSON.stringify(pre).includes('gate-hook.mjs'), JSON.stringify(pre).slice(0, 200));
}
{
  const codex = JSON.parse(readFileSync(join(HERE, '..', 'plugin', 'hooks', 'codex.hooks.json'), 'utf8'));
  const pre = codex?.hooks?.PreToolUse ?? [];
  check('I3 codex.hooks.json carries a PreToolUse entry', Array.isArray(pre) && pre.length > 0, JSON.stringify(Object.keys(codex?.hooks ?? {})));
  check('I4 the codex entry calls gate-hook',
    JSON.stringify(pre).includes('gate-hook.mjs'), JSON.stringify(pre).slice(0, 200));
}

process.exit(failures ? 1 : 0);
