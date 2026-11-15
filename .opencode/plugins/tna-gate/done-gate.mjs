/**
 * done-gate — the classifier behind the opencode plugin's done-gate layer.
 *
 * Port of the canonical senpi Stop-hook classifier
 * (~/.omo/agent/hooks/done-receipt-gate.mjs): the SAME CLAIM_PATTERNS and the
 * SAME turn boundary (no evidence from an earlier turn). The adapter changes
 * only where the events come from — opencode V2 has no Stop hook, so the
 * plugin flags on `session.idle` (the session is already idle; the router's
 * done-gate layer is "completion claim with no verifying tool call FLAGGED",
 * not blocked).
 *
 * Message shape is the one MEASURED live 2026-11-15 via
 * `opencode api session.message.list --param sessionID=...`:
 *   user      -> { type: 'user', text: '...' }
 *   assistant -> { type: 'assistant', content: [ {type:'text', text}, {type:'tool', name, state:{...}} ] }
 * Other kinds (system, idle, agent-switched) are skipped.
 *
 * Zero dependencies (node builtins only). Fixture-testable without a live
 * opencode runtime.
 */

/**
 * Phrases that assert completion. Ported VERBATIM from the canonical
 * done-receipt-gate (kept tight there — a broad matcher is a nuisance; the
 * known residual, stated in the canonical file, is that "done explaining"
 * also matches — accepted there, so it is accepted here: one table, no drift).
 */
export const CLAIM_PATTERNS = [
  /\b(done|finished|complete|completed|fixed|shipped|resolved|working now|all set)\b/i,
  /\b(selesai|beres|sudah (?:jadi|dibuat|dipasang|diperbaiki|saya pasang|terpasang|commit|terisi|kasih)|tuntas)\b/i,
  /\b(it works|has been (?:fixed|installed|deployed)|is now (?:fixed|working|live))\b/i,
  /\b(hapus sekarang|tidak akan (saya )?ulang|bukti pertama|ledger terisi|index terisi|semua hijau|5 boolean)\b/i,
];

/**
 * Tool calls that count as verification evidence, by name. The canonical set
 * (bash/eval/read/write/edit) mapped onto opencode's measured tool names:
 * opencode names its shell tool `shell` (measured live); read/write/edit
 * carry the same meaning.
 */
export const EVIDENCE_TOOLS = new Set(['shell', 'bash', 'eval', 'read', 'write', 'edit', 'update']);

export function findClaim(text) {
  for (const re of CLAIM_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Assistant prose of the LAST assistant message that has any. */
export function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.type !== 'assistant') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    const text = content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (text.trim()) return text;
  }
  return '';
}

/**
 * Did any EVIDENCE-class tool call happen after the last user message?
 * Walks backward; the first user message is the start of the current turn —
 * tool calls before it belong to an earlier turn and prove nothing here
 * ("a run from an earlier message proves nothing about the current state").
 */
export function evidenceToolsThisTurn(messages) {
  const used = new Set();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.type === 'user') break;
    if (msg.type !== 'assistant') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part && part.type === 'tool' && part.name) used.add(String(part.name).toLowerCase());
    }
  }
  return used;
}

/**
 * @param {readonly {type: string, text?: string, content?: readonly {type: string, text?: string, name?: string}[]}[] | null} messages
 * @returns {{claim: string|null, evidence: boolean}}
 */
export function doneGateVerdict(messages) {
  if (!Array.isArray(messages)) return { claim: null, evidence: false };
  const text = lastAssistantText(messages);
  if (!text) return { claim: null, evidence: false };
  const claim = findClaim(text);
  if (!claim) return { claim: null, evidence: false };
  const used = evidenceToolsThisTurn(messages);
  const evidence = [...used].some((t) => EVIDENCE_TOOLS.has(t));
  return { claim, evidence };
}
