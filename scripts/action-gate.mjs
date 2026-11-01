#!/usr/bin/env node
/**
 * action-gate — mechanical action-gate over word-punishment.
 * Spec: docs/specs/hardening-general.md (ticket 01-action-gate-core, AC7).
 *
 * Seam: classifyAction({ tool, args, evidence, message }) — a PURE function
 * over a tool call. Returns { gated, reason }. No I/O, no probabilities.
 *
 * The load-bearing design decision: the gate NEVER reads `message`. Words
 * ("done", "selesai", "ship it") cannot close OR open it by construction, so
 * evasion-by-rephrasing buys nothing and humble phrasing excuses nothing.
 * The `message` parameter exists only to document that boundary — callers may
 * pass the surrounding prompt text to prove it was seen and ignored.
 *
 * v1 scope (Constraints: fail-closed is irreversible-only): bash commands
 * matching IRREVERSIBLE_PATTERNS without fresh test evidence
 * (evidence.testPassFresh === true, set by the session's own test run).
 * Ordinary writes/edits stay fail-open. Consumers (ticket 02 plugin veto,
 * ticket 03 audit): this module classifies, it never blocks or logs.
 *
 * Attribution: original implementation. Principle (gate the action, not the
 * word) is the framework's own — docs/specs/hardening-general.md. No external
 * code or assets used.
 */

import { basename, dirname, resolve } from 'node:path';

/**
 * Irreversible-action patterns, matched case-insensitively against bash
 * command text. Literal substrings (not regexes) so the F1 consistency check
 * in action-gate.test.mjs can verify each one appears in a test case.
 */
export const IRREVERSIBLE_PATTERNS = [
  'git commit',
  'git push',
  'npm publish',
  'rm -rf',
];

/**
 * Shell-execution tool names, matched case-insensitively. `bash` is the
 * documented name; `shell` is the LIVE name opencode V2 sends (proven
 * 2026-10-12 by the tna-probe: keys=["tool","sessionID","agent","messageID",
 * "id","input"], tool="shell"); `exec_command` is the LIVE name bb/Codex sessions
 * send (proven 2026-10-24 by failing G-suite: exec_command test runs recorded
 * null while decideBefore gated them); `pwsh`/`powershell` are what a Windows
 * harness sends (audit-run-blockers #13, measured 2026-10-25: `pwsh Set-Content
 * .trust/progress.txt` PASSED while `bash` blocked it — the ledger rule is
 * guarded by `SHELL_TOOLS.has(name)`, so the PowerShell tool never reached it).
 *
 * Since full-enforcement 04/AC7 the set is advisory for CLASSIFICATION: a
 * `command` string matching the irreversible patterns gates under ANY tool name.
 * It is NOT advisory for the ledger rule, which keys on the name — hence the
 * PowerShell entries.
 */
export const SHELL_TOOLS = new Set(['bash', 'shell', 'exec_command', 'pwsh', 'powershell']);

/**
 * The private ledger is append-only by contract (`.trust/progress.txt`).
 * A write/edit targeting it is gated REGARDLESS of evidence: fresh test
 * evidence cannot restore lost history. State files and everything else
 * stay fail-open (the framework itself writes tna-gate-state.json and
 * onboarding.json via non-ledger paths). Matched on a path suffix after
 * backslash normalization, so absolute and relative forms both hit — and
 * a cultivated `notes-on-progress.txt`-style sibling never matches.
 */
export const LEDGER_PATH = '.trust/progress.txt';

/**
 * Bash append semantics (>>) are the CONTRACT for the ledger — additions
 * only. An overwrite/truncate form targeting the ledger file is gated
 * (doubt blocks): Set-Content, redirect-truncate, and similar overwrite
 * commands name the ledger path without an append operator.
 */
const LEDGER_APPEND_SAFE = /(^|\s)>>\s*(?:"[^"]*\.trust[\\/]progress\.txt"|'[^']*\.trust[\\/]progress\.txt'|\.trust[\\/]progress\.txt)(\s|$)/i;
const LEDGER_OVERWRITE_PATTERNS = [
  /\bset-content\b[^|]*\.trust[\\/]progress\.txt/i,
  /\bout-file\b[^|]*\.trust[\\/]progress\.txt/i,
  /(^|\s)>\s*"?\.trust[\\/]progress\.txt/i,
  /\btee\b[^|]*\.trust[\\/]progress\.txt/i,
];

function isLedgerPath(p) {
  const norm = String(p ?? '').replace(/\\/g, '/').toLowerCase();
  return norm === '.trust/progress.txt' || norm.endsWith('/.trust/progress.txt');
}

