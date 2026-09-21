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

// Which source file each half of the floor is expected to live in. Used only
// to make a missing half legible in the emitted block; the extractor never
// reads these files itself (it is a pure function over the text it is handed).
const LAWS_SOURCE = 'WORKFLOW.md';
const MANDATORY_SOURCE = 'AGENTS.md';

/**
 * Canonical law stems, lowercase. Detection is stem-anchored rather than
 * heading- or fence-anchored, because no file in this repo styles the laws as
 * a fenced block (the shape this module originally assumed — see the note at
 * the bottom of this file). A candidate is accepted as more than a passing
 * reference only when it carries a negative imperative and is long enough to
 * matter, and the four must appear in order, in one region, to count as the
 * laws rather than four unrelated "no …" lines elsewhere in the document.
 */
const LAW_STEMS = [
  'no acting until the user confirms',
  'no production code without a failing test',
  'no completion claims without fresh',
  'no expensive, irreversible, or shared-system action',
];

const MAX_LAW_CHARS = 400;

/** Collect imperative "no …" lines (list items or plain lines, nested or not). */
function collectLawCandidates(text) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const m = rawLine.match(/^\s*(?:[-*+]|\d+[.)])?\s*(No\s+\S.*)$/);
    if (!m) continue;
    const body = m[1].trim();
    if (body.length < 40 || body.length > MAX_LAW_CHARS) continue;
    out.push({ body, lineIndex: out.length, raw: rawLine });
  }
  return out;
}

/**
 * Find the four laws in either the fenced/heading form this module always
 * supported or the in-order list form the repo actually uses.
 * Returns the extracted text (fence-stripped) or null.
 */
function extractLaws(text) {
  // Form 1 — the historical shape: a heading mentioning the laws, then a fence.
  const lawsHeading = text.match(/^#+ .*Iron Laws.*$/im);
  if (lawsHeading) {
    const after = text.slice(text.indexOf(lawsHeading[0]) + lawsHeading[0].length);
    const fence = after.match(/```[^\n]*\n([\s\S]*?)```/);
    if (fence && fence[1].trim()) return fence[1].trim();
  }

  // Form 2 — the shape the repo actually has: the four negatives as an ordered
  // run of lines. Search for the first line matching law 1, then require laws
  // 2-4 to follow in order within a bounded window.
  const lines = text.split(/\r?\n/);
  const candidates = collectLawCandidates(text);
  for (const first of candidates) {
    if (!first.body.toLowerCase().includes(LAW_STEMS[0])) continue;
    const run = [first];
    let cursor = first.lineIndex;
    for (let i = 1; i < LAW_STEMS.length; i++) {
      const nextIndex = candidates.findIndex(
        (c) => c.lineIndex > cursor && c.body.toLowerCase().includes(LAW_STEMS[i])
      );
      if (nextIndex === -1) break;
      run.push(candidates[nextIndex]);
      cursor = candidates[nextIndex].lineIndex;
    }
    if (run.length !== LAW_STEMS.length) continue;
    // Bounded: four laws must sit within 12 source lines of each other, so a
    // document that happens to mention each stem in a distant section cannot
    // assemble a fake run.
    const firstLine = lines.indexOf(first.raw);
    const lastLine = lines.indexOf(run[run.length - 1].raw);
    if (firstLine === -1 || lastLine === -1 || lastLine - firstLine > 12) continue;
    return run.map((c) => c.body).join('\n');
  }

  return null;
}

/**
 * Extract the re-injection block from router text.
 * Returns '' when the router carries neither the Iron Laws nor the
 * MANDATORY section — the caller then skips the injection (graceful
 * degradation, AGENTS.md §8: references degrade, never hard-fail).
 *
 * A half-filled block stays non-empty on purpose. Degrading to "print what we
 * found, and name the half we could not" keeps the harness contract (something
 * is always emitted) while refusing to let a missing floor read as a complete
 * one — the 2026-09-21 finding was exactly that silent half.
 */
export function buildReinject(routerText) {
  if (!routerText) return '';

  const parts = [];

  const laws = extractLaws(routerText);
  if (laws) {
    parts.push('## Iron Laws\n\n' + laws);
  } else {
    parts.push(
      `## Iron Laws — NOT FOUND in the text handed to this extractor\n\n` +
        `The four Iron Laws were not present in the router text passed in. They normally live in ` +
        `${LAWS_SOURCE}; if you are seeing this, pass that file's text too (or wire both files) — ` +
        `do not re-print this block as if the discipline floor were complete.`
    );
  }

  // MANDATORY section: from its heading to the next heading of any level.
  const mand = routerText.match(/^#+ .*MANDATORY[^\n]*$/im);
  if (mand) {
    const start = routerText.indexOf(mand[0]) + mand[0].length;
    const rest = routerText.slice(start);
    const next = rest.match(/^#+ /m);
    const body = (next ? rest.slice(0, next.index) : rest).trim();
    if (body) parts.push('## MANDATORY discipline skills\n\n' + body);
  } else {
    parts.push(
      `## MANDATORY discipline skills — NOT FOUND in the text handed to this extractor\n\n` +
        `The MANDATORY section was not present in the router text passed in. It normally lives in ` +
        `${MANDATORY_SOURCE}.`
    );
  }

  return HEADER + '\n\n' + parts.join('\n\n') + '\n';
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('reinject.mjs')) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  // The laws and the MANDATORY section do not live in the same file. Reading
  // only AGENTS.md — the default this CLI shipped with — always produced a
  // half floor without saying so (2026-09-21 finding). Both sources are read
  // and concatenated; an explicit path argument still wins for callers with a
  // single-file router.
  const paths = args.length ? args : [join(repoRoot, LAWS_SOURCE), join(repoRoot, MANDATORY_SOURCE)];

  const texts = [];
  const unreadable = [];
  for (const p of paths) {
    try {
      texts.push(readFileSync(p, 'utf8'));
    } catch {
      unreadable.push(p);
    }
  }

  if (!texts.length) {
    // Unreadable router degrades to no output; never block the session (the
    // harness hook contract: injection failures must not kill startup).
    console.error(`reinject: no router source readable (${paths.join(', ')}) — skipping injection`);
    process.exit(0);
  }
  for (const p of unreadable) console.error(`reinject: source not readable at ${p}`);

  const block = buildReinject(texts.join('\n\n'));
  if (block) process.stdout.write(block);
  // A block that still names a missing half exits 1: the caller gets the
  // degraded text either way, but a silent half can no longer pass as a
  // complete injection in CI or a hook's exit-code check.
  process.exit(/NOT FOUND/.test(block) ? 1 : 0);
}
