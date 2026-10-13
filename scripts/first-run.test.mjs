#!/usr/bin/env node
/**
 * Fail-first test for scripts/first-run.mjs — the newcomer first-run gate
 * (newcomer-escalation ticket 02, AC2/AC6).
 *
 * Zero dependencies. Run: node scripts/first-run.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = gate drift.
 *
 * Seam: firstRunVerdict({ doctorOk, floorOk }) — pure verdict composition.
 * The gate passes ONLY when both sides hold: mechanical wiring (doctor green)
 * AND recitable router (full floor emitted). One side removed must fail —
 * that is AC6, and a test missing it would certify a half-gate.
 * Expected verdicts are hand-written literals from the ticket intent.
 */
import { firstRunVerdict, runGate } from './first-run.mjs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

{
  const v = firstRunVerdict({ doctorOk: true, floorOk: true });
  check('A1 both sides green passes', v.pass === true, JSON.stringify(v));
  check('A2 verdict names both sides', /doctor/i.test(v.message) && /floor|recit/i.test(v.message), v.message);
}
{
  const v = firstRunVerdict({ doctorOk: false, floorOk: true });
  check('A3 wiring removed fails (no prose-only pass)', v.pass === false, JSON.stringify(v));
}
{
  const v = firstRunVerdict({ doctorOk: true, floorOk: false });
  check('A4 floor removed fails (no wiring-only pass)', v.pass === false, JSON.stringify(v));
}
{
  const v = firstRunVerdict({ doctorOk: false, floorOk: false });
  check('A5 both removed fails', v.pass === false, JSON.stringify(v));
}
{
  const v = firstRunVerdict({});
  check('A6 missing inputs fail closed, never default-pass', v.pass === false, JSON.stringify(v));
}

// ---- W. Wiring composition — runGate consults both sides through the runner ----
// This is the anti-theater seam: stub runners prove main()'s composition
// fails when either side is removed, and the live CLI run below proves the
// real wiring is intact today. A suite pinning only firstRunVerdict would
// stay green with the execFileSync calls deleted.
{
  const ok = () => {};
  const bad = () => { throw new Error('runner failed'); };
  check('W1 both sides run → pass',
    runGate(ok).pass === true, JSON.stringify(runGate(ok)));
  check('W2 doctor removed → fail (no prose-only pass)',
    runGate((n) => { if (n === 'doctor') throw new Error('x'); }).pass === false);
  check('W3 floor removed → fail (no wiring-only pass)',
    runGate((n) => { if (n === 'floor') throw new Error('x'); }).pass === false);
  check('W4 both removed → fail',
    runGate(bad).pass === false);
  check('W5 each side attempted independently (one failure never masks the other)',
    (() => { const seen = []; try { runGate((n) => { seen.push(n); throw new Error('x'); }); } catch {} return seen.join(',') === 'doctor,floor'; })());
}
{
  // Live derivation (K7 precedent): the real CLI. Its outcome depends on ONE
  // environment fact the repo cannot ship — `core.hooksPath` is LOCAL git
  // config, never cloned, so a fresh checkout (CI runner, new adopter) has
  // enforcement inactive and the doctor correctly fails on it. The old W6
  // asserted "this checkout is green" — a maintainer-machine assumption that
  // went red the first time CI ran it (2026-10-13, run 38360759027). The
  // test now derives BOTH directions through git's config env override: no
  // ambient state, no repo mutation, both verdicts proven live.
  const live = (hooksPath) => {
    try {
      const out = execFileSync(process.execPath, [join(HERE, 'first-run.mjs')], {
        encoding: 'utf8',
        timeout: 300000,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'core.hooksPath',
          GIT_CONFIG_VALUE_0: hooksPath,
        },
      });
      return { code: 0, out };
    } catch (e) {
      return { code: e?.status ?? 1, out: String(e?.stdout ?? e?.message ?? e) };
    }
  };
  // Enforcement wired — the state an installed machine has: PASS.
  const wired = live('scripts/hooks');
  check('W6 live CLI exits 0 with PASS when enforcement is wired (env-derived, machine-independent)',
    wired.code === 0 && /PASS/.test(wired.out), `exit=${wired.code} out=${wired.out.slice(0, 160)}`);
  // Enforcement inactive — the fresh-checkout condition that broke CI: the
  // live wiring must still SEE it. Without this direction, a doctor that
  // stops checking hooksPath would sail through W6's siblings.
  const unwired = live('scripts/does-not-exist');
  check('W7 live CLI exits 1 naming doctor NOT green when enforcement is inactive (fresh-checkout condition)',
    unwired.code === 1 && /NOT green/.test(unwired.out), `exit=${unwired.code} out=${unwired.out.slice(0, 160)}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
