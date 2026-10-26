// tna-veto.ts — trust-no-agent veto extension for pi (.pi/extensions).
//
// Posture: FAIL-CLOSED for irreversible shell actions without fresh test
// evidence; everything else passes untouched.
//
// This file is SELF-CONTAINED on purpose: onboarding copies it to
// .pi/extensions/tna-veto.ts, where the framework's scripts/ tree does not
// exist. The classification grammar and the test-run matcher are therefore
// duplicated from scripts/action-gate.mjs + scripts/tna-gate.mjs — and
// scripts/veto-adapter.test.mjs pins the parity mechanically (N series), so
// the copy cannot silently drift from the canonical gate again.
//
// Pi contract: pi.on("tool_call", handler) returning
//   { block?: boolean; reason?: string }
// First block stops dispatch; reason becomes the tool error text.
//
// Three holes closed 2026-10-25, each measured live before the fix:
//
//   1. TOOL COVERAGE. The guard used to return early unless toolName was
//      exactly "bash". Pi declares a `powershell` tool with the same
//      `{ command }` input (PowerShellToolCallEvent), so on Windows the same
//      irreversible action through the other shell was never examined.
//   2. GIT GLOBAL OPTIONS. A substring test for the literal "git commit"
//      missed `git -C . commit --allow-empty`, which ran a real commit
//      (7aa82a7). git's global options sit between the program and the
//      subcommand, so they are stripped before matching.
//   3. NO RECORDER. Nothing wrote .trust/tna-gate-state.json, so the gate
//      could never OPEN: a green test run was ignored and every commit stayed
//      refused forever ("Project state: (missing)"). A veto that cannot open
//      is a wall, and a wall teaches the operator to bypass it.
//
// Evidence semantics (mirrors scripts/tna-gate.mjs observeAfter):
//   a shell test run that exits clean  -> testPassFresh true
//   one that errors                    -> testPassFresh false (explicitly: a
//                                         stale true after a red run is the hole)
//   anything else                      -> nothing recorded, nothing touched

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const IRREVERSIBLE_PATTERNS = ["git commit", "git push", "npm publish", "rm -rf"];

/** Shell-execution tool names across harnesses (case-insensitive). */
const SHELL_TOOLS = new Set(["bash", "powershell", "pwsh", "shell", "exec_command"]);

/** git's documented global options: they sit between `git` and the subcommand. */
const GIT_GLOBAL_VALUE_FLAGS = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path", "--super-prefix",
]);
const GIT_GLOBAL_BARE_FLAGS = new Set([
  "--no-pager", "--paginate", "-p", "--bare", "--literal-pathspecs", "--glob-pathspecs",
  "--noglob-pathspecs", "--icase-pathspecs", "--no-replace-objects", "--no-optional-locks",
  "--no-lazy-fetch", "--html-path", "--man-path", "--info-path", "--version", "--help",
]);

/**
 * Same boundary as scripts/tna-gate.mjs TEST_RUN, but matched at an EXECUTION
 * POSITION rather than anchored at the string start.
 *
 * Origin 2026-10-25 (upstream report `tna-pi-recorder-bugreport.md`, measured
 * with its own repro): the old matcher was `/^\s*(node|bun)\s+.../`, so any
 * prefix defeated the RECORDER while the VETO side — which tokenises — kept
 * firing. In a BB thread the session cwd is the workspace root, so
 * `cd <repo> && node x.test.mjs` is the only shape the agent can use: the run
 * printed ALL PASS, recorded nothing, and the commit stayed vetoed forever with
 * `Project state: (missing)`. A veto that cannot open is a wall.
 *
 * The matcher now runs per segment (see `segments()`), which makes recorder and
 * veto share one tokenisation instead of keeping parity as a convention.
 */
const TEST_RUNNER = String.raw`(node|bun)\s+[^\s]*\.test\.(mjs|js|ts|cjs|mts)`;

/** Runner families that are recognisably a TEST, matched at a segment head. */
const TEST_RUN = new RegExp(
  String.raw`^\s*(`
  + TEST_RUNNER
  + String.raw`|(npm|pnpm|yarn)\s+(run\s+)?test(:[\w.:-]+)?`
  + String.raw`|(npx\s+|pnpm\s+|yarn\s+)?(vitest|jest)(\s|$)`
  + String.raw`|(python\s+-m\s+)?pytest(\s|$)`
  + String.raw`|cargo\s+test(\s|$)|go\s+test(\s|$)`
  + String.raw`|(bun|deno)\s+test(\s|$)`
  + String.raw`)`,
);

