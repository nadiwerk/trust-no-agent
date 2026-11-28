#!/usr/bin/env node
/**
 * Fail-first test for scripts/would-deny.mjs — the gate transparency surface.
 * Zero dependencies. Run: node scripts/would-deny.test.mjs
 *
 * Seam: wouldDeny(command, { evidence }) — answers ALLOWED or DENIED with the
 * same boundary the real veto uses (action-gate classifyAction), plus what
 * would open the gate. A dry-run changes nothing: the point is that a gate
 * you cannot interrogate is a gate you cannot trust.
 */
import { wouldDeny } from './would-deny.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Irreversible command without evidence is denied, with a reason ----
{
  const r = wouldDeny('git push origin master', { evidence: { testPassFresh: false } });
  check('A1 push without evidence is DENIED', r.denied === true, JSON.stringify(r));
  check('A2 denial carries a reason string', typeof r.reason === 'string' && r.reason.length > 10, r.reason);
  check('A3 denial names what opens the gate', /test/i.test(r.opens ?? ''), r.opens);
}

// ---- B. The same command with fresh evidence is allowed ----
{
  const r = wouldDeny('git push origin master', { evidence: { testPassFresh: true } });
  check('B push with fresh evidence is ALLOWED', r.denied === false, JSON.stringify(r));
}

// ---- C. Benign commands are never gated ----
{
  for (const cmd of ['ls', 'git status', 'node scripts/validate.mjs', 'cat README.md']) {
    const r = wouldDeny(cmd, { evidence: { testPassFresh: false } });
    check(`C "${cmd}" not gated`, r.denied === false, JSON.stringify(r));
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
