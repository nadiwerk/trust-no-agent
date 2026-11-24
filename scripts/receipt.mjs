#!/usr/bin/env node
/**
 * Receipt skeleton generator + pre-append checker.
 *
 * The enforced receipt shape (docs/chat-receipt.md + the receipts skill's
 * enforced ledger shape) is heavy to write by hand — and a wrong shape is
 * discovered at the veto, after the work. This tool closes both ends:
 *
 *   node scripts/receipt.mjs            emit the full enforced skeleton
 *   node scripts/receipt.mjs --fast     emit the one-line fast shape
 *   node scripts/receipt.mjs --check <file>   grade a draft BEFORE append
 *   node scripts/receipt.mjs --check    grade the newest ledger entry
 *
 * --check runs receipt-enforcement.mjs's own validateReceipt — the same code
 * the veto uses — so a receipt the tool accepts is a receipt the gate
 * accepts. There is no separate, driftable acceptance rule here.
 *
 * Exit 0 = emit done / receipt valid. Exit 1 = validation errors (named).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReceipt, newestEntry } from './receipt-enforcement.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);

const FULL = `## ${today} - <unit title>

Loaded: <skill(s) driving the unit>

**Verdict** — <one-line summary>
constraints satisfied — <the constraint list / acceptance criteria checked>
evidence fresh — <literal repo-gate command + result, e.g. node scripts/eval.mjs -> OK, this turn>
scope held — <files in / out of scope>
subject verified — <the artifact checked, not a proxy>
fail-first proven — <RED evidence cited, or n/a with the reason>
**Evidence** — <the outputs cited above>
**Open** — <what remains unproven, or "none">
**Next** — <one concrete forward arrow>
`;

const FAST = `fast: <claim> — <allowlisted repo-gate command> — <result>`;

function grade(text, label) {
  const { errors, shape, commands } = validateReceipt(text, { root: ROOT });
  if (errors.length) {
    for (const e of errors) console.log(`FAIL - ${e}`);
    console.log(`\n${errors.length} problem(s) in ${label} — the veto would deny this receipt.`);
    return 1;
  }
  const cited = commands.length ? ` — cited: ${commands.join(', ')}` : '';
  console.log(`OK - ${label} is a valid ${shape} receipt${cited}`);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    if (args[1]) return grade(readFileSync(args[1], 'utf8'), args[1]);
    const ledgerPath = join(ROOT, '.trust', 'progress.txt');
    let text = '';
    try { text = readFileSync(ledgerPath, 'utf8'); } catch { /* empty */ }
    const newest = newestEntry(text);
    if (!newest) { console.log('FAIL - no ledger entries found in .trust/progress.txt'); return 1; }
    return grade(newest.text, `newest ledger entry (${newest.date})`);
  }
  process.stdout.write(args[0] === '--fast' ? FAST + '\n' : FULL);
  return 0;
}

process.exit(main());
