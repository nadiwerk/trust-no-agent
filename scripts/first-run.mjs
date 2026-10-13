#!/usr/bin/env node
/**
 * first-run — the newcomer first-run gate (newcomer-escalation ticket 02,
 * AC2/AC6). One verdict from two sides: mechanical wiring (doctor green) AND
 * recitable router (full Iron-Laws + MANDATORY floor emitted). Either side
 * missing fails closed — a wiring-only install passes routines it cannot
 * recite, a prose-only install recites gates it never wired; both are the
 * newcomer "defiance" report waiting to happen.
 *
 * Zero dependencies (node builtins only). Run: node scripts/first-run.mjs
 * Exit 0 = both sides hold. Exit 1 = at least one side down, named.
 * Tested fail-first by first-run.test.mjs.
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Pure verdict composition — the seam the test pins.
 * Missing inputs fail closed, never default-pass.
 */
export function firstRunVerdict({ doctorOk = false, floorOk = false } = {}) {
  const pass = doctorOk === true && floorOk === true;
  const message = pass
    ? 'first-run gate: PASS — doctor green (wiring) + full floor emitted (recitable router)'
    : `first-run gate: FAIL — doctor ${doctorOk ? 'green' : 'NOT green'}; floor ${floorOk ? 'complete' : 'INCOMPLETE'} (both sides required, neither alone passes)`;
  return { pass, message };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

/**
 * Wiring composition — the seam that proves main() actually consults both
 * sides. `run` throws on failure (execFileSync semantics); each side is
 * attempted independently so one side's failure never masks the other's.
 * Tested with stub runners; main() passes the real subprocess runner.
 */
export function runGate(run) {
  let doctorOk = false;
  let floorOk = false;
  try { run('doctor'); doctorOk = true; } catch { /* exit code is the verdict — detail lives in doctor's own output */ }
  try { run('floor'); floorOk = true; } catch { /* same — reinject names its own missing half */ }
  return firstRunVerdict({ doctorOk, floorOk });
}

if (isMain) {
  const v = runGate((name) => execFileSync(
    process.execPath,
    [join(HERE, name === 'doctor' ? 'doctor.mjs' : 'reinject.mjs')],
    { stdio: 'pipe' },
  ));
  console.log((v.pass ? 'PASS  ' : 'FAIL  ') + v.message);
  process.exit(v.pass ? 0 : 1);
}
