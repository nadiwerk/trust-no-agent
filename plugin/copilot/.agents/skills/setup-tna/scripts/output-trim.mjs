#!/usr/bin/env node
/**
 * output-trim — PostToolUse hook: deterministic tool-output compression
 * (the input axis of the context budget, AGENTS.md §8).
 *
 * Prompt-side rules shrink what the agent WRITES; this shrinks what it READS.
 * Oversized tool results get their repetitive middle elided — head kept
 * (command context), tail kept (results/errors), error-looking lines salvaged
 * from the cut — and the trimmed version replaces what the model sees.
 * Deterministic, zero LLM, zero network. Small outputs pass through.
 *
 * Provenance: ported from a production adopter implementation (MIT). The
 * salvage regex in output-trim-core carries that adopter's measured patches —
 * failure markers their toolchains actually print (`✗` vitest glyph, npm
 * `ERR!` / `ELIFECYCLE`) that upstream's alternation missed and that were
 * being silently elided from the middle of compressed dumps. Keep them.
 *
 * Correctness guardrails (why this never touches Read/Edit/Write):
 *   - Read output feeds later Edit exact-match edits — eliding it makes the
 *     model edit text it never saw. Allowlist, never a blocklist.
 *   - Error lines in the elided middle are salvaged, capped, kept verbatim.
 *   - If compression doesn't shrink the output, the original is kept.
 *   - Never throws: a broken hook must not break the tool pipeline.
 *   - Elided originals spill to .trust/output-trim-spill/ so the dropped
 *     middle is greppable instead of re-running the command.
 *
 * Two tiers, applied in order (engine: output-trim-core.mjs):
 *   scrub (>1k)  — strip ANSI, minify pretty-printed JSON, collapse blank
 *                  runs, collapse ≥4 identical consecutive lines, collapse
 *                  ≥6 consecutive passing-test/progress lines.
 *   elide (>8k)  — head + tail + error salvage.
 * Plus dedup: a tool output byte-identical to that tool's previous output in
 * the same session is replaced by a marker — the content is already in
 * context.
 *
 * Mode/state, all under the project's .trust/ (never hard-fails):
 *   .trust/output-trim.json {"enabled": false}   — opt-out flag
 *   .trust/output-trim-stats.json                — savings ledger
 *   .trust/output-trim-spill/                    — elided originals (newest 40)
 *   .trust/output-trim-dedup/                    — per-session dedup state
 *
 * Env (all optional):
 *   OUTPUT_TRIM=0            — kill switch
 *   OUTPUT_TRIM_SCRUB=0      — disable the lossless scrub tier
 *   OUTPUT_TRIM_DEDUP=0      — disable duplicate-output markers
 *   OUTPUT_TRIM_MAX_CHARS    — outputs at/under this size are not elided
 *   OUTPUT_TRIM_HEAD_LINES / OUTPUT_TRIM_TAIL_LINES
 *   OUTPUT_TRIM_TOOLS=a,b    — override the tool allowlist (never unlocks
 *                              the read/write family — that invariant is
 *                              enforced, not defaulted)
 *   OUTPUT_TRIM_SPILL=0      — elide without writing the recovery copy
 *   OUTPUT_TRIM_STATE_DIR    — override the .trust state root (tests)
 */
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync,
  unlinkSync, writeFileSync, openSync, closeSync, fchmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SCRUB_MIN, MIN_WIN, limitsFor, toolAllowed, extractText, rebuildResponse,
  scrub, duplicateMarker, compress,
} from './output-trim-core.mjs';

export {
  THRESHOLDS, toolAllowed, limitsFor, extractText, rebuildResponse, scrub,
  duplicateMarker, compress,
} from './output-trim-core.mjs';

const DEDUP_MIN = 2048;
const SPILL_KEEP = 40;
const DEDUP_SESSION_KEEP = 20;

// ---- state root: <cwd>/.trust, overridable for tests ----
function stateRoot(cwd) {
  return process.env.OUTPUT_TRIM_STATE_DIR || join(cwd || process.cwd(), '.trust');
}
function configEnabled(cwd) {
  try {
    const c = JSON.parse(readFileSync(join(stateRoot(cwd), 'output-trim.json'), 'utf8'));
    return c.enabled !== false;
  } catch { return true; } // absent config = on
}

function safeAtomicWrite(p, content) {
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, 'w', 0o600);
    try { writeFileSync(fd, content); } finally { closeSync(fd); }
    try { fchmodSync(tmp, 0o600); } catch { /* windows */ }
    renameSync(tmp, p);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch {}
    return false;
  }
}