function matchesAnyCommand(command) {
  return matchAtExecution(command);
}

export { matchesAnyCommand };

/**
 * Text that the shell EXECUTES, as opposed to text that merely mentions a
 * phrase. A pattern counts only at an execution position: the start of a
 * segment (the command string itself, or the text right after `&&`, `||`,
 * `;`, `|`, a newline, or a subshell opener), optionally behind an executing
 * wrapper (`sudo git commit …`). Anything else — a phrase inside a quoted
 * sentence, a heredoc body line, a word after `echo` — is data, and gating it
 * graded shell syntax instead of the action (F4, observed live 2026-10-21).
 *
 * Two things this deliberately does NOT do: recurse into arbitrary quoted
 * arguments (that would re-create the whole-string match), and skip
 * interpreter payloads — `bash -c "git push"` hands the quoted text to a
 * shell, so that one is followed.
 */
const EXEC_WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'doas', 'builtin']);
const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd', 'eval']);

/** Heredoc bodies are data. Drop everything between `<<EOF` and its terminator. */
function stripHeredocBodies(command) {
  const out = [];
  let terminator = null;
  for (const line of String(command ?? '').split(/\r?\n/)) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    out.push(line);
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (m) terminator = m[2];
  }
  return out.join('\n');
}

/** Split into segments at separators the shell acts on, never inside quotes. */
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) current += command[++i];
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '\\' && i + 1 < command.length) { current += ch + command[++i]; continue; }
    if (ch === '\n' || ch === ';' || ch === '(' || ch === '`') { segments.push(current); current = ''; continue; }
    if (ch === '&' && command[i + 1] === '&') { segments.push(current); current = ''; i++; continue; }
    if (ch === '|') { segments.push(current); current = ''; if (command[i + 1] === '|') i++; continue; }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/**
 * git's own global options, which sit BETWEEN the program and the subcommand
 * and therefore launder the match. Measured live 2026-10-25: `git -C . commit
 * --allow-empty` ran a real commit while classifyAction returned gated:false —
 * the first word compared against `git commit` is `git`, so any global option
 * broke the match on EVERY harness at once. The set is git's documented
 * global-option grammar (short forms that take a value: -C -c; long forms that
 * take a value: --git-dir --work-tree --namespace --config-env --exec-path;
 * valueless: --no-pager --bare --literal-pathspecs --no-replace-objects …).
 */
const GIT_GLOBAL_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix']);
const GIT_GLOBAL_BARE_FLAGS = new Set([
  '--no-pager', '--paginate', '-p', '--bare', '--literal-pathspecs', '--glob-pathspecs',
  '--noglob-pathspecs', '--icase-pathspecs', '--no-replace-objects', '--no-optional-locks',
  '--no-lazy-fetch', '--html-path', '--man-path', '--info-path', '--version', '--help',
]);

/**
 * One git global option at `w`, with `next` as the following word.
 * Returns { name, value, consumed } or null when `w` is not a global option.
 *
 * Attached forms are part of git's grammar, not an edge case: `-C.` and
 * `-Crepo` (short flag + value, no space) and `--git-dir=<path>`. Before
 * 2026-11-01 only the `=` form was recognized, so `git -C. commit` fell out of
 * the strip loop at the first word and matched no pattern at all — a real
 * commit that neither the irreversible gate nor the receipt veto saw.
 */
function gitGlobalOption(w, next) {
  if (GIT_GLOBAL_BARE_FLAGS.has(w)) return { name: w, value: null, consumed: 1 };
  if (GIT_GLOBAL_VALUE_FLAGS.has(w)) return { name: w, value: typeof next === 'string' ? next : '', consumed: 2 };
  const eq = w.indexOf('=');
  if (eq > 0 && GIT_GLOBAL_VALUE_FLAGS.has(w.slice(0, eq)))
    return { name: w.slice(0, eq), value: w.slice(eq + 1), consumed: 1 };
  if (w.length > 2 && /^-[A-Za-z]/.test(w) && GIT_GLOBAL_VALUE_FLAGS.has(w.slice(0, 2)))
    return { name: w.slice(0, 2), value: w.slice(2), consumed: 1 };
  return null;
}

/** Drop git global options so the subcommand lands in the head position. */
function stripGitGlobalOptions(words) {
  let i = 0;
  while (i < words.length) {
    const opt = gitGlobalOption(words[i], words[i + 1]);
    if (!opt) break;
    i += opt.consumed;
  }
  return words.slice(i);
}

