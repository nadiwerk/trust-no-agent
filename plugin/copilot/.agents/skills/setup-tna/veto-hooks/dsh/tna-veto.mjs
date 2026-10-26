// tna-veto.mjs — trust-no-agent veto plugin for DeepSeek Harness (dsh).
//
// Posture: FAIL-CLOSED for irreversible shell actions without fresh test
// evidence; everything else passes untouched.
//
// WHY THIS FILE EXISTS
// --------------------
// dsh has no hook JSON file and no `tool_call` event like pi/omp. Its
// documented extension point is a cordis service waterfall, quoted verbatim
// from @deepseek-ai/dsh-tools:
//
//   'tools/pre-execute'(exec, next) -> PreToolDecision
//     "Allow, deny, cancel, or ask before dispatch. `next()` delegates to
//      allow; `cancel` selects the canonical pre-dispatch cancellation result,
//      and missing approval support turns `ask` into denial."
//
//   PreToolDecision = { kind:'allow' } | { kind:'deny', reason } | ...
//
// So the veto lands as a deny decision, and the evidence recorder as an
// observer on `tools/result` ("Observe the frozen, lossless-JSON final
// outcome. Listener failures are contained.").
//
// INSTALLED AS A PROFILE PLUGIN. The dsh profile loads it by path from
// ~/.dsh/profiles/<profile>/cordis.patch.yml, so this file is self-contained
// (no imports from the framework tree, which does not exist beside an
// installed profile). The classification grammar and the test-run matcher are
// duplicated from scripts/action-gate.mjs + scripts/tna-gate.mjs, and
// scripts/dsh-veto.test.mjs pins the parity mechanically (S series).
//
// The same three holes the pi/omp adapters carried were closed here from the
// start, because they were measured live 2026-10-25:
//   1. shell-tool coverage (dsh declares BOTH `bash` and `pwsh`)
//   2. git global options laundering the subcommand (`git -C . commit …`)
//   3. no recorder — a veto that can never OPEN is a wall, not a gate

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'tna-veto';

/** dsh resolves cwd through this service; the plugin only reads it. */
export const inject = ['tools'];

const IRREVERSIBLE_PATTERNS = ['git commit', 'git push', 'npm publish', 'rm -rf'];

/** dsh shell tools: `bash` and, on Windows, `pwsh` (both carry `command`). */
const SHELL_TOOLS = new Set(['bash', 'pwsh', 'powershell', 'shell', 'exec_command']);

/**
 * dsh tools that RUN whatever is typed into them. `terminal_send` drives a
 * persistent shell session (the command is in `text`), so it is a shell surface
 * even though it carries no `command` field.
 *
 * Origin 2026-10-25 (dsh fix-list #9, measured): `terminal_send` with
 * `text: 'git commit -m x'` was allowed — the veto never looked at it. Not
 * classified as irreversible by itself: `terminal_open` only allocates a
 * session, and `job_kill` only signals a process (documented, not gated).
 */
const TERMINAL_TOOLS = new Set(['terminal_send']);

/** git's documented global options: they sit between `git` and the subcommand. */
const GIT_GLOBAL_VALUE_FLAGS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix',
]);
const GIT_GLOBAL_BARE_FLAGS = new Set([
  '--no-pager', '--paginate', '-p', '--bare', '--literal-pathspecs', '--glob-pathspecs',
  '--noglob-pathspecs', '--icase-pathspecs', '--no-replace-objects', '--no-optional-locks',
  '--no-lazy-fetch', '--html-path', '--man-path', '--info-path', '--version', '--help',
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
  for (const raw of segments(String(command ?? ''))) {
    if (TEST_RUN.test(raw.trim())) return true;
  }
  return false;
}

/**
 * The private ledger is append-only by contract (.trust/progress.txt). A
 * write/edit whose target IS that file is refused REGARDLESS of evidence:
 * fresh test evidence cannot restore overwritten history (ledger-overwrite
 * incident 2026-10-18; it happened for real on 2026-10-25 as a UTF-16
 * corruption). Matched on a path suffix after backslash normalization.
 */
const LEDGER_SUFFIX = '.trust/progress.txt';

function isLedgerPath(p) {
  const norm = String(p ?? '').replace(/\\/g, '/').toLowerCase();
  return norm === LEDGER_SUFFIX || norm.endsWith(`/${LEDGER_SUFFIX}`);
}

/**
 * Append semantics (`>>`) are the ledger CONTRACT — additions only. Any other
 * form that names the ledger and writes it is an overwrite.
 *
 * Origin 2026-10-25 (dsh fix-list #5, measured): the ledger check lived ONLY in
 * the WRITE_TOOLS branch, so `> .trust/progress.txt`, `Set-Content`, `Out-File`
 * and `| tee` from bash/pwsh overwrote the private history unchallenged. The
 * canonical gate (scripts/action-gate.mjs) has drawn this boundary since the
 * 2026-10-18 incident; the dsh adapter had not.
 */
const LEDGER_APPEND_SAFE = /(^|\s)>>\s*(?:"[^"]*\.trust[\\/]progress\.txt"|'[^']*\.trust[\\/]progress\.txt'|\.trust[\\/]progress\.txt)(\s|$)/i;
const LEDGER_OVERWRITE_PATTERNS = [
  /\bset-content\b[^|]*\.trust[\\/]progress\.txt/i,
  /\bout-file\b[^|]*\.trust[\\/]progress\.txt/i,
  /(^|\s)>\s*"?\.trust[\\/]progress\.txt/i,
  /\btee\b[^|]*\.trust[\\/]progress\.txt/i,
];

/** True when a shell command names the ledger in a WRITE form (append stays open). */
function shellOverwritesLedger(command) {
  const text = String(command ?? '');
  if (!/\.trust[\\/]progress\.txt/i.test(text)) return false;
  if (LEDGER_APPEND_SAFE.test(text)) return false;
  return LEDGER_OVERWRITE_PATTERNS.some((re) => re.test(text));
}

/** dsh's write-shaped tools. */
const WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'apply_patch']);

