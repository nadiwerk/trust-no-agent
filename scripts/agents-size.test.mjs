#!/usr/bin/env node
/** Fail-first test for the reusable AGENTS.md size guard. */
import { existsSync, readFileSync } from 'node:fs';
import { sizeVerdict, DEFAULT_LIMIT } from './agents-size.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};
check('S1 default limit is 20k chars', DEFAULT_LIMIT === 20000, String(DEFAULT_LIMIT));
check('S2 trimmed router passes', sizeVerdict('x'.repeat(13436)).ok === true);
const over = sizeVerdict('x'.repeat(42000));
check('S3 old-size router fails', over.ok === false && over.estTokens === 10500, JSON.stringify(over));
check('S4 boundary is inclusive', sizeVerdict('x'.repeat(DEFAULT_LIMIT)).ok === true);
check('S5 estimate is labelled chars/4', sizeVerdict('abcd').estTokens === 1);
const ADS_ROUTER = 'C:/Users/Lenovo/projects/ads-tracker/AGENTS.md';
if (existsSync(ADS_ROUTER)) {
  const ads = sizeVerdict(readFileSync(ADS_ROUTER, 'utf8'));
  check('S6 real ads-tracker router is under the limit', ads.ok === true, JSON.stringify(ads));
} else {
  console.log('ok - S6 skipped: ads-tracker router not present on this machine');
}
console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