/** Words of one segment, with quotes consumed — `-C "a b"` is one value. */
function splitWords(segment) {
  const words = [];
  let cur = '';
  let quote = null;
  let has = false;
  // POSIX double quotes keep a backslash LITERAL except before $ ` " \ and a
  // newline — which is what makes a quoted Windows path (`"C:\Users\…"`) the
  // path git actually receives, not a mangled one. Escaping every following
  // character instead is a bash-in-interactive-quotes habit, and it turned
  // every quoted Windows target into a nonexistent directory (measured
  // 2026-11-01: `git -C "C:\…\repo" commit` resolved to nothing).
  const DQ_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote === '"') {
      if (ch === '\\' && i + 1 < segment.length && DQ_ESCAPES.has(segment[i + 1])) { cur += segment[++i]; has = true; continue; }
      if (ch === '"') { quote = null; continue; }
      cur += ch;
      has = true;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") { quote = null; continue; }
      cur += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) { words.push(cur); cur = ''; has = false; } continue; }
    cur += ch;
    has = true;
  }
  if (cur || has) words.push(cur);
  return words;
}

/**
 * The work tree a git invocation ACTS ON, resolved against `cwd`, or null when
 * the command names no target (a plain `git commit` acts on the cwd itself).
 *
 * Origin 2026-11-01, measured live on this framework's own release commit: the
 * receipt veto and the evidence precondition both read from `payload.cwd` —
 * where the shell happened to be — while `git -C <repo> commit` commits in
 * <repo>. From a workspace with a ledger and no AGENTS.md/CI, the commit was
 * refused with "no proof commands declared in <workspace>/AGENTS.md" although
 * the target repo declared 35. The rule keys on the action the shell runs, so
 * the repo under test is the repo that action names. Pure: resolution only,
 * no filesystem access — the caller decides whether the path exists.
 */
