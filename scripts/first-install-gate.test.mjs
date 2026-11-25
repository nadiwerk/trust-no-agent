#!/usr/bin/env node
/**
 * Integrated first-install trust-layer regression gate (spec AC1-AC11).
 *
 * This suite is deliberately a runner, not a duplicate oracle: the AC1-AC10
 * behavior stays pinned by the maintained seam suites, while this gate proves
 * they are executed together against the integrated artifact. The published
 * plugin mirror is exercised directly through plugin/scripts/gate-hook.mjs
 * --self-check and a two-sided deny/allow probe; byte/mirror correctness stays
 * pinned by plugin.test.mjs and payload-sync.test.mjs.
 *
 * Run: node scripts/first-install-gate.test.mjs
 * Exit 0 = every maintained regression and the published-payload probe pass.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const run = (label, script, extra = []) => {
  const r = spawnSync(process.execPath, [join(ROOT, ...script.split('/')), ...extra], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000,
  });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  const failLines = (out.match(/^FAIL - /gm) || []).length;
  check(`${label} exits zero`, r.status === 0, `exit=${r.status} failLines=${failLines} tail=${out.slice(-500).replace(/\n/g, ' | ')}`);
  return r.status === 0;
};

// AC1-AC10 maintained behavior coverage: entry-point parity, payload install,
// scanner/registration detection, preflight/rollback, foreign-entry lifecycle,
// shared ownership, floor extraction, ledger routing, and preservation.
run('AC1-AC10 onboarding CLI/payload/lifecycle regressions', 'scripts/onboarding.test.mjs');
run('AC1-AC5 install-layer regressions', 'scripts/onboarding-layers.test.mjs');
run('AC10 refresh/preservation regressions', 'scripts/onboarding-refresh.test.mjs');
run('AC3-AC11 doctor/readiness regressions', 'scripts/doctor.test.mjs');

// Published artifact coverage. plugin.test and payload-sync.test pin the mirror
// contract; the self-check below executes the plugin copy rather than trusting
// byte identity alone.
run('published plugin mirror regressions', 'scripts/plugin.test.mjs');
run('setup-tna payload synchronization regressions', 'scripts/payload-sync.test.mjs');
run('payload zero-drift check', 'scripts/sync-payloads.mjs');

{
  const r = spawnSync(process.execPath, [join(ROOT, 'plugin', 'scripts', 'gate-hook.mjs'), '--self-check'], {
    cwd: join(ROOT, 'plugin'), encoding: 'utf8', timeout: 60000,
  });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  check('published plugin gate-hook copy executes its self-check',
    r.status === 0 && /router: FOUND/.test(out) && /classifier: FOUND/.test(out),
    `exit=${r.status} out=${out.slice(0, 300).replace(/\n/g, ' | ')}`);
}

// Execute the published plugin copy at its real hook seam, not the scripts/
// source: a commit is denied without fresh evidence, evidence is recorded, and
// the same commit is then allowed. Denial alone cannot distinguish a working
// gate from a permanent block.
{
  const fixture = mkdtempSync(join(tmpdir(), 'first-install-plugin-proof-'));
  const hook = join(ROOT, 'plugin', 'scripts', 'gate-hook.mjs');
  const runHook = (payload) => spawnSync(process.execPath, [hook], {
    cwd: fixture,
    env: { ...process.env, DEVIN_PROJECT_DIR: fixture },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 60000,
  });
  const commitPayload = { hook_event_name: 'PreToolUse', tool_name: 'bash', tool_input: { command: 'git commit -m x' }, cwd: fixture };
  const deny = runHook(commitPayload);
  const denied = /"permissionDecision"\s*:\s*"deny"/.test(String(deny.stdout ?? ''));
  runHook({ hook_event_name: 'PostToolUse', tool_name: 'bash', tool_input: { command: 'npm test' }, tool_response: { exitCode: 0, output: '3 passed' }, cwd: fixture });
  const allow = runHook(commitPayload);
  // Positive allow evidence (roast r1 F6): silent exit-0 cannot tell an
  // evaluated allow from a crashed fail-open — the gate must say it evaluated.
  const allowed = allow.status === 0
    && !/"permissionDecision"\s*:\s*"deny"/.test(String(allow.stdout ?? ''))
    && /evaluated:\s*allow/.test(String(allow.stderr ?? ''));
  check('published plugin gate-hook copy proves deny-then-allow at the hook seam',
    denied && allowed,
    `denyExit=${deny.status} deny=${String(deny.stdout ?? '').slice(0, 180)} allowExit=${allow.status} allow=${String(allow.stdout ?? '').slice(0, 180)} allowErr=${String(allow.stderr ?? '').slice(0, 180)}`);
  rmSync(fixture, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nOK: integrated first-install gate passes (AC1-AC11).' : `\nFAIL: ${failures} integrated gate expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
