#!/usr/bin/env node
/**
 * Receipt enforcement — the hilir side (receipt-enforcement spec; tickets
 * 01/02 here, the runner in 03, the wiring in 04-06). Zero dependencies.
 *
 * A claim's trust decays by computation, never by memory: a receipt older
 * than RECEIPT_STALE_DAYS must be re-verified (its cited gates re-run) before
 * it may gate anything — the stale-probe vocabulary applied to claims. The
 * receipt's SHAPE is validated: the four blocks, the five booleans each
 * carrying their own evidence (a blanket all-yes is not a verdict), and cited
 * commands must be repo gates (the allowlist is read from the framework
 * repo's CI workflow at call time, so it cannot drift).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECEIPT_STALE_DAYS = 14;
const DAY = 86400000;
const BLOCKS = ['Verdict', 'Evidence', 'Open', 'Next'];
const BOOLEANS = [
  'constraints satisfied',
  'evidence fresh',
  'scope held',
  'subject verified',
  'fail-first proven',
];

/** The repo-gate allowlist, read from the framework repo's CI workflow. */
export function repoGateCommands() {
  const wf = join(ROOT, '.github', 'workflows', 'ci.yml');
  if (!existsSync(wf)) return new Set();
  const gates = new Set();
  for (const m of readFileSync(wf, 'utf8').matchAll(/node (scripts\/[a-z0-9./-]+\.mjs)/g))
    gates.add(`node ${m[1]}`);
  return gates;
}

/**
 * Validate a receipt's text. Pure in shape: the text and (optionally) the
 * gate set are inputs; returns the parsed shape plus named errors. The
 * full/loop shape is the four blocks with per-boolean evidence under
 * Verdict; the fast shape is one line (claim + command + result).
 */
export function validateReceipt(text, { gates } = {}) {
  const src = String(text || '');
  const allow = gates || repoGateCommands();
  const errors = [];
  const blocks = {};
  for (const b of BLOCKS) blocks[b] = new RegExp(`\\*\\*${b}\\*\\*`).test(src);
  for (const b of BLOCKS) if (!blocks[b]) errors.push(`missing block "**${b}**"`);

  const booleans = [];
  for (const name of BOOLEANS) {
    const m = new RegExp(`${name.replace(/ /g, '\\s+')}\\s*[—–-]\\s*(.+)`).exec(src);
    if (!m) errors.push(`boolean "${name}" has no evidence line (a blanket all-yes is not a verdict)`);
    else booleans.push({ name, evidence: m[1].trim() });
  }

  const commands = [...new Set([...src.matchAll(/node scripts\/[a-z0-9./-]+\.mjs/g)].map((m) => m[0]))];
  for (const c of commands)
    if (!allow.has(c)) errors.push(`cited command "${c}" is not in the repo-gate allowlist — only CI-workflow gates may be evidence`);

  // Backtick-cited commands: a backtick span that reads like a command (a
  // known command word, or containing a space) must be an allowlisted gate —
  // `rm -rf x` in an evidence line is a citation, not prose.
  const CMD_WORDS = /^(rm|del|curl|wget|bash|sh|powershell|cmd|sudo|chmod|mv|cp|rmdir|npm|npx|git|kill|dd|mkfs)\b/i;
  for (const span of src.matchAll(/`([^`]+)`/g)) {
    const cmd = span[1].trim();
    if (CMD_WORDS.test(cmd) || /\s/.test(cmd)) {
      if (!allow.has(cmd))
        errors.push(`backtick-cited command \`${cmd}\` is not in the repo-gate allowlist — only CI-workflow gates may be evidence`);
    }
  }

  // The fast shape: one line, claim + command + result. Detected when the
  // four blocks are absent; a fast line without a command or result is a
  // named error.
  const fast = /^fast:?\s*.+?\s*[—–-]\s*(node scripts\/[a-z0-9./-]+\.mjs)\s*[—–→>]+\s*\S.*$/m.exec(src);
  const isFast = !BLOCKS.some((b) => blocks[b]) && /^fast:?/m.test(src);
  if (isFast) {
    errors.length = 0; // the four-block errors don't apply to the fast shape
    if (!fast) errors.push('a fast receipt needs claim + an allowlisted command + a result on one line');
    else booleans.push({ name: 'fast receipt', evidence: fast[0].trim() });
  }

  return { blocks, booleans, commands, errors, shape: isFast ? 'fast' : 'full' };
}

/**
 * A claim's status by computation. fresh (age < the window) / stale (age ≥
 * the window) / re-verified (stale, the cited gate re-ran green) /
 * unverifiable (no commands to re-run, or no parseable date).
 */
export function receiptStatus({ claimDate, today = new Date(), commands = [], reRunResult = null }) {
  if (!commands.length) return 'unverifiable';
  const t = claimDate ? Date.parse(`${claimDate}T00:00:00Z`) : NaN;
  if (Number.isNaN(t)) return 'unverifiable';
  const age = Math.floor((today.getTime() - t) / DAY);
  if (age < RECEIPT_STALE_DAYS) return 'fresh';
  if (reRunResult === 0) return 're-verified';
  return 'stale';
}

