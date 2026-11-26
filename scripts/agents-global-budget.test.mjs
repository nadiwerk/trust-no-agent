#!/usr/bin/env node
/** Fail-first guard for the global OpenCode AGENTS.md budget (2026-11-17). */
import { existsSync, readFileSync } from 'node:fs';

const p = process.env.OPENCODE_GLOBAL_AGENTS ?? 'C:/Users/Lenovo/.config/opencode/AGENTS.md';
const floorPath = 'C:/Users/Lenovo/.config/opencode/rules/tna-floor.md';
// This guard reads the MACHINE's global OpenCode config, not repo content —
// on any host without it (CI runners, other machines) there is no subject to
// grade, so the honest verdict is SKIP, never a crash or a fake red.
if (!existsSync(p) && !existsSync(floorPath)) {
  console.log('SKIP - machine-local OpenCode global config absent on this host (CI); nothing to guard');
  process.exit(0);
}
let s = '';
try { s = readFileSync(p, 'utf8'); } catch { /* absent -> fail below */ }
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};
check('G1 global AGENTS.md under 12k chars (ladder added 2026-11-17)', s.length < 12000, `${s.length} chars`);
check('G2 long working-style text is a pointer, not inline', /\.claude[\\/]AGENTS\.md/.test(s) && !/### Karpathy principles \(working style for code\)/.test(s));
check('G3 Trust No Agent floor pointer survives', /tna-floor\.md/.test(s));
check('G5 decision-order ladder is present in every OpenCode project', /The ladder/.test(s) && /shortcut:/.test(s));
check('G4 model map survives (machine-specific, still needed)', /deepseek-v4\.1-flash/.test(s) && /semutcode/.test(s));
let floor = '';
try { floor = readFileSync(floorPath, 'utf8'); } catch { /* absent -> G6 fails below */ }
const LAWS = ['shared understanding', 'failing test', 'verifikasi fresh', 'sign-off'];
check('G6 all four Iron Laws are explicit in the always-on floor', LAWS.every((k) => floor.toLowerCase().includes(k)), `${LAWS.filter((k) => !floor.toLowerCase().includes(k))}`);
console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
