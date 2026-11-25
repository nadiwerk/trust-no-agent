/**
 * prompt-gate — per-prompt MANDATORY routing for the OpenCode V2 plugin.
 *
 * Port of the Claude gate-hook's `UserPromptSubmit` half (gate-hook.mjs:
 * DOMAIN_INSTRUCTION + classifyTask). Self-trigger for the three MANDATORY
 * skills is proven unreliable (0/3 fresh agents), so Claude injects a named
 * instruction for every keyword-flagged domain. OpenCode previously ran
 * `classifyTask` only inside the delegation gate — the agent's OWN prompt
 * arrived ungated. V2 exposes `ctx.session.hook("prompt")`, which receives a
 * mutable text draft before model/skill resolution; this module produces the
 * text to append. The marker makes the decoration retry-safe: prompt hooks
 * can run more than once for the same admission (official V2 docs).
 *
 * Pure module, no I/O — tests attach at promptGateVerdict/decoratePrompt.
 */
import { classifyTask } from './mandatory-gate.mjs';

export const DOMAIN_INSTRUCTION = {
  'expect-fail':
    'Expect no production code and no test without a failing test first — load the `expect-fail` ' +
    'skill before writing either. Writing tests is never `fast` (AGENTS.md §1).',
  'root-cause':
    'Look up the root cause before proposing any fix — load the `root-cause` skill first. A fix ' +
    'proposed before the cause is known is a guess with a receipt attached.',
  receipts:
    'No "done"/"shipped"/"fixed" claim, commit, or PR without fresh verification evidence run in ' +
    'this session — load the `receipts` skill first. The agent\'s own claim is not evidence.',
};

const MARKER = '<tna-mandatory';

/** @returns {{domain: 'expect-fail'|'root-cause'|'receipts'|null, instruction: string|null}} */
export function promptGateVerdict(text) {
  const value = String(text ?? '');
  if (!value) return { domain: null, instruction: null };
  let verdict;
  try {
    verdict = classifyTask(value);
  } catch {
    return { domain: null, instruction: null }; // classifier failure -> no injection, never break admission
  }
  // Deterministic priority; a prompt can hit several domains. Receipts wins on
  // commit/ship requests because that is the last gate before an irreversible
  // action; otherwise the earliest canonical domain order applies.
  const domain = ['receipts', 'root-cause', 'expect-fail'].find((d) => verdict?.[d]) ?? null;
  return { domain, instruction: domain ? DOMAIN_INSTRUCTION[domain] : null };
}

/** Append the flagged instruction once; leave an already-tagged prompt alone. */
export function decoratePrompt(text) {
  const value = String(text ?? '');
  if (value.includes(MARKER)) return value;
  const { domain, instruction } = promptGateVerdict(value);
  if (!domain) return value;
  return `${value}\n\n${MARKER} domain="${domain}">\ntrust-no-agent mandatory-gate flagged this request (keyword signal — verify, not proof):\n${instruction}\nLoad the flagged skill before the work it governs; if the flag does not apply, say so and proceed.\n</tna-mandatory>`;
}
