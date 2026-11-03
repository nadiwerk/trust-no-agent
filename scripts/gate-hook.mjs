#!/usr/bin/env node
/**
 * trust-no-agent — Claude Code hook: the router's mechanical boundary.
 *
 * Two jobs, both driven by the event Claude Code puts on stdin:
 *
 *   SessionStart → inject the discipline floor (Iron Laws +
 *     the MANDATORY section, derived from the live AGENTS.md so the injected
 *     block cannot drift from the rules it re-injects — the same invariant as
 *     scripts/reinject.mjs in the framework repo). This single event covers
 *     startup, resume, and compaction: both harnesses re-fire SessionStart with
 *     `source: "compact"` after a compaction, and PostCompact cannot carry the
 *     context (see the handler for the measurements).
 *
 *   UserPromptSubmit → classify the prompt against the three MANDATORY domains
 *     with the framework's own classifier (mandatory-gate.mjs) and inject a
 *     LOAD directive when a domain is touched.
 *
 * Contract notes (deliberate, each one load-bearing):
 *
 *   - FAIL-OPEN, ALWAYS. Any error — missing router, missing classifier,
 *     unparsable stdin — exits 0 with no output. A discipline layer that can
 *     break the user's session is worse than no discipline layer, and a hook
 *     that fails loudly on a correct install teaches the user to ignore it.
 *
 *   - A KEYWORD SIGNAL IS NOT PROOF. The classifier is a binary matcher; its
 *     findings are "check whether this rule applies", never "you violated it".
 *     The injected text says so, and nothing here blocks a tool call — an
 *     uncalibrated keyword gate that hard-fails on the word "done" would fire
 *     on "I'm done explaining" (spec §Constraints, and the v0.1.15 lesson).
 *
 *   - THE FLOOR TEXT IS LOADED FROM THE ROUTER, NOT COPIED. If AGENTS.md is
 *     missing, the hook says nothing rather than injecting a stale copy.
 *
 *   - PRETOOL DENY IS THE ONE LOUD ANSWER. PreToolUse on a classified
 *     irreversible action without fresh evidence returns a deny decision on
 *     stdout (exit 0) — see denyPreTool for the shape and the live probes
 *     behind it. Everything else about this hook stays fail-open: unparseable
 *     input, unknown shapes, and allowed calls all exit 0 silent. A veto that
 *     fires on hook confusion would teach the user to uninstall it.
 *
 * Usage (this is a hook, not a CLI):
 *   echo '{"hook_event_name":"UserPromptSubmit","prompt":"fix the crash"}' \
 *     | node gate-hook.mjs
 */

/**
 * Imports are DYNAMIC so a broken install is loud instead of silent.
 *
 * Origin 2026-11-03 (audit P0). These were static imports. A missing or broken
 * sibling module — a partial payload, a deleted file, a syntax error next door
 * — made Node exit 1 BEFORE main() ran and printed nothing on stdout, and
 * main()'s own try/catch cannot catch a module-load throw (measured: a copy of
 * this file without its siblings exited 1 with ERR_MODULE_NOT_FOUND). On Claude
 * Code, "exit 1 without valid JSON" is a NON-BLOCKING hook error, so the floor
 * and the veto vanished for the whole session while the session looked normal;
 * `--self-check` lives in this same module and could not report it either.
 * Codex's handling of exit 1 is unverified, which is reason enough not to rely
 * on it. A load failure is now the documented warn-but-allow answer: exit 0
 * with a user-visible `systemMessage` that names the gate as inactive.
 */
let readFileSync, existsSync, writeSync;
let dirname, join;
let fileURLToPath;
let buildReinject, decideBefore, logVeto, observeAfter, parseSkillOverlays, composeFloor, parseStamp, vetoVerdict, matchesAnyCommand, gitTargetDir;
let LOAD_ERROR = null;
try {
  ({ readFileSync, existsSync, writeSync } = await import('node:fs'));
  ({ dirname, join } = await import('node:path'));
  ({ fileURLToPath } = await import('node:url'));
  ({ buildReinject } = await import('./reinject.mjs'));
  ({ decideBefore, logVeto, observeAfter } = await import('./tna-gate.mjs'));
  ({ parseSkillOverlays } = await import('./overlay-registry.mjs'));
  ({ composeFloor } = await import('./floor-composer.mjs'));
  ({ parseStamp } = await import('./onboarding.mjs'));
  ({ vetoVerdict } = await import('./receipt-enforcement.mjs'));
  ({ matchesAnyCommand, gitTargetDir } = await import('./action-gate.mjs'));
} catch (err) {
  LOAD_ERROR = err;
}

