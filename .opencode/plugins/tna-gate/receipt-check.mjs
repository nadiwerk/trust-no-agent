/**
 * receipt-check — the 4-block receipt gate for OpenCode commits.
 *
 * Port of ads-tracker `scripts/receipt-gate.mjs` (Claude side). That checker
 * reads `~/.claude/projects/<slug>/*.jsonl`, so in an OpenCode session it sees
 * no transcript at all — the same commit that would be vetoed on Claude sails
 * through here. OpenCode V2 has no transcript file to read either, but the
 * plugin can read the live session via `ctx.session.context({sessionID})`;
 * this module owns the pure verdict over those messages.
 *
 * The rule and the matcher are the Claude ones: the canonical blocks are bold
 * and own their own line (`**Verdict:**`, `**Evidence:**`, `**Open:**`,
 * `**Next:**`). Other shapes are deliberately not accepted. As on Claude,
 * this proves the BLOCKS EXIST, not that the evidence inside them is real —
 * the evidence precondition stays in action-gate's `testPassFresh`.
 *
 * No assistant text = not judgeable = allow (the evidence precondition owns
 * that case), mirroring Claude's "no ledger = existing gate owns it".
 */
import { lastAssistantText, findClaim } from './done-gate.mjs';

export const BLOCKS = ['Verdict', 'Evidence', 'Open', 'Next'];
export const blockPattern = (name) => new RegExp(`^\\s*\\*\\*${name}:\\*\\*`, 'm');

/** @returns {{ok:boolean, missing:string[], text:string|null, claim:string|null}} */
export function receiptVerdict(messages) {
  const text = lastAssistantText(messages ?? []);
  if (!text) return { ok: true, missing: [], text: null, claim: null };
  const missing = BLOCKS.filter((b) => !blockPattern(b).test(text));
  const claim = findClaim(text);
  // A complete receipt passes regardless of phrasing; a partial one fails when
  // it claims completion, or when it started a receipt (some blocks present)
  // and left it incomplete — both are the shapes the Claude gate refuses.
  const ok = missing.length === 0 || (missing.length === BLOCKS.length && !claim);
  return { ok, missing: ok ? [] : missing, text, claim };
}
