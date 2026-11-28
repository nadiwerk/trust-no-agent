#!/usr/bin/env node
/**
 * would-deny.mjs — gate transparency surface (process pack item 5).
 *
 * Ask BEFORE running: "would this command be denied, and why?" — evaluated
 * against the same boundary the real veto uses (action-gate.classifyAction)
 * plus the current evidence state (.trust/tna-gate-state.json). A gate you
 * cannot interrogate is a gate you cannot trust; a dry-run changes nothing.
 *
 * CLI: node scripts/would-deny.mjs "<command>"  — exit 0 ALLOWED, 1 DENIED.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAction } from './action-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.trust', 'tna-gate-state.json');

export function wouldDeny(command, { evidence } = {}) {
  const ev = evidence ?? { testPassFresh: false };
  const r = classifyAction({ tool: 'exec', args: { command }, evidence: ev });
  const denied = r.gated === true && r.denied !== false;
  return {
    denied,
    reason: r.reason ?? '(no reason reported)',
    opens: denied ? 'a fresh test pass recorded via node scripts/record-test-evidence.mjs' : null,
  };
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv.slice(2).join(' ').trim();
  if (!command) {
    console.error('usage: node scripts/would-deny.mjs "<command>"');
    process.exit(2);
  }
  let evidence = { testPassFresh: false };
  try { evidence = JSON.parse(readFileSync(STATE, 'utf8')); } catch { /* absent state = no evidence */ }
  const { denied, reason, opens } = wouldDeny(command, { evidence });
  if (denied) {
    console.log(`DENIED  "${command}"`);
    console.log(`  why:   ${reason}`);
    console.log(`  opens: ${opens}`);
    process.exit(1);
  }
  console.log(`ALLOWED "${command}"`);
  console.log(`  why:   ${reason}`);
}