/**
 * The warning a load failure emits. `systemMessage` is the documented
 * user-visible field on BOTH harnesses (Claude renders it without turning it
 * into a decision; Codex carries it as a common output field), and exit 0
 * blocks nothing. `--self-check` gets the same text as plain lines so the
 * doctor can tell "installed and quiet" from "installed and broken".
 */
function loadFailureMessage() {
  const detail = String(LOAD_ERROR?.message ?? LOAD_ERROR ?? 'unknown load error').split('\n')[0];
  return `[trust-no-agent] the gate hook could not load its modules (${detail}). ` +
    "This session's discipline floor and irreversible-action veto are INACTIVE. " +
    'Reinstall the plugin or run node plugin/scripts/doctor.mjs, then restart the session.';
}

/**
 * True when this file is the process entry point. A load failure may only
 * exit the process when the HOOK is what the harness ran: imported as a
 * library (the doctor's overlay scan), the module must fail the import so the
 * caller can catch it. Measured 2026-11-03: without this guard the load-failure
 * handler called process.exit(0) inside the doctor and truncated its report
 * halfway — the shell-configured `systemMessage` even landed in the doctor's
 * own stdout.
 */
const IS_ENTRY = typeof process.argv[1] === 'string' && process.argv[1].endsWith('gate-hook.mjs');

if (LOAD_ERROR) {
  if (!IS_ENTRY) throw LOAD_ERROR;  // let the importer decide (doctor reports it)
  try {
    const selfCheck = process.argv.includes('--self-check');
    process.stdout.write((selfCheck ? loadFailureMessage() : JSON.stringify({ systemMessage: loadFailureMessage() })) + '\n');
  } catch {
    /* nothing left to report through */
  }
  process.exit(0);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');

// The discipline floor spans TWO files and neither carries both halves:
// the four Iron Laws live in WORKFLOW.md, the MANDATORY section in AGENTS.md.
// (Learned the hard way — see the extractFloor note below.) The plugin carries
// copies of both; the framework repo checkout is a fallback for a plugin copy
// that has gone stale. Plugin copies are preferred so the hook keeps working
// when the repo has moved (re-clone, repo deleted, another checkout).
const ROUTER_SOURCE_FILES = ['WORKFLOW.md', 'AGENTS.md'];
const ROUTER_ROOTS = [
  PLUGIN_ROOT,
  join(process.env.HOME || process.env.USERPROFILE || '', 'projects', 'trust-no-agent'),
];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** The discipline floor: Iron Laws + the MANDATORY section, quoted from AGENTS.md.
 *
 * Extraction is delegated to the framework's own `buildReinject` (reinject.mjs)
 * rather than reimplemented here. First draft of this hook hand-rolled a regex
 * over the router and silently dropped the Iron Laws — the laws live in a
 * fenced block under "## The four Iron Laws", and the hand-rolled matcher
 * neither found that heading nor matched the lines inside it, so the hook
 * injected the MANDATORY section alone and looked like it worked. That is the
 * exact silent-failure mode the framework exists to kill (AGENTS.md §2), and
 * the reason the tested extractor is the one that ships.
 */
function extractFloor(agentsText) {
  const block = buildReinject(agentsText);
  if (!block) return null;
  // Drop the extractor's header line — this hook supplies its own framing.
  const lines = block.split(/\r?\n/);
  const firstHeading = lines.findIndex((l) => /^#+\s/.test(l));
  const body = (firstHeading === -1 ? lines : lines.slice(firstHeading)).join('\n').trim();
  return body || null;
}

/**
 * Where are the skills, really?
 *
 * Both candidate roots ship with the plugin, and the personal dir is where the
 * documented manual install copies them. The floor used to assert the personal
 * dir unconditionally — an assumption, and the plugin install does not put
 * skills there, so on a machine that installed only through the marketplace the
 * sentence pointed the agent at an empty directory. Check, then say only what
 * exists (2026-09-30, gap found by walking the install paths of a fresh
 * adopter).
 *
 * @returns {{roots: string[], text: string}}
 */
function resolveSkillRoots() {
  const candidates = [
    join(PLUGIN_ROOT, 'skills'),
    join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || '', '.claude'), 'skills'),
  ];
  const roots = candidates.filter((p) => p && existsSync(p));
  if (roots.length)
    return {
      roots,
      text:
        `Skills are available at: ${roots.join(', ')}. Check the trigger matrix before ` +
        'responding; the three MANDATORY skills load on their domain, not on self-trigger.',
    };
  return {
    roots: [],
    text:
      'No skill directory found next to the router or in the personal skills dir — the ' +
      'router is active but the skills may not be installed; verify the install ' +
      '(docs/installation.md) before relying on a skill load.',
  };
}

