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
import { existsSync } from 'node:fs';
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

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll gate-hook expectations hold.');
process.exit(failures ? 1 : 0);
