#!/usr/bin/env node
/**
 * tna-store — the evidence store behind the opencode V2 veto (ticket 08,
 * storage redesign).
 *
 * Why this exists: a V2 `execute.before` hook can throw (deny works live)
 * but its filesystem writes vanish — proven 2026-10-12 (probe-4/5/6 denied,
 * `.trust/` never appeared in the live dir, not even from a probe writing
 * directly). The only durable write the V2 docs offer a plugin is
 * `ctx.storage` (durable JSON scoped to the plugin). So:
 *
 *   - READS prefer the project's `.trust/` FS copy (doctor + audit read the
 *     FS; an out-of-hook sync may place it there), falling back to storage.
 *   - WRITES go to storage ALWAYS. Nothing in a hook path touches the FS.
 *
 * Absent/corrupt everywhere reads as testPassFresh:false — no evidence means
 * deny for irreversible actions, never silent allow. Every failure degrades
 * to deny-safe defaults and never throws (a store that breaks the veto it
 * feeds is worse than no store).
 *
 * Zero dependencies (node builtins only). Tested fail-first by
 * tna-store.test.mjs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'tna-gate-state.json';
const STATE_KEY = 'tna-gate-state';
const LOG_KEY = 'tna-gate-log';

const noEvidence = () => ({ testPassFresh: false });

function validState(s) {
  return s && typeof s === 'object' && typeof s.testPassFresh === 'boolean' ? s : null;
}

/**
 * @param {{fsDir?: string, storage?: {get(k:string):Promise<any>, set(k:string,v:any):Promise<void>}}} backends
 */
export function makeStore({ fsDir = '', storage = null } = {}) {
  async function readState() {
    if (fsDir) {
      try {
        const s = validState(JSON.parse(readFileSync(join(String(fsDir), '.trust', STATE_FILE), 'utf8')));
        if (s) return s;
      } catch {
        /* FS copy absent/corrupt — fall through to storage */
      }
    }
    if (storage) {
      try {
        const s = validState(await storage.get(STATE_KEY));
        if (s) return s;
      } catch {
        /* unreadable storage is not evidence */
      }
    }
    return noEvidence();
  }

  async function writeState(state) {
    if (!storage) return false;
    try {
      await storage.set(STATE_KEY, { ...state, updatedAt: new Date().toISOString() });
      return true;
    } catch {
      return false;
    }
  }

  async function logVeto({ tool = '', command = '', harness = 'opencode-v2' } = {}) {
    if (!storage) return false;
    try {
      const log = (await storage.get(LOG_KEY)) || [];
      await storage.set(LOG_KEY, [...log, { ts: new Date().toISOString(), harness, tool, command }]);
      return true;
    } catch {
      return false;
    }
  }

  return { readState, writeState, logVeto };
}
