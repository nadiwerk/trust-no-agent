#!/usr/bin/env node
/**
 * Fail-first test for scripts/receipt-draft.mjs — the 4-block receipt autofill.
 * Zero dependencies. Run: node scripts/receipt-draft.test.mjs
 *
 * Seam: draftReceipt({ sha, commands }) -> text that already satisfies
 * validateReceipt's shape — every boolean line present, cited commands in
 * the allowlist. The draft is a floor the human fills in (Verdict/Open/Next),
 * never a finished receipt.
 */
import { draftReceipt } from './receipt-draft.mjs';
import { validateReceipt } from './receipt-enforcement.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. The draft carries the four blocks and five booleans ----
{
  const draft = draftReceipt({ sha: 'abc1234', commands: ['node scripts/validate.mjs'] });
  for (const b of ['**Verdict**', '**Evidence**', '**Open**', '**Next**'])
    check(`A block ${b} present`, draft.includes(b));
  for (const name of ['constraints satisfied', 'evidence fresh', 'scope held', 'subject verified', 'fail-first proven'])
    check(`A boolean "${name}" present`, draft.includes(name));
}

// ---- B. The draft is INVALID until a human fills it (the loophole guard) ----
// A draft that passes validateReceipt unedited is a hollow-receipt machine:
// placeholder evidence lines would satisfy the gate while claiming nothing.
// Booleans ship without evidence tails; the human appends the claim.
{
  const draft = draftReceipt({ sha: 'abc1234', commands: ['node scripts/validate.mjs', 'node scripts/coverage.mjs'] });
  const { errors } = validateReceipt(draft, { root: process.cwd() });
  check('B1 unfilled draft is rejected by the validator',
    errors.length >= 5 && errors.every((e) => e.includes('no evidence line')), JSON.stringify(errors));
  // Fill path: the ':' placeholder is replaced by ' — <claim>' -> validates.
  const filled = draft.split('\n').map((l) =>
    /^- (constraints satisfied|evidence fresh|scope held|subject verified|fail-first proven):$/.test(l.trim())
      ? `${l.slice(0, -1)} — verified against the real artifact` : l).join('\n');
  const { errors: fillErrors } = validateReceipt(filled, { root: process.cwd() });
  check('B2 filled draft satisfies the validator', fillErrors.length === 0, JSON.stringify(fillErrors));
}

// ---- C. The cited commands actually appear in the Evidence block ----
{
  const draft = draftReceipt({ sha: 'abc1234', commands: ['node scripts/validate.mjs'] });
  const ev = draft.slice(draft.indexOf('**Evidence**'), draft.indexOf('**Open**'));
  check('C evidence cites the recorded command', ev.includes('node scripts/validate.mjs'));
  check('C sha cited in evidence', ev.includes('abc1234'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