function buildSessionStartContext() {
  const r = scanSessionOverlays(process.cwd());
  return r ? r.text : null;
}

/**
 * Scan the session's overlay registry and compose the floor in ONE place —
 * the session hook and the doctor share this seam, so the doctor's
 * budget-omission count is provably the number the session would omit (a
 * count computed against a different string would be a lie with a number).
 * Fail-open: an absent or unreadable registry leaves the canonical floor
 * standing with a named error for the doctor.
 */
export function scanSessionOverlays(cwd) {
  const canonical = canonicalSessionFloor();
  if (!canonical) return null;
  let entries = [];
  let errors = [];
  try {
    ({ entries, errors } = parseSkillOverlays(join(cwd, '.trust', 'skills-overlay')));
  } catch (e) {
    errors = [`registry unreadable — ${e && e.message ? e.message : 'unknown error'}`];
  }
  const { text, omitted } = composeFloor({ canonicalFloor: canonical, overlays: entries, budget: 4000 });
  return { canonical, entries, errors, omitted, text };
}

/**
 * The canonical session floor — the pre-composition string the SessionStart
 * floor is built from. Exported so the doctor computes the overlay budget
 * omission against the SAME canonical floor the session receives; a count
 * computed against a different string would be a lie with a number.
 */
export function canonicalSessionFloor() {
  for (const root of ROUTER_ROOTS) {
    if (!root) continue;
    const texts = ROUTER_SOURCE_FILES.map((f) => join(root, f))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, 'utf8'));
    if (!texts.length) continue;
    const floor = extractFloor(texts.join('\n\n'));
    if (!floor) continue;
    return (
      'trust-no-agent — the router is installed. These rules are active in this session, ' +
      'quoted verbatim from the router (WORKFLOW.md + AGENTS.md):\n\n' +
      floor +
      '\n\n' +
      resolveSkillRoots().text
    );
  }
  return null;
}

/**
 * `--self-check`: report what this hook resolved, for the human verifying an
 * install.
 *
 * Why it exists: the hook fails OPEN by design, so its absence is silent — a
 * session with no floor looks exactly like a session with one, and the only
 * honest signal was the user noticing the rules were not there. This mode makes
 * the difference between "wired and quiet" and "not wired" observable without
 * breaking the fail-open contract: it is opt-in, and the hook paths the harness
 * calls stay exactly as before (2026-09-30).
 */
