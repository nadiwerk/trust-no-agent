/**
 * done-enforce — turn an unverified completion claim into WORK, not a note.
 *
 * Claude Code's Stop hook can refuse to stop until verification exists.
 * OpenCode V2 has no completion veto, but it emits `session.execution.succeeded`
 * with the finished turn's messages and exposes `ctx.session.prompt` with a
 * steer delivery. This module decides WHEN to re-enter the agent so a bare
 * "selesai" cannot be the last word. The original flag (opencode-v2-donegate)
 * stays as the audit trail; this layer is the enforcement that Master asked
 * for on 2026-11-17.
 *
 * Guard rails: one correction per distinct claim, max 2 per session — a
 * model that still claims without evidence after two corrections is logged,
 * not looped forever.
 */
export const CORRECTION_KEY = 'tna-donegate';

export const CORRECTION_PROMPT =
  'TNA done-gate: giliran sebelumnya menyatakan pekerjaan selesai TANPA tool verifikasi ' +
  'dalam giliran yang sama. Jalankan perintah verifikasi yang sesuai sekarang, baca outputnya, ' +
  'lalu perbaiki klaim selesai itu berdasarkan bukti. Jangan mengulang klaim tanpa bukti.';

export const LEDGER_CORRECTION_PROMPT =
  'TNA ship-log gate: giliran ini mengubah file/menyelesaikan unit tetapi progress.txt belum ' +
  'diperbarui. Tambahkan entri Ringkasan Sesi + Self-Review 4 dimensi ke progress.txt SEBELUM ' +
  'menyatakan selesai. Jangan mengulang klaim sebelum ledger ditulis.';

/** Tools whose successful call means a file was changed this turn. */
export const MODIFY_TOOLS = new Set(['write', 'edit', 'update', 'multiedit', 'apply_patch']);

/** True when an assistant tool part in this turn touched the project ledger. */
export function ledgerTouchedInTurn(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (const msg of list) {
    if (!msg || msg.type !== 'assistant') continue;
    for (const part of (Array.isArray(msg.content) ? msg.content : [])) {
      if (!part || part.type !== 'tool') continue;
      const state = part.state ?? {};
      const input = state.input ?? part.input ?? {};
      const blob = JSON.stringify(input ?? {});
      if (/progress\.txt/i.test(blob)) return true;
    }
  }
  return false;
}

/** True when this turn contains a file-changing tool call. */
export function modifiedFilesInTurn(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.some((msg) => msg?.type === 'assistant' &&
    (Array.isArray(msg.content) ? msg.content : []).some((p) => p?.type === 'tool' && MODIFY_TOOLS.has(String(p.name ?? '').toLowerCase())));
}

export const MAX_CORRECTIONS = 2;

/** Cheap stable fingerprint so the same claim is not corrected twice. */
export function fingerprintClaim(value) {
  const s = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * @returns {{enforce:boolean, reason:string}}
 */
export function doneEnforcementVerdict({
  claim = null,
  evidence = true,
  ledgerTouched = false,
  modifiedFiles = false,
  correctionCount = 0,
  corrected = [],
  fingerprint = '',
} = {}) {
  if (!claim) return { enforce: false, reason: 'no completion claim' };
  const kind = !evidence ? 'verify' : (modifiedFiles && !ledgerTouched ? 'ledger' : null);
  if (!kind) return { enforce: false, reason: 'claim has evidence and no ledger debt' };
  if (fingerprint && Array.isArray(corrected) && corrected.includes(fingerprint)) {
    return { enforce: false, reason: 'this claim was already corrected' };
  }
  if (Number(correctionCount) >= MAX_CORRECTIONS) {
    return { enforce: false, reason: 'correction cap reached — logged, not looped' };
  }
  return {
    enforce: true,
    kind,
    reason: kind === 'verify' ? 'unverified completion claim must be corrected' : 'files changed but ledger not updated this turn',
  };
}