/**
 * dsh tools that RUN CODE without a `command` field (2026-10-25, enumerated from
 * the installed packages: @deepseek-ai/dsh-tool-{ralph,workflow,subagent} all
 * spawn child agents that can themselves run shell). A `git commit` inside a
 * workflow script never passes through `command`, so the shell guard alone left
 * that path open.
 */
const DELEGATION_TOOLS = new Set(['subagent', 'workflow', 'ralph']);
const CODE_TOOLS = new Set(['run_code']);

/** Fields that carry the payload of a delegation/code tool. */
function payloadOf(exec) {
  const args = exec?.arguments ?? exec?.args;
  for (const key of ['script', 'objective', 'prompt', 'task', 'instructions', 'code']) {
    if (typeof args?.[key] === 'string') return args[key];
  }
  return '';
}

/** Command-looking substrings from code: backticked, quoted, and argv arrays. */
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
 * Pattern match ANYWHERE in an instruction (delegation payloads only): the
 * payload IS the action a child agent will execute. Shell prose keeps the
 * stricter execution-position classifier — words alone never gate.
 */
function classifyAnywhere(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ');
  for (const pattern of IRREVERSIBLE_PATTERNS) {
    const re = new RegExp(`(^|[^\\w-])${pattern.replace(/\s+/g, '\\s+')}(\\s|$)`, 'i');
    if (re.test(flat)) return { irreversible: true, pattern };
  }
  return { irreversible: false, pattern: null };
}

function classifyPayload(toolName, exec) {
  const payload = payloadOf(exec);
  if (!payload) return { irreversible: false, pattern: null };
  if (DELEGATION_TOOLS.has(toolName)) return classifyAnywhere(payload);
  if (CODE_TOOLS.has(toolName)) {
    for (const candidate of commandsInCode(payload)) {
      const hit = classifyCommand(candidate);
      if (hit.irreversible) return hit;
    }
  }
  return { irreversible: false, pattern: null };
}


/** Drop git global options so the subcommand lands in the head position. */
function stripGitGlobalOptions(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const flagName = w.includes('=') ? w.slice(0, w.indexOf('=')) : w;
    if (GIT_GLOBAL_VALUE_FLAGS.has(flagName)) {
      i += w.includes('=') || w.length > flagName.length ? 1 : 2;
      continue;
    }
    if (GIT_GLOBAL_BARE_FLAGS.has(flagName)) { i += 1; continue; }
    break;
  }
  return words.slice(i);
}

/**
 * Commands that EXECUTE their arguments. Skipped before the head is decided, so
 * `sudo git commit` and `env GIT_AUTHOR_NAME=x git commit` are judged by what
 * they actually run.
 *
 * Origin 2026-10-25 (dsh fix-list #4, measured): `classifyCommand` only looked
 * at the first word, so `sudo` became the head and the action behind it was
 * never examined. Ported from scripts/action-gate.mjs, which has had these two
 * tables since the F4 finding.
 */
const EXEC_WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'doas', 'builtin']);