export function gitTargetDir(command, cwd = '') {
  const base = String(cwd ?? '');
  if (!base) return null;
  const start = resolve(base);
  // A chain can name its target in shell state rather than in an option:
  // `cd <repo> && git commit`. Observed live 2026-11-01 on this framework's own
  // release commit — the first `cd <repo> && git commit` attempt was refused for
  // the cwd's missing AGENTS.md, the same false deny the `-C` form fixes, reached
  // by a different spelling. `cd` only moves the tracked directory; it is not a
  // git target itself, so a chain ending in some other program still returns null.
  let dir = start;
  // Which git segment to report: the one whose subcommand is a gated action when
  // there is one (that is the action being judged), else the last git segment.
  let gatedTarget = null;
  let lastTarget = null;
  for (const raw of splitSegments(stripHeredocBodies(String(command ?? '')))) {
    const segment = raw.trim().replace(/[)`]+$/, '');
    if (!segment) continue;
    const words = splitWords(segment);
    let i = 0;
    while (i < words.length && EXEC_WRAPPERS.has(words[i].toLowerCase())) {
      i++;
      while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
      while (i < words.length && words[i].startsWith('-')) i++;
    }
    if (i >= words.length) continue;
    const prog = words[i].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
    if (prog === 'cd' || prog === 'pushd') {
      const dest = words[i + 1];
      // `cd` with no argument, `cd -`, or a variable is not a resolvable target.
      if (dest && !dest.startsWith('-') && !dest.startsWith('$')) dir = resolve(dir, dest);
      continue;
    }
    if (prog !== 'git') continue;
    let target = dir;
    let sub = '';
    for (let j = i + 1; j < words.length; ) {
      const opt = gitGlobalOption(words[j], words[j + 1]);
      if (!opt) { if (!sub) sub = words[j].toLowerCase(); break; }
      if (opt.value) {
        if (opt.name === '-C' || opt.name === '--work-tree') target = resolve(target, opt.value);
        else if (opt.name === '--git-dir') {
          // `--git-dir=<repo>/.git` names a git directory; the ledger and the
          // gate allowlist live in the work tree that owns it.
          const p = resolve(target, opt.value);
          target = basename(p) === '.git' ? dirname(p) : p;
        }
      }
      j += opt.consumed;
      if (!sub && j < words.length) sub = words[j].toLowerCase();
    }
    lastTarget = target === start ? null : target;
    const gated = IRREVERSIBLE_PATTERNS.some((p) => sub === String(p).split(' ')[1]);
    if (gated) gatedTarget = lastTarget;
  }
  return gatedTarget ?? lastTarget;
}

function matchAtExecution(command, depth = 0) {
  if (depth > 3) return null;
  for (const raw of splitSegments(stripHeredocBodies(command))) {
    const segment = raw.trim().replace(/[)`]+$/, '');
    if (!segment) continue;
    const words = segment.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && EXEC_WRAPPERS.has(words[i].toLowerCase())) {
      i++;
      while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;  // env assignments
      while (i < words.length && words[i].startsWith('-')) i++;                    // wrapper flags
    }
    if (i >= words.length) continue;
    // A wrapped `git` hides its subcommand behind global options (`-C .`,
    // `--no-pager`, …). Normalize the head so the pattern table sees the
    // subcommand it actually runs.
    const normalized = words[i].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '') === 'git'
      ? [words[i], ...stripGitGlobalOptions(words.slice(i + 1))]
      : words.slice(i);
    const head = normalized.join(' ').toLowerCase();
    for (const p of IRREVERSIBLE_PATTERNS) {
      const needle = String(p).toLowerCase();
      if (head === needle || head.startsWith(`${needle} `)) return p;
    }
    const prog = words[i].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
    if (INTERPRETERS.has(prog)) {
      const payload = /['"]([\s\S]*)['"]/.exec(segment);
      if (payload) {
        const nested = matchAtExecution(payload[1], depth + 1);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/**
 * Classify a tool call against the irreversible-action boundary.
 * @param {object} input
 * @param {string} [input.tool] tool name (case-insensitive, e.g. 'bash'/'Bash')
 * @param {object} [input.args] tool args; bash commands read from args.command
 * @param {object} [input.evidence] session evidence; { testPassFresh: true }
 *   opens the gate for irreversible actions
 * @param {string} [input.message] surrounding prompt text — ACCEPTED AND
 *   IGNORED by design (words never gate)
 * @returns {{gated: boolean, reason: string}}
 */
export function classifyAction({ tool = '', args = {}, evidence = {} } = {}) {
  const name = String(tool ?? '').toLowerCase();
  const command = typeof args?.command === 'string' ? args.command : '';
  const filePath = typeof args?.filePath === 'string' ? args.filePath
    : typeof args?.file_path === 'string' ? args.file_path
    : typeof args?.path === 'string' ? args.path
    : '';
  // Ledger append-only gate (H series): write/edit whose target IS the
  // private ledger is gated before any evidence check — fresh test evidence
  // cannot restore overwritten history. The contract's allowed form is the
  // bash append (>>), which stays fail-open (H5).
  const writesLedger = ['write', 'edit'].includes(name) && filePath && isLedgerPath(filePath);
  if (writesLedger) {
    return { gated: true, reason: `the private ledger (${LEDGER_PATH}) is append-only — a ${name} overwrites it and is vetoed (ledger-overwrite incident 2026-10-18); append via bash >> or a staging file instead` };
  }
  // Bash overwrite/truncate forms naming the ledger path are gated (doubt
  // blocks, same AC7 principle as unknown-shell). Append (>>) stays open.
  //
  // NAMING the ledger is not overwriting it: the gate keys on a matched WRITE
  // form, never on the absence of `>>`. Keying on `!command.includes('>>')`
  // vetoed every read-only audit command (`wc -l .trust/progress.txt`, a
  // validator run, `grep -n` over the headings) — i.e. exactly the activity
  // this framework exists to encourage (F5, observed live 2026-10-21).
  if (SHELL_TOOLS.has(name) && command && /\.trust[\\/]progress\.txt/i.test(command) && !LEDGER_APPEND_SAFE.test(command)) {
    const overwriting = LEDGER_OVERWRITE_PATTERNS.some((r) => r.test(command));
    if (overwriting) {
      return { gated: true, reason: `a shell command overwriting the private ledger (${LEDGER_PATH}) is vetoed — the ledger is append-only; use >> to append (ledger-overwrite incident 2026-10-18)` };
    }
  }
  const hit = command ? matchesAnyCommand(command) : null;
  if (hit) {
    const via = SHELL_TOOLS.has(name) ? name : `${name || '(unnamed tool)'} (unknown shell name)`;
    if (evidence?.testPassFresh === true)
      return { gated: false, reason: `irreversible action (${hit}) via ${via} with fresh test evidence — gate open` };
    return { gated: true, reason: `irreversible action (${hit}) via ${via} without fresh test evidence — sign-off plus a fresh test pass required (docs/specs/hardening-general.md AC1)` };
  }
  return { gated: false, reason: 'no irreversible action in this tool call — gate open (words alone never gate)' };
}
