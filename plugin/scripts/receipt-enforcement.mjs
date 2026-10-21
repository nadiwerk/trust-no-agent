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
 * commands must be repo gates (the allowlist is read from the PROJECT tree at
 * call time, so it cannot drift).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

// ---- the repo-gate allowlist (F1, observed live 2026-10-21) ----
// The allowlist must belong to the PROJECT being graded. Reading it from the
// framework's own tree was a silent no-op for every adopter: the published
// payload ships no `.github/`, so the set came back EMPTY, every adopter
// receipt citing `npm test` extracted zero commands, the claim resolved
// `unverifiable`, and the commit veto denied forever — with no reason a human
// could act on. The framework only looked healthy because its own CI happens to
// be written in the one shape the old regex knew (`node scripts/*.mjs`).
//
// Resolution order, most explicit first:
//   1. a ```proof-commands fenced block in the project's AGENTS.md
//   2. the project's .github/workflows/*.yml run steps (generalized parser)
//   3. empty, WITH A REASON — never a silent empty set

/** Gate-runner programs. A line led by anything else is setup, not proof. */
const GATE_PROGRAMS = 'npm|npx|pnpm|yarn|bun|node|deno|tsx|vitest|jest|pytest|python|python3|go|cargo|make|mvn|gradlew|gradle|dotnet|ruby|rake|php|composer|mix|swift|dart|flutter';
const GATE_RUNNER = new RegExp(`^(?:${GATE_PROGRAMS})\\b`);
/** Install/plumbing forms that name a runner but prove nothing. */
const NOT_A_GATE = /^(npm\s+(ci|install|i|add|audit|publish)\b|npm\s+-v\b|yarn\s+(install|add)\b|pnpm\s+(install|i|add)\b|bun\s+(install|add)\b|npx\s+\S+\s+install\b|python3?\s+-m\s+pip\b|node\s+(-e|--eval|-v|--version)\b|go\s+(get|mod)\b|cargo\s+(install|add)\b)/;

/** Strip env assignments and a trailing comment from one shell line. */
function normalizeGateLine(line) {
  let s = String(line || '').trim();
  if (!s || s.startsWith('#')) return '';
  s = s.replace(/\s+#.*$/, '');
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(s)) s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  return s.trim();
}

/** Every command a CI workflow runs: inline `run:` values and block scalars. */
function ciRunLines(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyIndent = m[1].length;
    const value = m[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      // A block scalar: its body is every following line indented past the key.
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line.trim()) continue;
        if (line.match(/^\s*/)[0].length <= keyIndent) break;
        out.push(line);
      }
    } else if (value) {
      out.push(value);
    }
  }
  return out;
}

/** Gates declared in a project's AGENTS.md, or null when it declares none. */
function agentsMdGates(root) {
  const p = join(root, 'AGENTS.md');
  if (!existsSync(p)) return null;
  const m = /```proof-commands[^\n]*\n([\s\S]*?)```/.exec(readFileSync(p, 'utf8'));
  if (!m) return null;
  const gates = m[1].split(/\r?\n/).map(normalizeGateLine).filter(Boolean);
  return gates;
}

/** Gates parsed out of the project's CI workflows (any runner, any shape). */
function ciGates(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return new Set();
  const gates = new Set();
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/i.test(n))) {
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const raw of ciRunLines(text)) {
      for (const part of raw.split(/&&|\|\||;/)) {
        const cmd = normalizeGateLine(part);
        if (!cmd || NOT_A_GATE.test(cmd) || !GATE_RUNNER.test(cmd)) continue;
        gates.add(cmd);
      }
    }
  }
  return gates;
}

/**
 * Resolve the project's gate allowlist, naming where it came from and — when
 * there is nothing — why, so the refusal is actionable instead of silent.
 * @returns {{gates: Set<string>, source: string, reason?: string}}
 */
export function resolveGateCommands({ root = ROOT } = {}) {
  const declared = agentsMdGates(root);
  if (declared && declared.length) {
    return { gates: new Set(declared), source: 'agents-md' };
  }
  if (declared) {
    return {
      gates: new Set(),
      source: 'agents-md-empty',
      reason: `${join(root, 'AGENTS.md')} declares an empty \`proof-commands\` block — a declared-but-empty list is a declaration, not a fallback; fill it in or delete it`,
    };
  }
  const gates = ciGates(root);
  if (gates.size) return { gates, source: 'ci-workflow' };
  return {
    gates: new Set(),
    source: 'none',
    reason: `no proof commands declared in ${join(root, 'AGENTS.md')} (a \`proof-commands\` block) and none found in ${join(root, '.github', 'workflows')} — declare the commands whose output settles a claim before citing one`,
  };
}

/** The repo-gate allowlist for a project root (defaults to this checkout). */
export function repoGateCommands({ root = ROOT } = {}) {
  return resolveGateCommands({ root }).gates;
}

