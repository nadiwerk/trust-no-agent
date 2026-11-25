/**
 * reinjection — the Gap-1 layer behind the opencode plugin: after compaction,
 * the router floor (Iron Laws + MANDATORY section) returns to context.
 *
 * Canonical builder: scripts/reinject.mjs — copied VERBATIM into this plugin
 * dir as reinject-core.mjs (same content, no drift at copy time; re-copy on
 * upstream updates). buildFloorFromRouter is the thin seam over it: locate the
 * project router (WORKFLOW.md + AGENTS.md at the session directory, or
 * TNA_ROUTER_ROOT for tests), read both, hand the joined text to
 * buildReinject.
 *
 * Injection surface (measured from the V2 plugin docs, 2026-11-15):
 * ctx.session.instructions.entry.put({ sessionID, key, value }) — keyed
 * session instructions render as <context key="..."> blocks and update at the
 * next step boundary WITHOUT queuing a message turn. The plugin attaches the
 * floor under key 'tna-floor' when `session.compaction.ended` fires, so
 * sessions never compacted pay nothing (context is a budget, AGENTS.md §8).
 *
 * Degradation (reinject.mjs contract, unchanged): a half router still emits a
 * floor that NAMES the missing half; no readable router emits '' and the
 * wiring then attaches nothing — never a fake floor, never a thrown error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReinject } from './reinject-core.mjs';

export const FLOOR_KEY = 'tna-floor';

/** Router file names, in reinject.mjs's canonical order (laws, then mandatory). */
export const ROUTER_FILES = ['WORKFLOW.md', 'AGENTS.md'];

/**
 * Build the floor from a directory holding the project router.
 * @param {string} dir directory to read WORKFLOW.md + AGENTS.md from
 * @returns {string} the re-injection block, '' when nothing readable
 */
export function buildFloorFromRouter(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return '';
  const texts = [];
  for (const name of ROUTER_FILES) {
    try {
      texts.push(readFileSync(join(dir, name), 'utf8'));
    } catch {
      /* a missing source is named in the emitted block, not thrown */
    }
  }
  if (!texts.length) return '';
  try {
    return buildReinject(texts.join('\n\n'));
  } catch {
    return '';
  }
}

/**
 * Resolve the router directory for a session: TNA_ROUTER_ROOT wins (tests,
 * single-source installs), else the session's own directory.
 * @param {string | undefined} sessionDirectory
 */
export function resolveRouterDir(sessionDirectory) {
  const env = process.env.TNA_ROUTER_ROOT;
  if (typeof env === 'string' && env.trim() !== '') return env;
  return typeof sessionDirectory === 'string' ? sessionDirectory : '';
}