function dedupCheck(toolName, text, sessionId, stateDir) {
  if (process.env.OUTPUT_TRIM_DEDUP === '0') return null;
  if (!sessionId || typeof sessionId !== 'string') return null;
  if (text.length < DEDUP_MIN) return null;
  try {
    const sid = createHash('sha256').update(sessionId).digest('hex');
    const dir = join(stateDir, 'output-trim-dedup');
    const p = join(dir, `${sid}.json`);
    let state = { tools: {} };
    try { state = JSON.parse(readFileSync(p, 'utf8')) || state; } catch {}
    const hash = createHash('sha256').update(text).digest('hex');
    const dup = state.tools[toolName] && state.tools[toolName].hash === hash;
    state.tools[toolName] = { hash };
    mkdirSync(dir, { recursive: true });
    safeAtomicWrite(p, JSON.stringify(state));
    // Keep the dir bounded — one file per session id, newest kept.
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
        .map((f) => ({ p: join(dir, f), t: lstatSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const f of files.slice(DEDUP_SESSION_KEEP)) { try { unlinkSync(f.p); } catch {} }
    } catch {}
    return dup ? duplicateMarker(toolName, text) : null;
  } catch { return null; }
}

// ---- Elision with spill recovery ----
// Elision destroys the middle; if the agent then needs a line from it, its
// only recourse without a spill is re-running the command — more expensive
// than the elision saved and wrong on non-idempotent commands. The full text
// spills to disk first and the marker carries the path.
function spillDir(stateDir) { return join(stateDir, 'output-trim-spill'); }

function pruneSpill(dir) {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({ p: join(dir, f), t: lstatSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const f of files.slice(SPILL_KEEP)) { try { unlinkSync(f.p); } catch {} }
  } catch {}
}

function spill(text, toolName, stateDir) {
  if (process.env.OUTPUT_TRIM_SPILL === '0') return null;
  try {
    const dir = spillDir(stateDir);
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 12);
    const safeTool = String(toolName || 'tool').replace(/[^A-Za-z0-9_-]/g, '') || 'tool';
    const file = join(dir, `${safeTool}-${hash}.txt`);
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      if (!safeAtomicWrite(file, text)) return null;
    }
    pruneSpill(dir);
    return file;
  } catch { return null; }
}

// Best-effort savings ledger — stats only, never worth a lock file.
export function recordSavings(saved, stateDir) {
  try {
    const p = join(stateDir, 'output-trim-stats.json');
    let stats = { savedChars: 0, events: 0 };
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      if (parsed && Number.isFinite(parsed.savedChars) && Number.isFinite(parsed.events)) stats = parsed;
    } catch {}
    stats.savedChars += saved;
    stats.events += 1;
    safeAtomicWrite(p, JSON.stringify(stats));
  } catch {}
}

/**
 * Scrub + elide on plain text → transformed text, or null if no meaningful
 * win. Stateless aside from the spill side-effect.
 */
export function transform(text, limits, toolName, stateDir) {
  if (!text || text.length <= SCRUB_MIN) return null;
  let t = process.env.OUTPUT_TRIM_SCRUB === '0' ? text : scrub(text);
  if (t.length > limits.maxChars) {
    const elided = compress(t, limits, toolName ? spill(t, toolName, stateDir) : null);
    if (elided != null) t = elided;
  }
  return text.length - t.length >= MIN_WIN ? t : null;
}

function isCopilotPayload(payload) {
  return payload && typeof payload === 'object' &&
    payload.toolResult && typeof payload.toolResult.textResultForLlm === 'string';
}

/**
 * Full pipeline on one hook payload → updated output string, or null to keep
 * the original. Fail-open on every path.
 */
export function processPayload(payload, cwd) {
  if (!payload || typeof payload !== 'object') return null;
  if (process.env.OUTPUT_TRIM === '0') return null;
  if (!configEnabled(cwd)) return null;
  const stateDir = stateRoot(cwd);

  if (isCopilotPayload(payload)) {
    const toolName = payload.toolName;
    if (!toolAllowed(toolName)) return null;
    const text = payload.toolResult.textResultForLlm;
    if (!text) return null;
    const dup = dedupCheck(toolName, text, payload.sessionId, stateDir);
    if (dup != null && dup.length < text.length) return dup;
    return transform(text, limitsFor(), toolName, stateDir);
  }

  if (!toolAllowed(payload.tool_name)) return null;
  const text = extractText(payload.tool_response != null ? payload.tool_response : payload.tool_output);
  if (!text) return null;
  const dup = dedupCheck(payload.tool_name, text, payload.session_id, stateDir);
  if (dup != null && dup.length < text.length) return dup;
  return transform(text, limitsFor(), payload.tool_name, stateDir);
}

function main() {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(input.replace(/^﻿/, ''));
      const cwd = payload.cwd || process.cwd();
      const updated = processPayload(payload, cwd);
      if (updated == null) return;

      if (isCopilotPayload(payload)) {
        const original = payload.toolResult.textResultForLlm;
        recordSavings(original.length - updated.length, stateRoot(cwd));
        // Echo back the result type we were handed — the compressor rewrites
        // text, never status.
        const resultType = payload.toolResult.resultType || 'success';
        process.stdout.write(JSON.stringify({
          modifiedResult: { resultType, textResultForLlm: updated },
        }));
        return;
      }

      const response = payload.tool_response != null ? payload.tool_response : payload.tool_output;
      const rebuilt = rebuildResponse(response, updated);
      if (rebuilt == null) return;
      const original = extractText(response);
      recordSavings(original.length - updated.length, stateRoot(cwd));
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: rebuilt,
        },
      }));
    } catch { /* silent — never break the tool pipeline */ }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
