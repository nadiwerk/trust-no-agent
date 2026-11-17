#!/usr/bin/env node
/** Fail-first guard for the global OpenCode AGENTS.md budget (2026-11-17). */
import { readFileSync } from 'node:fs';

const p = process.env.OPENCODE_GLOBAL_AGENTS ?? 'C:/Users/Lenovo/.config/opencode/AGENTS.md';
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
check('G5 Ponytail ladder is present in every OpenCode project', /The ladder/.test(s) && /shortcut:/.test(s));
check('G4 model map survives (machine-specific, still needed)', /deepseek-v4\.1-flash/.test(s) && /semutcode/.test(s));
console.log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`);
