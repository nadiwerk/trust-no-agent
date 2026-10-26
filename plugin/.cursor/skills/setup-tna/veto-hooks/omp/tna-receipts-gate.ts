// done-receipt-gate — omp-native receipts enforcer (user-global extension).
//
// Port of ~/.omo/agent/hooks/done-receipt-gate.mjs (senpi Stop hook) to omp's
// extension API. omp dispatches `session_stop` with a Claude/Codex-compatible
// block decision: returning { decision: "block", reason } continues the main
// session with a model-visible reason — the same stop-and-correct semantics the
// senpi Stop hook had, not a trap.
//
// WHY THIS EXISTS:
//   The `receipts` skill says "NO DONE CLAIM WITHOUT FRESH VERIFICATION
//   EVIDENCE", but a skill is model-invoked: the model can finish work, write
//   "done", and nothing notices that no command ran in THIS turn. This gate
//   notices, at the one event that fires when the turn settles.
//
// SHAPE — BLOCK by default, with a deliberate escape hatch:
//   claim text in the closing assistant message + zero verification tool calls
//   after the last user message => block with the notice. `stop_hook_active`
//   (true while continuing a previous block) is never re-blocked, so the gate
//   cannot loop. DONE_GATE_ENFORCE=warn downgrades to additionalContext;
//   =off disables.
//
// POSTURE — FAIL-OPEN, ALWAYS. Any error is swallowed; a gate that can crash a
// session is worse than no gate.

import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * @typedef {(event: Record<string, unknown>, ctx: unknown) => unknown} StopHandler
 * @typedef {{ on(event: string, handler: StopHandler): void }} ExtensionPi
 */

const HOME = process.env.USERPROFILE || process.env.HOME || homedir();
const TRACE_PATH = join(HOME, '.omp', 'agent', 'hooks', 'tna-trace.log');

/** Phrases that assert completion. Kept tight: a broad matcher is a nuisance. */
const CLAIM_PATTERNS = [
  /\b(done|finished|complete|completed|fixed|shipped|resolved|working now|all set)\b/i,
  /\b(selesai|beres|tuntas|sudah (?:jadi|dibuat|dipasang|diperbaiki|saya pasang|terpasang|commit|terisi|kasih))\b/i,
  /\b(it works|has been (?:fixed|installed|deployed)|is now (?:fixed|working|live))\b/i,
  /\b(hapus sekarang|tidak akan (saya )?ulang|bukti pertama|ledger terisi|index terisi|semua hijau|5 boolean)\b/i,
];

/**
 * Tool calls that count as VERIFICATION evidence.
 *
 * Origin 2026-10-25 (omp fix-list #8, measured): the set was
 * `['bash','eval','read','write','edit']`, so "write a file then say Done" passed
 * the gate — `read`/`write`/`edit` are WORK, not proof of work — while `grep`,
 * `glob` and `lsp`, which CAN prove something, were not counted at all
 * (`evidence via grep -> BLOCKED`).
 *
 * The set now means "a tool whose OUTPUT can settle the claim":
 *   - execution: `bash`/`pwsh`/`shell`/`exec_command`/`eval`/`codemode`;
 *   - search and inspection: `grep`/`glob`/`find`/`ls`/`lsp` — the report calls
 *     their exclusion a defect, and their output is quotable.
 *
 * `write`/`edit` are OUT: creating a file is never evidence that the claim is
 * true (pinned by O8a). `read` is OUT too, following the fix-list's explicit
 * recommendation — a bare read is "the turn touched something", not "the claim
 * was checked"; the receipts notice asks the agent to paste the decisive output
 * instead. Cost of that strictness: a turn that only reads and claims "the file
 * says X" gets one notice asking for the output. That is the cheaper error.
 */
const EVIDENCE_TOOLS = new Set([
  'bash', 'powershell', 'pwsh', 'shell', 'exec_command', 'eval', 'codemode',
  'grep', 'glob', 'find', 'ls', 'lsp',
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function trace(detail) {
  if (process.env.TNA_HOOK_TRACE !== '1') return;
  try {
    appendFileSync(
      TRACE_PATH,
      JSON.stringify({ ts: new Date().toISOString(), gate: 'tna-receipts', ...detail }) + '\n',
    );
  } catch {
    /* tracing must never fail the session */
  }
}

/**
 * Assistant text of the LAST assistant message that has prose.
 * @param {Record<string, unknown>[]} messages
 * @returns {string}
 */
function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!isObject(msg) || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    const text = msg.content
      .filter((part) => isObject(part) && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (text.trim()) return text;
  }
  return '';
}

/**
 * Block types that carry a tool call — every spelling the harnesses emit.
 *
 * Origin 2026-10-25 (audit-run-blockers #12, measured): this knew only
 * `toolCall`, so omp's own wire shapes (`tool-call`, `tool_use`) were invisible
 * and a turn that HAD run its tests was still blocked. Recognising every
 * spelling removes the false positive without weakening the gate (a turn with no
 * tool call at all is still blocked).
 */
const TOOL_BLOCK_TYPES = new Set(['tool-call', 'tool_use', 'toolCall']);

/**
 * Tool-call names used after the last user message — i.e. in THIS turn.
 * @param {Record<string, unknown>[]} messages
 * @returns {Set<string>}
 */
function toolNamesThisTurn(messages) {
  const used = new Set();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (isObject(msg) && msg.role === 'user') break;
    if (!isObject(msg) || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (isObject(part) && TOOL_BLOCK_TYPES.has(part.type) && typeof part.name === 'string') {
        used.add(part.name.toLowerCase());
      }
    }
  }
  return used;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function findClaim(text) {
  for (const re of CLAIM_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/** @param {ExtensionPi} pi */
export default function factory(pi) {
  pi.on('session_stop', (event) => {
    try {
      if (event.stop_hook_active) return; // already continuing a previous block
      if (!Array.isArray(event.messages)) return;
      /** @type {Record<string, unknown>[]} */
      const messages = event.messages;

      const text = lastAssistantText(messages);
      if (!text) return;

      const claim = findClaim(text);
      const evidence = [...toolNamesThisTurn(messages)].filter((t) => EVIDENCE_TOOLS.has(t));
      const mode = String(process.env.DONE_GATE_ENFORCE || 'block').trim().toLowerCase();
      // Entry trace: proves the extension was dispatched in a live session,
      // even when the turn passes the gate (claim null / evidence present).
      trace({ event: 'session_stop', claim, evidenced: evidence.length > 0, mode });
      if (!claim) return;
      if (evidence.length) return; // the turn did something checkable

      const notice = [
        '## receipts gate — completion claim with no verification in this turn',
        '',
        `This turn's closing text asserts completion (matched: "${claim}"), but no tool call ran in`,
        'this turn that could be its evidence. The `receipts` skill is explicit: the verification',
        'command must run in THIS message — "a run from an earlier message proves nothing about the',
        'current state."',
        '',
        'Either:',
        '- run the proof command now and cite its output, or',
        '- state plainly which part is unverified and why the claim still holds.',
        '',
      ].join('\n');

      if (mode === 'off' || mode === 'false' || mode === '0') return;
      if (mode === 'warn') return { additionalContext: notice };
      return { decision: 'block', reason: notice };
    } catch {
      /* fail-open */
    }
  });
}