/** Shells whose quoted payload is itself a command line. */
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
    const words = raw.trim().replace(/[)`]+$/, '').split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Skip exec wrappers, their flags (and a flag's VALUE, e.g. `sudo -u root`),
    // and leading VAR=value assignments.
    let i = 0;
    while (i < words.length && EXEC_WRAPPERS.has(words[i].toLowerCase())) {
      const wrapper = words[i].toLowerCase();
      i++;
      while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
      while (i < words.length && words[i].startsWith('-')) {
        const flag = words[i];
        i++;
        // `-u root` / `--user root` take a value; `-n` / `--preserve-env` do not.
        if (wrapper === 'sudo' && WRAPPER_VALUE_FLAGS.has(flag)) i++;
      }
    }
    if (i >= words.length) continue;

    const program = words[i].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
    const head = program === 'git'
      ? [words[i], ...stripGitGlobalOptions(words.slice(i + 1))]
      : words.slice(i);
    const joined = head.join(' ').toLowerCase();
    for (const pattern of IRREVERSIBLE_PATTERNS) {
      if (joined === pattern || joined.startsWith(`${pattern} `)) {
        return { irreversible: true, pattern };
      }
    }

    // `bash -c "git commit"` / `sh -c "git push"`: the quoted payload is a
    // command line, so follow it. Only the interpreter path recurses — quoted
    // arguments of ordinary programs stay data.
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
 * How long a green test run counts as evidence. Chosen deliberately: long enough
 * to cover "run the suite, review the diff, commit" on a real project, short
 * enough that yesterday's green does not authorise today's irreversible action.
 * The framework's own rule is that verification must be FRESH — a run from an
 * earlier message proves nothing about the current state.
 */
const EVIDENCE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function statePath(cwd) {
  return join(cwd, '.trust', 'tna-gate-state.json');
}

/**
 * Read recorded evidence, enforcing freshness.
 *
 * Origin 2026-10-25 (dsh fix-list #3): `recordEvidence` always wrote
 * `updatedAt`, but this function never read it — so ONE green run opened the
 * gate in that repository FOREVER. Measured: a state file dated 2020 still
 * allowed a commit. Trust decays with time, not just with failure.
 *
 * A missing or unparseable timestamp is NOT evidence (fail-closed): an
 * unreadable claim is not a claim.
 */
function readEvidence(cwd) {
  try {
    const state = JSON.parse(readFileSync(statePath(cwd), 'utf8'));
    if (state.testPassFresh !== true) return { testPassFresh: false, statePath: statePath(cwd) };
    const age = Date.now() - Date.parse(state.updatedAt ?? '');
    if (!Number.isFinite(age) || age < 0 || age > EVIDENCE_MAX_AGE_MS) {
      return { testPassFresh: false, statePath: statePath(cwd), stale: true };
    }
    return { testPassFresh: true, statePath: statePath(cwd) };
  } catch {
    // Missing or corrupt state is not evidence (fail-closed).
    return { testPassFresh: false, statePath: '(missing)' };
  }
}

/** A write failure is never fatal: the veto keeps working (fail-closed). */
function recordEvidence(cwd, { command, pass }) {
  try {
    mkdirSync(join(cwd, '.trust'), { recursive: true });
    writeFileSync(
      statePath(cwd),
      `${JSON.stringify({ testPassFresh: pass, command, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Did the finished shell call exit ZERO? Returns true / false / null, and null
 * means UNKNOWN — never pass.
 *
 * Origin 2026-10-25 (dsh fix-list #2, measured): dsh does NOT set `isError` for a
 * non-zero exit. Quoted from @deepseek-ai/dsh-tool-bash:
 *
 *   "Non-zero exits are reported, not errored — the model decides how to react;
 *    only infrastructure failures (spawn errors, aborts) surface as isError."
 *
 * The exit code is written into the RESULT TEXT as `[exit code: N]`. The old
 * recorder read `result.isError !== true`, so a RED suite recorded
 * `testPassFresh: true` and the following commit was allowed — the gate
 * certified the bug it exists to catch. (The pi/omp adapters can rely on
 * `isError`; dsh cannot. Same boundary, different transport.)
 *
 * SECOND HOLE, same day, found by the live session probe: the marker describes
 * the WHOLE command line, not the test inside it. A very common shape —
 *
 *     node y.test.mjs; "exit=$LASTEXITCODE"      (a red suite, exit 0 overall)
 *     node y.test.mjs && git commit -m x         (test gates the commit)
 *
 * leaves no non-zero marker at all, so "no marker = clean" certified the red
 * suite. Measured: a RED run recorded `testPassFresh: true` with exactly that
 * command string and the commit landed.
 *
 * So the marker is trusted only when the command line is EXACTLY a test
 * invocation (see `isPureTestCommand`). A compound command line is UNKNOWN —
 * the run cannot be attributed to the test, and unknown is never a pass.
 */
/**
 * Is this command line's EXIT STATUS the test's exit status?
 *
 * A shell reports the status of the LAST command in the line, so the rule is
 * positional, not "must be a single command":
 *
 *   `cd repo && node x.test.mjs`      -> test is last  -> trustworthy
 *   `cd repo; npm test`               -> test is last  -> trustworthy
 *   `node y.test.mjs; "exit=$LASTEXITCODE"` -> echo is last -> NOT trustworthy
 *   `node y.test.mjs && git commit -m x`    -> commit is last -> NOT trustworthy
 *
 * The first two MUST stay accepted: in a BB thread the session cwd is the
 * workspace root, so a path-based runner is only reachable behind a `cd` prefix
 * (the pi recorder report's central finding). The last two are exactly how a
 * red suite was certified green — measured live 2026-10-25.
 */
function isPureTestCommand(command) {
  const text = String(command ?? '').trim();
  if (text === '') return false;
  // Command substitution and newlines break the positional argument.
  if (/\$\(|`|\r|\n/.test(text)) return false;
  const parts = segments(text).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return TEST_RUN.test(parts[parts.length - 1]);
}

function runPassed(result, command) {
  if (result?.isError === true) return false;
  const blocks = result?.content;
  if (!Array.isArray(blocks)) return null;
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
  if (text === '') return null;
  const m = /\[exit code: (-?\d+)\]/.exec(text);
  if (m) return Number(m[1]) === 0 && isPureTestCommand(command);
  // No marker: dsh omits it for exit 0, but only a PURE test command makes that
  // "the suite passed". Anything compound is unknown.
  return isPureTestCommand(command) ? true : null;
}

/**
 * Append one denial to `.trust/tna-gate-log.jsonl` — the veto-fire log the
 * meter reads.
 *
 * Origin 2026-10-25 (dsh fix-list #8): only scripts/gate-hook.mjs wrote this
 * log, so a dsh denial left NO trace and `scripts/gate-meter.mjs` reported
 * "veto fires: no data yet" while the veto was demonstrably working. A gate
 * nobody can count is a gate nobody can audit.
 *
 * Self-contained on purpose: the plugin is loaded by path from a profile and
 * must not import the framework tree. Line shape mirrors `logVeto` in
 * scripts/tna-gate.mjs exactly, so `parseVetoLog` counts it. Logging must never
 * break the veto it records — every failure is silent by contract.
 */
function logVeto(cwd, { tool = '', command = '' } = {}) {
  try {
    mkdirSync(join(cwd, '.trust'), { recursive: true });
    appendFileSync(
      join(cwd, '.trust', 'tna-gate-log.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), harness: 'dsh', tool, command })}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the project the call runs in.
 *
 * The contract is `workingDirectory.ensure(agent, signal)`, where `agent` is a
 * LIVE agent (it is used as a WeakMap key and its session owns the directory).
 * `get(session)` is the non-validating read of the same fact and needs only
 * `agent.session`, so it is the first fallback.
 *
 * Origin 2026-10-25 (dsh fix-list, measured live on the composed `acp` tree):
 * every failure here used to degrade to `process.cwd()`, and that is a GATE
 * HOLE, not a graceful default — the process cwd is whatever directory dsh was
 * launched from, so a session working in repo A could read repo B's
 * `.trust/tna-gate-state.json` and see fresh evidence it never earned. Measured:
 * the same commit returned deny/deny/allow across three calls in one booted tree
 * because the fallback kept re-reading a different project's state.
 *
 * So: never fall back to an unrelated directory. When the project cannot be
 * resolved, return `null` and the caller FAILS CLOSED with that reason named.
 */
async function resolveCwd(ctx, exec) {
  const directories = ctx?.get?.('workingDirectory');
  const agent = exec?.agent;
  if (directories !== undefined && agent !== undefined) {
    try {
      const cwd = await directories.ensure(agent, exec.signal);
      if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    } catch {
      /* fall through to the non-validating read */
    }
    try {
      const cwd = directories.get?.(agent.session);
      if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** `exec.arguments` is dsh's parsed-argument field; tolerate `args` too. */
function commandOf(exec) {
  const args = exec?.arguments ?? exec?.args;
  if (typeof args?.command === 'string') return args.command;
  // A persistent terminal carries the command line in `text`, not `command`
  // (origin 2026-10-25, dsh fix-list #9: `terminal_send` with
  // `text: 'git commit -m x'` bypassed the veto entirely).
  if (typeof args?.text === 'string') return args.text;
  return '';
}

/** The path a write-shaped call targets (dsh tools use `path`/`file_path`). */
function writtenPathOf(exec) {
  const args = exec?.arguments ?? exec?.args;
  return args?.path ?? args?.filePath ?? args?.file_path ?? '';
}

export function apply(ctx) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const toolName = String(exec?.name ?? '').toLowerCase();

    /** Fail closed when the project cannot be resolved (never guess a cwd). */
    const unresolved = () => ({
      kind: 'deny',
      reason: '[trust-no-agent] tna-gate veto: cannot resolve this session\'s working directory, so recorded test evidence cannot be attributed to a project — refusing rather than reading another project\'s state (fail-closed)',
    });

    // Ledger append-only gate: checked before evidence, for every write tool.
    if (WRITE_TOOLS.has(toolName) && isLedgerPath(writtenPathOf(exec))) {
      const cwd = await resolveCwd(ctx, exec);
      if (cwd === null) return unresolved();
      logVeto(cwd, { tool: toolName, command: writtenPathOf(exec) });
      return {
        kind: 'deny',
        reason: `[trust-no-agent] tna-gate veto: the private ledger (.trust/progress.txt) is append-only — a ${toolName} overwrites it (ledger-overwrite incident 2026-10-18); append via a shell >> or a staging file instead`,
      };
    }

    // A terminal session is a shell: the same command rules apply to its text.
    if (SHELL_TOOLS.has(toolName) || TERMINAL_TOOLS.has(toolName)) {
      const command = commandOf(exec);

      // Ledger append-only gate on the SHELL path (fix-list #5): redirect,
      // Set-Content, Out-File and tee are overwrites; `>>` is the contract.
      if (shellOverwritesLedger(command)) {
        const cwd = await resolveCwd(ctx, exec);
        if (cwd === null) return unresolved();
        logVeto(cwd, { tool: toolName, command });
        return {
          kind: 'deny',
          reason: `[trust-no-agent] tna-gate veto: a shell command overwrites the private ledger (.trust/progress.txt) — the ledger is append-only; use >> to append (ledger-overwrite incident 2026-10-18)`,
        };
      }

      const { irreversible, pattern } = classifyCommand(command);
      if (!irreversible) return next();

      const cwd = await resolveCwd(ctx, exec);
      if (cwd === null) return unresolved();
      const evidence = readEvidence(cwd);
      if (evidence.testPassFresh) return next(); // fresh evidence: allow

      logVeto(cwd, { tool: toolName, command });
      return {
        kind: 'deny',
        reason: `[trust-no-agent] tna-gate veto: "${pattern}" is irreversible and this session has no fresh test evidence (run the project's tests first, then retry). Project state: ${evidence.stale ? `${evidence.statePath} (stale — older than 30 minutes)` : evidence.statePath}`,
      };
    }

    // Delegation/code tools (2026-10-25): `workflow`, `ralph` and `subagent`
    // spawn child agents that can run shell, and their payload never passes
    // through `command`. Same boundary, same evidence gate.
    const hit = classifyPayload(toolName, exec);
    if (!hit.irreversible) return next();
    const cwd = await resolveCwd(ctx, exec);
    if (cwd === null) return unresolved();
    const evidence = readEvidence(cwd);
    if (evidence.testPassFresh) return next();
    logVeto(cwd, { tool: toolName, command: payloadOf(exec) });
    return {
      kind: 'deny',
      reason: `[trust-no-agent] tna-gate veto: a ${toolName} payload instructs "${hit.pattern}" — irreversible without fresh test evidence (run the project's tests first, then retry). Project state: ${evidence.statePath}`,
    };
  });

  // The recorder. Without it the gate has no way to open.
  ctx.on('tools/result', async (exec, result) => {
    const toolName = String(exec?.name ?? '').toLowerCase();
    if (!SHELL_TOOLS.has(toolName) && !TERMINAL_TOOLS.has(toolName)) return;
    const command = commandOf(exec);
    if (!recordedTestRun(command)) return;
    // dsh reports a non-zero exit in the RESULT TEXT, not via isError (fix-list
    // #2). null = unknown, and unknown is never recorded as a pass.
    const pass = runPassed(result, command);
    if (pass === null) return;
    const cwd = await resolveCwd(ctx, exec);
    // No project, no evidence: recording into an unrelated directory would hand
    // a different repository a green run it never had.
    if (cwd === null) return;
    recordEvidence(cwd, { command, pass });
  });
}