/** True when `cmd` is a gate the project declares. */
function isGate(allow, cmd) {
  return allow.has(cmd);
}

const GATE_RUNNER_SRC = GATE_PROGRAMS;
const RESULT_ARROW = '(?:→|->|=>|\\s—\\s|\\s–\\s)';

/**
 * Commands cited in plain text (not backticked). The receipt shape is
 * `<command> → <result>`, so a citation is a gate runner followed by its
 * arguments up to a result arrow — that boundary is what keeps prose like
 * "npm citation rejected before the parser" from reading as a command.
 */
function plainCitations(src) {
  // The argument span stops at a newline: a citation is a single evidence
  // line, so prose with no arrow cannot borrow the next line's arrow.
  const re = new RegExp(`(?:^|[\\s—–\`])((?:${GATE_RUNNER_SRC})[^\\n→—–,;]+?)\\s*${RESULT_ARROW}`, 'gim');
  const out = new Set();
  for (const m of String(src).matchAll(re)) {
    const cmd = m[1].replace(/[`"'.)\]]+$/, '').trim();
    if (cmd) out.add(cmd);
  }
  return out;
}

/** Every command-shaped citation in a receipt, backticked or plain. */
function extractCommands(src, allow) {
  const cited = new Set();
  for (const span of src.matchAll(/`([^`]+)`/g)) {
    const cmd = span[1].trim();
    if (allow.has(cmd) || GATE_RUNNER.test(cmd)) cited.add(cmd);
  }
  for (const c of plainCitations(src)) cited.add(c);
  return [...cited];
}

/**
 * Validate a receipt's text. Pure in shape: the text and (optionally) the
 * gate set — or the project root to resolve one from — are inputs; returns
 * the parsed shape plus named errors. The full/loop shape is the four blocks
 * with per-boolean evidence under Verdict; the fast shape is one line (claim
 * + command + result).
 */
export function validateReceipt(text, { gates, root } = {}) {
  const src = String(text || '');
  const allow = gates || repoGateCommands({ root });
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

  const commands = extractCommands(src, allow);
  for (const c of commands)
    if (!isGate(allow, c)) errors.push(`cited command "${c}" is not in the repo-gate allowlist — only the project's declared gates may be evidence`);

  // Backtick-cited commands: a backtick span that reads like a command (a
  // known command word, or containing a space) must be an allowlisted gate —
  // `rm -rf x` in an evidence line is a citation, not prose.
  const CMD_WORDS = /^(rm|del|curl|wget|bash|sh|powershell|cmd|sudo|chmod|mv|cp|rmdir|npm|npx|git|kill|dd|mkfs)\b/i;
  for (const span of src.matchAll(/`([^`]+)`/g)) {
    const cmd = span[1].trim();
    if (CMD_WORDS.test(cmd) || /\s/.test(cmd)) {
      if (!isGate(allow, cmd))
        errors.push(`backtick-cited command \`${cmd}\` is not in the repo-gate allowlist — only the project's declared gates may be evidence`);
    }
  }

  // The fast shape: one line, claim + command + result. Detected when the
  // four blocks are absent; a fast line without an allowlisted command or a
  // result is a named error.
  const fast = /^fast:?\s*.+?\s[—–-]\s(.+?)\s[—–→>]+\s*\S.*$/m.exec(src);
  const isFast = !BLOCKS.some((b) => blocks[b]) && /^fast:?/m.test(src);
  if (isFast) {
    errors.length = 0; // the four-block errors don't apply to the fast shape
    const cited = fast ? fast[1].trim().replace(/^`|`$/g, '') : '';
    if (!cited || !isGate(allow, cited))
      errors.push('a fast receipt needs claim + an allowlisted command + a result on one line');
    else booleans.push({ name: 'fast receipt', evidence: fast[0].trim() });
  }

  return { blocks, booleans, commands, errors, shape: isFast ? 'fast' : 'full' };
}

/**
 * A claim's status by computation. fresh (age < the window) / stale (age ≥
 * the window) / re-verified (stale, the cited gate re-ran green) /
 * unverifiable (no commands to re-run, or no parseable date) /
 * future-dated (the claim is dated after today — a ledger defect, never
 * gateable).
 */