function selfCheck() {
  const routerRoot = ROUTER_ROOTS.find((r) => r && existsSync(join(r, 'WORKFLOW.md')) && existsSync(join(r, 'AGENTS.md')));
  const skills = resolveSkillRoots();
  const classifier = existsSync(join(HERE, 'mandatory-gate.mjs'));
  const lines = [
    `router: ${routerRoot ? 'FOUND at ' + routerRoot : 'NOT FOUND (looked in: ' + ROUTER_ROOTS.filter(Boolean).join(', ') + ')'}`,
    `skills: ${skills.roots.length ? 'FOUND at ' + skills.roots.join(', ') : 'NOT FOUND'}`,
    `classifier: ${classifier ? 'FOUND at ' + join(HERE, 'mandatory-gate.mjs') : 'NOT FOUND'}`,
    `hooks: wired by the harness — if the floor does not appear at session start, re-check hooks.json (${join(HERE, '..', 'hooks', 'hooks.json')})`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

const DOMAIN_INSTRUCTION = {
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

let classify = null;
try {
  ({ classifyTask: classify } = await import(
    new URL('./mandatory-gate.mjs', import.meta.url).href
  ));
} catch {
  classify = null; // no classifier → this hook's prompt half is inert, session half still works
}

function buildPromptContext(prompt) {
  if (!classify || !prompt) return null;
  let verdict;
  try {
    verdict = classify(prompt);
  } catch {
    return null;
  }
  const hits = Object.entries(verdict)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!hits.length) return null;
  const lines = hits.map((h) => `- **${h}** — ${DOMAIN_INSTRUCTION[h]}`);
  return (
    'trust-no-agent mandatory-gate flagged this request against the MANDATORY domains ' +
    '(keyword signal — verify, it is not proof of a violation):\n\n' +
    lines.join('\n') +
    '\n\nLoad each flagged skill before the work it governs. If a flag does not apply to what ' +
    'was actually asked, say so and proceed — do not perform the ritual.'
  );
}

function emit(eventName, context) {
  if (!context) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: context,
      },
    })
  );
}

/**
 * PreToolUse verdict: the same irreversible-action boundary as the opencode
 * veto (ticket 02's decideBefore over the project's recorded evidence),
 * answered in the hook runner's exit code. The tool name and input are read
 * from the harness payload (`tool_name`/`tool_input`, with `tool`/`args`
 * aliases); the evidence is read from the payload's `cwd`, so a session
 * running in a project dir shares that project's test-run record. A payload
 * too shapeless to judge returns null — deny needs a classified action, and
 * confusion is always fail-open (the contract pinned by the B-suite).
 */
function buildPreToolVerdict(payload) {
  const toolName =
    typeof payload.tool_name === 'string' && payload.tool_name
      ? payload.tool_name
      : typeof payload.tool === 'string'
        ? payload.tool
        : '';
  const input =
    payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : payload.args && typeof payload.args === 'object'
        ? payload.args
        : null;
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : '';
  if (!toolName || !input || !cwd) return null;
  // Evidence belongs to the repo the action targets (2026-11-01, same class as
  // receiptVerdict below): a cwd holding a green state file cannot lend it to a
  // commit in a different repo. A target that does not exist is not evidence
  // either — the cwd state is the only state on record.
  const dir = targetDirFor(input, cwd);
  return decideBefore({ dir, tool: toolName, args: input });
}

/**
 * The directory an action is graded against: the git work tree the command
 * names (`git -C <path>` / `--git-dir` / `--work-tree`), else the cwd itself.
 * A named target that does not exist falls back to the cwd — the pre-2026-11-01
 * verdict — rather than resolving to an empty directory that trivially passes.
 */
function targetDirFor(input, cwd) {
  const command = typeof input?.command === 'string' ? input.command : '';
  const target = command && matchesAnyCommand(command) ? gitTargetDir(command, cwd) : null;
  return target && existsSync(target) ? target : cwd;
}

/**
 * PreToolUse deny — the DOCUMENTED decision shape on both harnesses.
 *
 * Contract: exit 0 + stdout JSON
 * `{"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *   "permissionDecision":"deny","permissionDecisionReason":"…"}}`.
 *
 * Why not the other two shapes:
 *   - exit 2 + stderr FAILS OPEN on codex 0.159.2 (probes 6-13, 2026-10-22:
 *     every commit landed — the exit-2 branch needs can_apply_control_effects()
 *     and otherwise falls to the generic "hook exited with code 2" arm).
 *   - the legacy top-level `{"decision":"block","reason":…}` was enforced there
 *     (probe14: the model stopped), but Claude Code documents it as DEPRECATED
 *     for PreToolUse, with `block`/`approve` mapping to `deny`/`allow`.
 * Codex accepts `hookSpecificOutput.permissionDecision` as well, so this one
 * shape is documented on both while keeping the exit-0 behaviour that was
 * proven to hold. Synchronous stdout write so the payload is flushed before
 * exit on Windows.
 */
