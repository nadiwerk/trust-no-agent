#!/usr/bin/env node
/**
 * Fail-first spec-scrub check (decision-composition ticket 06; spec AC19,
 * Constraint 12). Zero dependencies. Run: node scripts/spec-scrub.test.mjs
 * Exit 0 = the spec names no external product. Exit 1 = a product name found.
 *
 * The discipline — the decision-composition spec names no external products;
 * external patterns are inspiration only — is enforced by THIS TEST instead of
 * by memory. The names below are the ones the check hunts; they live HERE (the
 * enforcer), never in the spec itself. RED evidence (ticket 06): an external
 * name inserted into the spec turned the check red; restoring turned it green.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, '..', 'docs', 'specs', 'decision-composition.md');
// The external product names discussed with the owner during breakpoint. Kept
// as data so the list can grow without touching the assertion logic.
const EXTERNAL_NAMES = ['typesafe', 'jev'];

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const text = readFileSync(SPEC, 'utf8').toLowerCase();
for (const name of EXTERNAL_NAMES)
  check(`S1 the spec contains no "${name}" mention (case-insensitive)`, !text.includes(name),
    `found at char ${text.indexOf(name)}`);

console.log(failures === 0 ? '\nSpec is clean of external product names.' : `\nFAIL: ${failures} name(s) found in the spec.`);
process.exit(failures === 0 ? 0 : 1);
