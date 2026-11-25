/**
 * output-trim-hook — tool-output compression through OpenCode's `execute.after`.
 *
 * The vendored OutputTrim core already ships `compressForOpencode()` (ads-tracker
 * scripts/output-trim/output-trim-compress.js), but before 2026-11-17 nothing in the
 * OpenCode plugin called it. Claude/Devin cannot rewrite tool output from
 * PostToolUse; OpenCode V2 CAN (`event.result = ...` in execute.after), so the
 * same compressor reaches the model here — a parity improvement, not a port
 * of a missing algorithm.
 *
 * This module owns only the shape seam: find the text in the observed result
 * shapes, refuse Read-class tools (their output feeds later Edit matching),
 * skip small outputs, and call the injected compressor. No I/O, no state —
 * tests attach at compressToolResult with a fake compressor.
 */
const UNSAFE_TOOLS = new Set(['read', 'edit', 'write', 'update', 'multiedit', 'apply_patch']);
const MIN_CHARS = 1000;

function locate(result) {
  const out = result?.output;
  if (typeof out === 'string') return { holder: result, key: 'output', text: out };
  if (out && typeof out === 'object') {
    for (const key of ['text', 'stdout', 'content']) {
      if (typeof out[key] === 'string') return { holder: out, key, text: out[key] };
    }
  }
  const meta = result?.metadata;
  if (meta && typeof meta.stdout === 'string') return { holder: meta, key: 'stdout', text: meta.stdout };
  return null;
}

/**
 * Mutate the result in place (V2 hook contract) and return it.
 * @param {any} result event.result from execute.after
 * @param {string} tool tool name
 * @param {(text:string)=>string|null} compress injected compressor
 */
export function compressToolResult(result, tool, compress, _opts = {}) {
  try {
    if (UNSAFE_TOOLS.has(String(tool ?? '').toLowerCase())) return result;
    if (!result || typeof result !== 'object') return result;
    const found = locate(result);
    if (!found || found.text.length < MIN_CHARS) return result;
    const updated = compress(found.text);
    if (typeof updated === 'string' && updated.length > 0 && updated !== found.text) {
      found.holder[found.key] = updated;
    }
  } catch {
    /* compression never breaks the tool pipeline */
  }
  return result;
}