function denyPreTool(reason) {
  writeSync(1, JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[trust-no-agent] ${reason}`,
    },
  }) + '\n');
  process.exit(0);
}

function main() {  // Opt-in reporting path: the harness never passes --self-check, so this
  // cannot affect a live session.
  if (process.argv.includes('--self-check')) return selfCheck();
  let payload = {};
  try {
    const raw = readStdin();
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  // Onboarding consent (onboarding ticket 07): the stamp from the project
  // cwd gates this hook. Declined hooks -> nothing runs; declined floor ->
  // the floor is not emitted; declined evidence gate -> the veto does not
  // fire. No stamp keeps the fail-closed default (the pre-onboarding
  // behavior). Consent is real by construction — the menu is not decoration.
  const consent = readConsent(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
  if (consent && !consent.components.hooks) process.exit(0);

  const event = String(payload.hook_event_name || '');
  try {
    if (event === 'UserPromptSubmit') {
      emit(event, buildPromptContext(String(payload.prompt || '')));
    } else if (event === 'SessionStart') {
      // SessionStart is the ONLY delivery path for the floor, by measurement,
      // not by preference (2026-11-03). Both harnesses fire it with
      // `source: "compact"` after a compaction, and it accepts
      // `hookSpecificOutput.additionalContext`; neither manifest wires
      // PostCompact any more, because Claude discards `systemMessage`/`continue`
      // on that event and documents additionalContext only for SessionStart,
      // SubagentStart and PostModelSwitch, while Codex's PostCompact accepts the
      // common output fields only. The old `|| event === 'PostCompact'` branch
      // emitted JSON that both harnesses dropped — a hook that ran and did
      // nothing, which reads exactly like a hook that worked.
      if (!consent || consent.components.floor !== false) emit(event, buildSessionStartContext());
    } else if (event === 'PreToolUse') {
      let verdict = null;
      if (!consent || consent.components.evidenceGate !== false) {
        try {
          verdict = buildPreToolVerdict(payload);
        } catch {
          verdict = null; // unjudgeable → fail-open, same as every other error here
        }
      }
      // The receipt rule (receipt-enforcement ticket 05): a commit's newest
      // ledger entry must carry a valid receipt (and a gateable claim).
      // Hooks-level: it runs whenever the hook runs at all. No ledger = the
      // existing evidence precondition owns the case.
      const rv = receiptVerdict(payload);
      if (rv && !rv.allow) {
        logVeto(payload.cwd, { harness: 'gate-hook', tool: String(payload.tool_name ?? payload.tool ?? ''), command: String(payload.tool_input?.command ?? payload.args?.command ?? '') });
        denyPreTool(rv.reason);
      }
      if (verdict && !verdict.allow) {
        logVeto(payload.cwd, { harness: 'gate-hook', tool: String(payload.tool_name ?? payload.tool ?? ''), command: String(payload.tool_input?.command ?? payload.args?.command ?? '') });
        denyPreTool(verdict.reason);
      }
      // Allowed or unjudgeable: silent, exit 0 below.
    } else if (event === 'PostToolUse') {
      // Evidence recording (the opencode execute.after mirror): a finished
      // tool call whose command was a real test-run invocation records
      // testPassFresh itself — evidence from the session's own runs, not an
      // out-of-band write. observeAfter's contract keeps the boundaries:
      // only a matched runner invocation records, an unknown outcome records
      // nothing, and recording never throws (wrapped like every event here).
      try {
        const toolName = String(payload.tool_name ?? payload.tool ?? '');
        const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input
          : payload.args && typeof payload.args === 'object' ? payload.args : null;
        const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
        if (toolName && input && typeof input.command === 'string') {
          // Pass the WHOLE response through, not just an error flag.
          //
          // Origin 2026-10-25 (audit-run-blockers #2, measured): this built
          // `{ metadata: { error: resp.error ?? null } }` and dropped everything
          // else — including `exitCode` and `stdout`. `observeAfter` then inferred
          // "pass" from the ABSENCE of an error, so a red suite that reported no
          // error object was recorded green. The exit signal now survives the hop.
          //
          // Origin 2026-10-27 (ads-tracker live, gate denied forever): Claude Code
          // names the finished tool's result `toolUseResult` —
          // `{ stdout, stderr, interrupted, isImage, noOutputExpected }` — and
          // sends NO `tool_response` field at all. Reading only tool_response made
          // this recorder blind on that harness: a green vitest run recorded
          // nothing, the state stayed stale, and every commit/push was refused
          // while the PreToolUse veto kept firing. Read BOTH names, tool_response
          // preferred (Codex canonical shape) so the two cannot drift apart.
          const resp =
            (payload.tool_response && typeof payload.tool_response === 'object' ? payload.tool_response : null) ??
            (payload.toolUseResult && typeof payload.toolUseResult === 'object' ? payload.toolUseResult : null) ??
            {};
          const output = {
            metadata: { error: resp.error ?? null, ...(resp.exitCode !== undefined ? { exitCode: resp.exitCode } : {}) },
            ...(typeof resp.stdout === 'string' ? { stdout: resp.stdout } : {}),
            ...(resp.exitCode !== undefined ? { exitCode: resp.exitCode } : {}),
          };
          observeAfter(cwd, { tool: toolName, args: { command: input.command } }, output);
        }
      } catch {
        /* recording never breaks the session — fail-open */
      }
    }
    // Any other event: nothing to say.
  } catch {
    /* fail-open */
  }
  process.exit(0);
}

/** The onboarding consent stamp from the project cwd, or null (no consent). */
function readConsent(cwd) {
  try { return parseStamp(readFileSync(join(cwd, '.trust', 'onboarding.json'), 'utf8')); } catch { return null; }
}

/**
 * The receipt veto for a commit (receipt-enforcement ticket 05): the newest
 * ledger entry must carry a valid receipt and a gateable claim. Non-commit
 * actions return null (the rule governs commits); a missing ledger returns
 * null too (the evidence precondition owns that case).
 */
function receiptVerdict(payload) {
  const cmd = String(payload.tool_input?.command ?? payload.args?.command ?? '');
  // Execution-position doctrine (F4, observed live 2026-10-21): the phrase
  // must be EXECUTED, not mentioned — the whole-string regex denied a pure
  // ledger append whose heredoc body quoted "git commit" in its receipt text
  // (veto log 2026-10-22T01:21:48Z). Same matcher the irreversible patterns
  // use: heredoc bodies are data, segments split at separators, quotes held.
  if (!matchesAnyCommand(cmd)) return null;
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  // The ledger and the allowlist belong to the repo the COMMIT targets, not to
  // wherever the shell stood (2026-11-01, measured live on this framework's own
  // release commit). From a workspace ledger with no AGENTS.md/CI, `git -C
  // <repo> commit` was denied with "no proof commands declared in
  // <workspace>/AGENTS.md" while the same action from the repo root was
  // allowed — the veto graded the wrong tree in both directions. A named target
  // that does not exist is graded at the cwd, never silently allowed.
  const root = targetDirFor(payload.tool_input ?? payload.args ?? {}, cwd);
  let ledgerText = '';
  try { ledgerText = readFileSync(join(root, '.trust', 'progress.txt'), 'utf8'); } catch { /* no ledger */ }
  // The allowlist is the PROJECT's, resolved from the same root the ledger came
  // from (F1, 2026-10-21): the framework's own gates graded an adopter's claim.
  return vetoVerdict({ ledgerText, today: new Date(), root });
}

// Self-execute only when run directly (the repo-wide guard pattern: every
// other script in scripts/ carries it — importing this module must not run
// the hook, so the doctor can reuse canonicalSessionFloor).
if (process.argv[1] && process.argv[1].endsWith('gate-hook.mjs')) main();
