#!/usr/bin/env node
/**
 * agents-size — reusable SIZE GUARD for any AGENTS.md (2026-11-17).
 *
 * The ads-tracker router was 40.970 chars (~10.2k tokens at chars/4); trimming
 * it to 13.436 saved ~27.5k chars/request. Other projects on this machine are
 * also 28–42k chars, so the fix must be REUSABLE, not a one-off edit. This
 * module is the pure seam; the CLI prints a verdict for a named path and the
 * OpenCode plugin logs the same verdict at session start (opencode-v2-agentsize).
 *
 * No tokenizer dependency: token counts are chars/4 estimates, labelled as such.
 */
import { readFileSync } from 'node:fs';

export const DEFAULT_LIMIT = 20000;

/** @returns {{ok:boolean, chars:number, estTokens:number, limit:number}} */
export function sizeVerdict(text, limit = DEFAULT_LIMIT) {
  const chars = typeof text === 'string' ? text.length : 0;
  return { ok: chars <= limit, chars, estTokens: Math.round(chars / 4), limit };
}

if (process.argv[1] && process.argv[1].endsWith('agents-size.mjs')) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/agents-size.mjs <path-to-AGENTS.md> [limit]');
    process.exit(2);
  }
  let text = '';
  try { text = readFileSyncLocal(path); } catch (e) { console.error(String(e)); process.exit(2); }
  const limit = Number(process.argv[3]) || DEFAULT_LIMIT;
  const v = sizeVerdict(text, limit);
  console.log(`${v.ok ? 'OK' : 'OVER'} ${v.chars} chars (~${v.estTokens} tokens at chars/4, limit ${v.limit}) :: ${path}`);
  process.exit(v.ok ? 0 : 1);
}

function readFileSyncLocal(path) {
  return readFileSync(path, 'utf8');
}