/** The gate: only fresh and re-verified claims may gate live work. */
export function canGateClaim(status) {
  return status === 'fresh' || status === 're-verified';
}

// ---- the hardened runner (ticket 03) ----
// The stale-probe pattern: NO shell (argv spawn — metacharacters are inert
// args, never syntax), the cited command must be a repo gate, a timeout.
// A command that cannot run (spawn error, timeout, non-zero exit) is a
// FAILING re-run — never a silent pass.

export function runGateCommand(cmd, { cwd = ROOT, timeout = 60000, gates } = {}) {
  const allow = gates || repoGateCommands();
  if (!allow.has(cmd)) throw new Error(`command "${cmd}" is not in the repo-gate allowlist`);
  const [bin, ...rest] = cmd.split(/\s+/);
  const res = spawnSync(bin, rest, { shell: false, cwd, encoding: 'utf8', timeout });
  return res.status === 0 ? 0 : 1;
}

/**
 * Re-verify a claim by RE-RUNNING its cited gates. A fresh claim is not
 * re-run (the audit stays bounded); a stale claim whose gates all pass
 * becomes re-verified; any failure keeps it stale; no commands to re-run
 * is unverifiable.
 */
export function reVerifyClaim({ claimDate, today = new Date(), commands = [] }, opts = {}) {
  if (!commands.length) return { status: 'unverifiable', results: [] };
  const t = claimDate ? Date.parse(`${claimDate}T00:00:00Z`) : NaN;
  if (Number.isNaN(t)) return { status: 'unverifiable', results: [] };
  const age = Math.floor((today.getTime() - t) / DAY);
  if (age < RECEIPT_STALE_DAYS) return { status: 'fresh', results: [] };
  const results = [];
  for (const c of commands) {
    let code;
    try { code = runGateCommand(c, opts); } catch { code = 1; } // refused (not a gate) = a failing re-run
    results.push({ cmd: c, code });
  }
  return { status: results.every((r) => r.code === 0) ? 're-verified' : 'stale', results };
}

// ---- the audit + veto seams (ticket 04/05) ----
// Entries dated on or before GRANDFATHER_THROUGH (the feature's ship date)
// are grandfathered — warns, never hard findings; only entries written
// after it are enforced. A new rule never reddens history.
const GRANDFATHER_THROUGH = '2026-10-14';

export function newestEntry(ledgerText) {
  const parts = String(ledgerText || '').split(/(?=^## \d{4}-\d{2}-\d{2})/m).filter((p) => /^## \d{4}-\d{2}-\d{2}/.test(p));
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  const m = /^## (\d{4}-\d{2}-\d{2})/.exec(last);
  return { date: m[1], text: last };
}

export function auditLedgerReceipts({ ledgerText, today = new Date(), gates }) {
  const findings = [];
  const stale = [];
  let grandfathered = 0;
  const parts = String(ledgerText || '').split(/(?=^## \d{4}-\d{2}-\d{2})/m);
  for (const part of parts) {
    const m = /^## (\d{4}-\d{2}-\d{2})/.exec(part);
    if (!m) continue;
    const date = m[1];
    const v = validateReceipt(part, { gates });
    if (v.errors.length) {
      if (date <= GRANDFATHER_THROUGH) grandfathered++;
      else findings.push({ date, kind: 'receipt-invalid', message: `entry ${date}: ${v.errors[0]}` });
    }
    // Staleness applies to the enforced entries: pre-feature claims are
    // grandfathered (the rule governs entries written after it landed).
    if (date > GRANDFATHER_THROUGH) {
      const st = receiptStatus({ claimDate: date, today, commands: v.commands });
      if (st === 'stale' || st === 'unverifiable') stale.push({ date, status: st });
    }
  }
  const warns = grandfathered > 0
    ? [`${grandfathered} pre-feature ledger entr${grandfathered === 1 ? 'y' : 'ies'} ${grandfathered === 1 ? 'predates' : 'predate'} the enforced receipt shape (grandfathered — warn, never fail)`]
    : [];
  return { findings, warns, stale };
}

/**
 * The veto verdict for a commit: the newest ledger entry must carry a
 * valid receipt AND its claim must be gateable (fresh or re-verified).
 * null = no ledger at all (the existing evidence precondition already
 * denies a commit without a test-run record — the receipt rule adds to
 * it, it does not replace it).
 */
export function vetoVerdict({ ledgerText, today = new Date(), gates }) {
  const e = newestEntry(ledgerText);
  if (!e) return null;
  const v = validateReceipt(e.text, { gates });
  // Grandfather (ticket 04/05): a pre-feature newest entry skips the shape
  // rule — the rule governs entries written after it landed — but the
  // staleness gate still applies (a returning worker re-earns).
  if (e.date > GRANDFATHER_THROUGH && v.errors.length)
    return { allow: false, reason: `the newest ledger entry (${e.date}) has no valid receipt: ${v.errors[0]}` };
  const st = receiptStatus({ claimDate: e.date, today, commands: v.commands });
  if (!canGateClaim(st))
    return { allow: false, reason: `the newest ledger entry's claim is ${st} — re-verify its gates before gating a commit` };
  return { allow: true };
}
