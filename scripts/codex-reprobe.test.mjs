#!/usr/bin/env node
/**
 * Fail-first test for scripts/codex-reprobe.mjs — the mechanical Codex
 * PostToolUse re-probe.
 *
 * Why a test at all: the script's whole value is that its VERDICT cannot be
 * faked. A prober that reports "works" without credentials, or that folds a
 * delivery failure into "recorder broken", converts an open verdict into a
 * wrong one — the exact fake-compliance the gate exists to catch. So the
 * assertions below are about the VERDICT MAPPING, driven through the real
 * subprocess (the exit code and the --json payload are the public seam).
 *
 * What is NOT tested here: whether Codex actually spawns PostToolUse. That
 * needs a logged-in CLI and is the one thing this file cannot fake — the
 * script's exit 3 case is precisely its honest report of that gap.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(HERE, 'codex-reprobe.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Presence and shape ----
check('A1 scripts/codex-reprobe.mjs exists', existsSync(SCRIPT));

const src = existsSync(SCRIPT) ? readFileSync(SCRIPT, 'utf8') : '';
check('A2 declares all five verdict exit codes in its own header',
  [0, 1, 2, 3, 4].every((c) => new RegExp(`^\\s*(\\*|//)?\\s*${c}\\s+\\S`, 'm').test(src)),
  'header must stay the contract a reader trusts');
check('A3 isolates CODEX_HOME (a probe must not touch the real trust store)',
  /CODEX_HOME/.test(src) && /mkdtempSync/.test(src));
check('A4 uses forward slashes for the hook path inside JSON',
  /replace\(\/\\\\\/g, '\/'\)/.test(src),
  'a backslashed path inside JSON is eaten by the parser — measured 2026-11-03');
check('A5 the hook writes its marker BEFORE answering (proof by side effect)',
  src.indexOf('appendFileSync') !== -1 && src.indexOf('appendFileSync') < src.indexOf("process.stdout.write('{}"),
  'marker must precede output, or a crashed hook looks like a silent one');

// ---- B. Verdict mapping, driven live ----
// This machine's Codex state decides which branch runs, so the test asserts the
// INVARIANT that holds in every state: the exit code agrees with the verdict.
// A hardcoded "not logged in" assertion would rot the day the operator logs in.
{
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8', timeout: 300000 });
  const code = r.status;
  let payload = null;
  try { payload = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch { /* asserted below */ }

  check('B1 --json emits exactly one parseable JSON line', payload !== null, String(r.stdout || r.stderr).slice(0, 200));
  check('B2 the exit code is one of the five documented verdicts', [0, 1, 2, 3, 4].includes(code), `code=${code}`);
  check('B3 the verdict text and the exit code cannot disagree',
    payload !== null && (
      (code === 0 && /RECORDER WORKS/.test(payload.verdict))
      || (code === 1 && /RECORDER STILL BROKEN/.test(payload.verdict))
      || (code === 2 && /UNPROVEN/.test(payload.verdict))
      || (code === 3 && /UNPROVEN/.test(payload.verdict))
      || (code === 4 && /HARNESS BUILD FAILED/.test(payload.verdict))
    ),
    `code=${code} verdict=${payload && payload.verdict}`);
  // The credential state is an ENVIRONMENT fact, not a recorder fact. If this
  // branch runs, the report must say so explicitly — never "recorder broken".
  if (code === 3) {
    check('B4 an unauthenticated run is reported as UNPROVEN, never as a recorder result',
      /NOT a recorder verdict|credentials/.test(payload.detail),
      payload.detail.slice(0, 200));
  } else {
    console.log('ok - B4 skipped: this machine has credentials, so the exit-3 branch is not exercised here');
  }
  check('B5 the payload names the codex version it measured',
    payload !== null && typeof payload.version === 'string' && payload.version.length > 0,
    JSON.stringify(payload && payload.version));
}

console.log(failures === 0 ? '\nAll codex-reprobe expectations hold.' : `\n${failures} failing expectation(s)`);
process.exit(failures === 0 ? 0 : 1);