export function receiptStatus({ claimDate, today = new Date(), commands = [], reRunResult = null }) {
  if (!commands.length) return 'unverifiable';
  const t = claimDate ? Date.parse(`${claimDate}T00:00:00Z`) : NaN;
  if (Number.isNaN(t)) return 'unverifiable';
  const age = Math.floor((today.getTime() - t) / DAY);
  // A claim dated AFTER today is not a fresh claim — it is a defect. Without
  // this branch `age` is negative, `age < RECEIPT_STALE_DAYS` holds forever,
  // and a typo'd heading becomes an anchor that can never go stale (F6,
  // observed live 2026-10-21 on a ledger heading dated in the future).
  if (age < 0) return 'future-dated';
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
  const allow = gates || repoGateCommands({ root: cwd });
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
  if (age < 0) return { status: 'future-dated', results: [] };
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

/**
 * The anchor entry: the one the veto grades.
 *
 * Two shapes exist in real ledgers. Newer entries carry a `#### Receipt`
 * block; older ones inline the receipt under the session summary. The anchor
 * is therefore: the last `#### Receipt` block when the ledger has one, else
 * the last `## <date>` partition. Either way the date comes from the nearest
 * `## <date>` heading ABOVE the anchor, and the graded text is the anchor
 * onwards — prose written before the receipt is not evidence and is not
 * graded as if it were (F6, observed live 2026-10-21: an entry's summary line
 * cited a command the receipt never claimed, and the validator rejected the
 * whole entry for it).
 *
 * Position, not the date string, decides which entry is newest: the ledger is
 * append-only, so the last entry is the newest by construction. Sorting on the
 * heading text let a future-dated heading win the anchor.
 */
export function newestEntry(ledgerText) {
  const src = String(ledgerText || '');
  const headingAt = (index) => {
    const before = src.slice(0, index);
    const all = [...before.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)];
    return all.length ? all[all.length - 1][1] : null;
  };

  const receipts = [...src.matchAll(/^####\s+Receipt\b/gm)];
  if (receipts.length) {
    const start = receipts[receipts.length - 1].index;
    const date = headingAt(start);
    if (date) return { date, text: src.slice(start) };
  }

  const parts = src.split(/(?=^## \d{4}-\d{2}-\d{2})/m).filter((p) => /^## \d{4}-\d{2}-\d{2}/.test(p));
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  const m = /^## (\d{4}-\d{2}-\d{2})/.exec(last);
  return { date: m[1], text: last };
}

export function auditLedgerReceipts({ ledgerText, today = new Date(), gates, root }) {
  const findings = [];
  const stale = [];
  let grandfathered = 0;
  const allow = gates || repoGateCommands({ root });
  const parts = String(ledgerText || '').split(/(?=^## \d{4}-\d{2}-\d{2})/m);
  for (const part of parts) {
    const m = /^## (\d{4}-\d{2}-\d{2})/.exec(part);
    if (!m) continue;
    const date = m[1];
    const v = validateReceipt(part, { gates: allow });
    if (v.errors.length) {
      if (date <= GRANDFATHER_THROUGH) grandfathered++;
      else findings.push({ date, kind: 'receipt-invalid', message: `entry ${date}: ${v.errors[0]}` });
    }
    // Staleness applies to the enforced entries: pre-feature claims are
    // grandfathered (the rule governs entries written after it landed).
    if (date > GRANDFATHER_THROUGH) {
      const st = receiptStatus({ claimDate: date, today, commands: v.commands });
      // A heading dated after today is a ledger defect, not a staleness fact:
      // reported so the typo is visible and fixed, never silently treated as
      // a fresh claim (F6, 2026-10-21).
      if (st === 'future-dated')
        findings.push({ date, kind: 'future-dated', message: `entry ${date} is dated after today — a future date can never be fresh; fix the heading` });
      else if (st === 'stale' || st === 'unverifiable') stale.push({ date, status: st });
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
export function vetoVerdict({ ledgerText, today = new Date(), gates, root }) {
  const e = newestEntry(ledgerText);
  if (!e) return null;
  // An empty allowlist is not "no gates cited" — it is a project that never
  // declared any, and the refusal must say so. Without this branch the receipt
  // parses as `unverifiable` and the worker is told to "re-verify its gates"
  // for gates that cannot exist (F1, observed live 2026-10-21).
  let allow = gates;
  if (!allow) {
    const resolved = resolveGateCommands({ root });
    if (!resolved.gates.size) return { allow: false, reason: resolved.reason };
    allow = resolved.gates;
  }
  const v = validateReceipt(e.text, { gates: allow });
  // Grandfather (ticket 04/05): a pre-feature newest entry skips the shape
  // rule — the rule governs entries written after it landed — but the
  // staleness gate still applies (a returning worker re-earns).
  if (e.date > GRANDFATHER_THROUGH && v.errors.length)
    return { allow: false, reason: `the newest ledger entry (${e.date}) has no valid receipt: ${v.errors[0]}` };
  const st = receiptStatus({ claimDate: e.date, today, commands: v.commands });
  if (st === 'future-dated')
    return { allow: false, reason: `the newest ledger entry is dated ${e.date}, after today — a future-dated claim is a ledger defect and can never gate a commit` };
  if (!canGateClaim(st))
    return { allow: false, reason: `the newest ledger entry's claim is ${st} — re-verify its gates before gating a commit` };
  return { allow: true };
}
