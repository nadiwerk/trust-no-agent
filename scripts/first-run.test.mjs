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
  // Live derivation (K7 precedent): the real CLI against this checkout.
  let out = '';
  let code = -1;
  try {
    out = execFileSync(process.execPath, [join(HERE, 'first-run.mjs')], { encoding: 'utf8' });
    code = 0;
  } catch (e) { out = String(e?.stdout ?? e?.message ?? e); code = e?.status ?? 1; }
  check('W6 live CLI exits 0 with PASS in this checkout', code === 0 && /PASS/.test(out), `exit=${code} out=${out.slice(0, 160)}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