/**
 * Heredoc bodies are DATA. Drop everything between `<<EOF` and its terminator
 * before any segment splitting — the same rule the canonical gate applies
 * (scripts/action-gate.mjs stripHeredocBodies).
 *
 * Origin 2026-10-25: the body was split on newlines and matched as if executed,
 * so writing a document that merely MENTIONS a command was vetoed — it happened
 * twice while the report above was being written, including to the command
 * writing the report's own repro script.
 */
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
function segments(command) {
  const text = stripHeredocBodies(command);
  const out = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < text.length) current += text[++i];
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '\\' && i + 1 < text.length) { current += ch + text[++i]; continue; }
    if (ch === '\n' || ch === ';' || ch === '(' || ch === '`') { out.push(current); current = ''; continue; }
    if (ch === '&' && text[i + 1] === '&') { out.push(current); current = ''; i++; continue; }
    if (ch === '|') { out.push(current); current = ''; if (text[i + 1] === '|') i++; continue; }
    current += ch;
  }
  out.push(current);
  return out;
}

/**
 * Did this command run a test suite? True only when a TEST runner sits at a
 * segment head — a mention inside a commit message, an `echo`, or a heredoc
 * body records nothing.
 *
 * Deliberate exclusion: a bare `node deploy.mjs` does NOT count. Covering every
 * node script would let any script open the gate, which makes the gate
 * meaningless — the runner has to be recognisable as a test.
 */
export function recordedTestRun(command) {
  const text = String(command ?? '');
  // A prefix that only changes directory still runs the test in that directory.
  for (const raw of segments(text)) {
    if (TEST_RUN.test(raw.trim())) return true;
  }
  return false;
}


/**
 * The private ledger is append-only by contract (.trust/progress.txt). A
 * write/edit whose target IS that file is refused REGARDLESS of evidence:
 * fresh test evidence cannot restore overwritten history (ledger-overwrite
 * incident 2026-10-18; it happened for real on 2026-10-25 as a UTF-16
 * corruption). Matched on a path suffix after backslash normalization, so an
 * absolute path and a relative one both hit, and a `notes-on-progress.txt`
 * sibling never does.
 */
const LEDGER_SUFFIX = '.trust/progress.txt';

function isLedgerPath(p) {
  const norm = String(p ?? '').replace(/\\/g, '/').toLowerCase();
  return norm === LEDGER_SUFFIX || norm.endsWith(`/${LEDGER_SUFFIX}`);
}

/** Write-shaped tools across harnesses. */
const WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'apply_patch']);

/**
 * Tools that RUN CODE without a `command` field (2026-10-25, enumerated from
 * the installed package rather than assumed: omp's BUILTIN_TOOL_NAMES includes
 * `eval`, a JS/Python cell with Bun.$ / subprocess and `approval: "exec"`).
 * The classifier runs over the cell's code — a cell that only computes is not
 * an irreversible action, so the tool is never blocked outright.
 */
const CODE_TOOLS = new Set(['eval', 'codemode', 'run_code']);

/** Tools whose PAYLOAD IS AN INSTRUCTION a child agent will execute. */
const DELEGATION_TOOLS = new Set(['task', 'subagent', 'workflow', 'ralph']);

/** Fields that carry the payload of a code/delegation tool. */
function payloadText(input) {
  for (const key of ['code', 'script', 'objective', 'prompt', 'task', 'instructions']) {
    if (typeof input?.[key] === 'string') return input[key];
  }
  return '';
}

/**
 * Extract command-looking substrings from code: backticked commands, quoted
 * commands, and string-array argv forms (`["git", "commit", "-m", "x"]`).
 * Returns [] when the code carries no command shape at all.
 */
