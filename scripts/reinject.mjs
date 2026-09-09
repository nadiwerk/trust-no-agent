#!/usr/bin/env node
/**
 * Router re-injection — the block a harness re-prints after compaction, resume,
 * or a fresh session. Pure Node, zero dependencies.
 *
 * Run directly:  node scripts/reinject.mjs            (prints the block)
 * As a module:   import { buildReinject } from './reinject.mjs'
 *
 * Why it exists (ledger 2026-09-10): AGENTS.md re-injection after compaction
 * is harness-dependent — a harness that drops it leaves the Iron Laws and the
 * MANDATORY skill contract out of context, and the ledger compensation relies
 * on the agent's initiative to re-read (evals: initiative-based components
 * fail silently). This module derives the block from the router text itself,
 * so the injected block cannot drift from the rules it re-injects. Harnesses
 * with a session-start/resume/compact hook can wire this script's stdout as
 * the injected context; harnesses without one re-print the block by hand
 * (see docs/compatibility.md §Porting checklist).
 *
 * Design: everything outside the Iron Laws fence and the MANDATORY section is
 * deliberately excluded — context is a budget (AGENTS.md §8), and the block's
 * only job is the discipline floor, not the whole router.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = 'RE-INJECTED ROUTER CORE (compaction/resume guard — restate of the live AGENTS.md):';

/**
 * Extract the re-injection block from router text.
 * Returns '' when the router carries neither the Iron Laws fence nor the
 * MANDATORY section — the caller then skips the injection (graceful
 * degradation, AGENTS.md §8: references degrade, never hard-fail).
 */
export function buildReinject(routerText) {
  if (!routerText) return '';

  const parts = [];

  // Iron Laws: the fenced block under a heading mentioning Iron Laws.
  const lawsHeading = routerText.match(/^#+ .*Iron Laws.*$/im);
  if (lawsHeading) {
    const after = routerText.slice(routerText.indexOf(lawsHeading[0]) + lawsHeading[0].length);
    const fence = after.match(/```[^\n]*\n([\s\S]*?)```/);
    if (fence && fence[1].trim()) parts.push('## Iron Laws\n\n```\n' + fence[1].trim() + '\n```');
  }

  // MANDATORY section: from its heading to the next heading of any level.
  const mand = routerText.match(/^#+ .*MANDATORY[^\n]*$/im);
  if (mand) {
    const start = routerText.indexOf(mand[0]) + mand[0].length;
    const rest = routerText.slice(start);
    const next = rest.match(/^#+ /m);
    const body = (next ? rest.slice(0, next.index) : rest).trim();
    if (body) parts.push('## MANDATORY discipline skills\n\n' + body);
  }

  if (!parts.length) return '';
  return HEADER + '\n\n' + parts.join('\n\n') + '\n';
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('reinject.mjs')) {
  const routerPath = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'AGENTS.md');
  let text = '';
  try {
    text = readFileSync(routerPath, 'utf8');
  } catch {
    // Unreadable router degrades to no output; never block the session (the
    // harness hook contract: injection failures must not kill startup).
    console.error(`reinject: router not readable at ${routerPath} — skipping injection`);
    process.exit(0);
  }
  const block = buildReinject(text);
  if (block) process.stdout.write(block);
}