function commandsInCode(code) {
  const text = String(code ?? '');
  const out = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  for (const m of text.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) out.push(m[1] ?? m[2]);
  for (const m of text.matchAll(/\[((?:\s*(?:"[^"]*"|'[^']*')\s*,?)+)\]/g)) {
    out.push(m[1].replace(/["',]/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return out;
}

/**
 * Pattern match ANYWHERE in a text (word-boundary, whitespace-tolerant).
 *
 * Used for delegation payloads only. The boundary is defensible there because
 * the payload is an INSTRUCTION a child agent executes — the words ARE the
 * action. For shell prose the execution-position classifier is used instead
 * (words alone never gate).
 */
function classifyAnywhere(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ');
  for (const pattern of IRREVERSIBLE_PATTERNS) {
    const re = new RegExp(`(^|[^\\w-])${pattern.replace(/\s+/g, '\\s+')}(\\s|$)`, 'i');
    if (re.test(flat)) return { irreversible: true, pattern };
  }
  return { irreversible: false, pattern: null };
}


function writtenPath(input) {
  return input?.path ?? input?.filePath ?? input?.file_path ?? '';
}

/** Drop git global options so the subcommand lands in the head position. */
function stripGitGlobalOptions(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const name = w.includes("=") ? w.slice(0, w.indexOf("=")) : w;
    if (GIT_GLOBAL_VALUE_FLAGS.has(name)) {
      i += w.includes("=") || w.length > name.length ? 1 : 2;
      continue;
    }
    if (GIT_GLOBAL_BARE_FLAGS.has(name)) { i += 1; continue; }
    break;
  }
  return words.slice(i);
}

/**
 * Commands that EXECUTE their arguments, and shells whose quoted payload is
 * itself a command line. Ported from scripts/action-gate.mjs.
 *
 * Origin 2026-10-25 (audit-run-blockers #10, measured): pi missed 3 of 7 wrapper
 * shapes the canonical gate blocks — `sudo git commit`, `bash -c "git commit"`,
 * `sh -c "git push"` — because only the first word of a segment was examined.
 */
const EXEC_WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'doas', 'builtin']);
const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd', 'eval']);

/** sudo flags that consume the NEXT word as their value (`sudo -u root …`). */
const WRAPPER_VALUE_FLAGS = new Set(['-u', '-g', '-p', '-C', '-h', '-r', '-t', '-U', '-D', '--user', '--group', '--prompt', '--close-from', '--host', '--role', '--type', '--other-user', '--chdir']);

/**
 * Execution-position matcher (prose that merely names an action never gates).
 * Runs on the SAME segmenter as the recorder: one tokenisation, so parity is a
 * fact rather than a convention (origin 2026-10-25 — the two sides drifted and
 * the recorder silently stopped matching what the veto still caught).
 */
export function classifyCommand(command, depth = 0) {
  if (depth > 3) return { irreversible: false, pattern: null };
  for (const raw of segments(command)) {
    const words = raw.trim().replace(/[)`]+$/, "").split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Skip exec wrappers, their flags (and a flag's VALUE), and VAR=value.
    let i = 0;
    while (i < words.length && EXEC_WRAPPERS.has(words[i].toLowerCase())) {
      const wrapper = words[i].toLowerCase();
      i++;
      while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
      while (i < words.length && words[i].startsWith('-')) {
        const flag = words[i];
        i++;
        if (wrapper === 'sudo' && WRAPPER_VALUE_FLAGS.has(flag)) i++;
      }
    }
    if (i >= words.length) continue;

    const program = words[i].toLowerCase().replace(/^.*[\\/]/, "").replace(/\.exe$/, "");
    const head = program === "git"
      ? [words[i], ...stripGitGlobalOptions(words.slice(i + 1))]
      : words.slice(i);
    const joined = head.join(" ").toLowerCase();
    for (const pattern of IRREVERSIBLE_PATTERNS) {
      if (joined === pattern || joined.startsWith(`${pattern} `)) {
        return { irreversible: true, pattern };
      }
    }

    // `bash -c "git commit"`: the quoted payload is a command line, so follow it.
    if (INTERPRETERS.has(program)) {
      const payload = /['"]([\s\S]*)['"]/.exec(raw);
      if (payload) {
        const nested = classifyCommand(payload[1], depth + 1);
        if (nested.irreversible) return nested;
      }
    }
  }
  return { irreversible: false, pattern: null };
}

/**
 * How long a green test run counts as evidence — ONE definition across adapters.
 *
 * Origin 2026-10-25 (audit-run-blockers #3, measured): `recordEvidence` wrote
 * `updatedAt` and nothing ever read it, so a 2020 state still opened the gate.
 */
const EVIDENCE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Append semantics (`>>`) are the ledger CONTRACT. Any other write form naming
 * the ledger is an overwrite.
 *
 * Origin 2026-10-25 (audit-run-blockers #13, measured): the ledger check lived
 * ONLY in the WRITE_TOOLS branch, so `> .trust/progress.txt`, `Set-Content`,
 * `Out-File` and `| tee` from bash/pwsh overwrote the private history
 * unchallenged — the one rule fresh evidence can never restore.
 */
const LEDGER_APPEND_SAFE = /(^|\s)>>\s*(?:"[^"]*\.trust[\\/]progress\.txt"|'[^']*\.trust[\\/]progress\.txt'|\.trust[\\/]progress\.txt)(\s|$)/i;
const LEDGER_OVERWRITE_PATTERNS = [
  /\bset-content\b[^|]*\.trust[\\/]progress\.txt/i,
  /\bout-file\b[^|]*\.trust[\\/]progress\.txt/i,
  /(^|\s)>\s*"?\.trust[\\/]progress\.txt/i,
  /\btee\b[^|]*\.trust[\\/]progress\.txt/i,
];

function shellOverwritesLedger(command) {
  const text = String(command ?? "");
  if (!/\.trust[\\/]progress\.txt/i.test(text)) return false;
  if (LEDGER_APPEND_SAFE.test(text)) return false;
  return LEDGER_OVERWRITE_PATTERNS.some((re) => re.test(text));
}

/**
 * Append one denial to `.trust/tna-gate-log.jsonl` — the log the meter reads.
 *
 * Origin 2026-10-25 (audit-run-blockers #13b, measured): only gate-hook.mjs wrote
 * this file, so a pi denial left no trace and doctor reported "veto fires: no
 * data yet" while the veto worked. Line shape mirrors `logVeto` in
 * scripts/tna-gate.mjs so `parseVetoLog` counts it.
 */
function logVeto(cwd, { tool = "", command = "" } = {}) {
  try {
    mkdirSync(join(cwd, ".trust"), { recursive: true });
    appendFileSync(
      join(cwd, ".trust", "tna-gate-log.jsonl"),
      `${JSON.stringify({ ts: new Date().toISOString(), harness: "pi", tool, command })}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

function statePath(cwd) {
  return join(cwd, ".trust", "tna-gate-state.json");
}

function readEvidence(cwd) {
  try {
    const state = JSON.parse(readFileSync(statePath(cwd), "utf8"));
    if (state.testPassFresh !== true) return { testPassFresh: false, statePath: statePath(cwd) };
    const age = Date.now() - Date.parse(state.updatedAt ?? "");
    if (!Number.isFinite(age) || age < 0 || age > EVIDENCE_MAX_AGE_MS) {
      return { testPassFresh: false, statePath: statePath(cwd), stale: true };
    }
    return { testPassFresh: true, statePath: statePath(cwd) };
  } catch {
    return { testPassFresh: false, statePath: "(missing)" };
  }
}

/** Record a finished test run. A write failure is never fatal: the veto must
 *  keep working (fail-closed) even when evidence cannot be persisted. */
function recordEvidence(cwd, { command, pass }) {
  try {
    mkdirSync(join(cwd, ".trust"), { recursive: true });
    writeFileSync(
      statePath(cwd),
      `${JSON.stringify({ testPassFresh: pass, command, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

function resolveCwd(event, ctx) {
  return event?.cwd || ctx?.cwd || process.cwd();
}

/**
 * Classify a non-shell payload: code tools by their embedded commands (an eval
 * cell that merely computes is NOT an action), delegation tools by instruction
 * text (the words ARE the action a child will execute).
 */
function classifyPayload(toolName, input) {
  if (CODE_TOOLS.has(toolName)) {
    for (const candidate of commandsInCode(payloadText(input))) {
      const hit = classifyCommand(candidate);
      if (hit.irreversible) return hit;
    }
    return { irreversible: false, pattern: null };
  }
  if (DELEGATION_TOOLS.has(toolName)) return classifyAnywhere(payloadText(input));
  return { irreversible: false, pattern: null };
}

/**
 * Did the finished shell call exit ZERO? true / false / null (null = UNKNOWN).
 *
 * Origin 2026-10-25 (audit-run-blockers #2, measured): the recorder read
 * `isError !== true`, which is true for `false`, `undefined`, and a MISSING key —
 * so a red run whose harness omitted the flag recorded `testPassFresh: true` and
 * the commit was allowed. The canonical contract is explicit: "`pass` must be an
 * explicit boolean — an unknown outcome records nothing (a guessed pass is the
 * forgery hole again)".
 *
 * Signals are read in this order, first decisive one wins:
 *   1. an explicit numeric `exitCode` / `exit` / `code`;
 *   2. an `[exit code: N]` marker in the result TEXT (harnesses that report the
 *      exit status in prose rather than a field — measured: the audit probe sends
 *      `isError: false` plus `[exit code: 1]`, and a recorder that trusted only
 *      `isError` certified the red run);
 *   3. `isError` when it is a real boolean.
 * Nothing else counts: no signal at all is UNKNOWN, never a pass.
 */
function runPassed(event) {
  const explicit = [event?.exitCode, event?.exit, event?.code]
    .find((v) => typeof v === "number" && Number.isFinite(v));
  if (typeof explicit === "number") return explicit === 0;

  const text = Array.isArray(event?.content)
    ? event.content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
    : (typeof event?.output === "string" ? event.output : "");
  const marker = /\[exit code: (-?\d+)\]/.exec(text);
  if (marker) return Number(marker[1]) === 0;

  if (typeof event?.isError === "boolean") return event.isError === false;
  return null;
}

export default function tnaVeto(pi) {
  pi.on("tool_call", async (event, ctx) => {
    const toolName = String(event?.toolName ?? "").toLowerCase();

    // Ledger append-only gate: checked before evidence, for every write tool.
    if (WRITE_TOOLS.has(toolName) && isLedgerPath(writtenPath(event?.input))) {
      logVeto(resolveCwd(event, ctx), { tool: toolName, command: String(writtenPath(event?.input) ?? "") });
      return {
        block: true,
        reason: `tna-gate veto: the private ledger (.trust/progress.txt) is append-only — a ${toolName} overwrites it (ledger-overwrite incident 2026-10-18); append via a shell >> or a staging file instead`,
      };
    }

    if (SHELL_TOOLS.has(toolName)) {
      const command = String(event.input?.command ?? "");

      // Ledger append-only gate on the SHELL path (#13): redirect, Set-Content,
      // Out-File and tee are overwrites; `>>` is the contract.
      if (shellOverwritesLedger(command)) {
        logVeto(resolveCwd(event, ctx), { tool: toolName, command });
        return {
          block: true,
          reason: `tna-gate veto: a shell command overwrites the private ledger (.trust/progress.txt) — the ledger is append-only; use >> to append (ledger-overwrite incident 2026-10-18)`,
        };
      }

      const { irreversible, pattern } = classifyCommand(command);
      if (!irreversible) return;
      // cwd resolution (origin: omp deny-path report 2026-10-18): read the state
      // from the PROJECT the command runs in, never from a parent directory's
      // stale state file.
      const cwd = resolveCwd(event, ctx);
      const evidence = readEvidence(cwd);
      if (evidence.testPassFresh) return; // fresh evidence: allow

      logVeto(cwd, { tool: toolName, command });
      return {
        block: true,
        reason: `tna-gate veto: "${pattern}" is irreversible and this session has no fresh test evidence (run the project's tests first, then retry). Project state: ${evidence.stale ? `${evidence.statePath} (stale — older than 30 minutes)` : evidence.statePath}`,
      };
    }

    // Code and delegation tools (2026-10-25): a `git commit` inside an eval cell
    // or handed to a child agent never passes through `command`, so the shell
    // guard alone left both paths open. Same boundary, same evidence gate —
    // only the extraction differs.
    const hit = classifyPayload(toolName, event?.input);
    if (!hit.irreversible) return;
    const cwd = resolveCwd(event, ctx);
    const evidence = readEvidence(cwd);
    if (evidence.testPassFresh) return;
    logVeto(cwd, { tool: toolName, command: payloadText(event?.input) });
    return {
      block: true,
      reason: `tna-gate veto: a ${toolName} payload runs "${hit.pattern}" — irreversible without fresh test evidence (run the project's tests first, then retry). Project state: ${evidence.statePath}`,
    };
  });

  // The recorder. Without it the gate has no way to open — see hole 3 above.
  pi.on("tool_result", async (event, ctx) => {
    const toolName = String(event?.toolName ?? "").toLowerCase();
    // A test run inside an eval cell is evidence too: the boundary is the
    // command that ran, not the tool that carried it.
    const commands = SHELL_TOOLS.has(toolName)
      ? [String(event?.input?.command ?? "")]
      : (CODE_TOOLS.has(toolName) ? commandsInCode(payloadText(event?.input)) : []);
    for (const command of commands) {
      if (!recordedTestRun(command)) continue;
      // Read the exit signal, and treat "unknown" as unknown.
      //
      // Origin 2026-10-25 (audit-run-blockers #2, measured): `event?.isError !==
      // true` is true for `false`, `undefined`, and a MISSING key — so a red run
      // whose harness omitted the flag recorded `testPassFresh: true` and the
      // commit was allowed. The canonical contract: an unknown outcome records
      // nothing (a guessed pass is the forgery hole again).
      const pass = runPassed(event);
      if (pass === null) return;
      recordEvidence(resolveCwd(event, ctx), { command, pass });
      return;
    }
  });
}
