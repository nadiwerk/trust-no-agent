#!/usr/bin/env node
/**
 * trust-no-agent — Claude Code hook: the router's mechanical boundary.
 *
 * Two jobs, both driven by the event Claude Code puts on stdin:
 *
 *   SessionStart / PostCompact → inject the discipline floor (Iron Laws +
 *     the MANDATORY section, derived from the live AGENTS.md so the injected
 *     block cannot drift from the rules it re-injects — the same invariant as
 *     scripts/reinject.mjs in the framework repo).
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
 *   - PRETOOL DENY IS THE ONE LOUD EXIT. PreToolUse on a classified
 *     irreversible action without fresh evidence exits 2 with the reason on
 *     stderr (the harness's blocking contract — assumed from the harness
 *     docs, live verification still open). Everything else about this hook
 *     stays fail-open: unparseable input, unknown shapes, and allowed calls
 *     all exit 0 silent. A veto that fires on hook confusion would teach the
 *     user to uninstall it.
 *
 * Usage (this is a hook, not a CLI):
 *   echo '{"hook_event_name":"UserPromptSubmit","prompt":"fix the crash"}' \
 *     | node gate-hook.mjs
 */

import { readFileSync, existsSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReinject } from './reinject.mjs';
import { decideBefore, logVeto, observeAfter } from './tna-gate.mjs';
import { parseSkillOverlays } from './overlay-registry.mjs';
import { composeFloor } from './floor-composer.mjs';
import { parseStamp } from './onboarding.mjs';
import { vetoVerdict } from './receipt-enforcement.mjs';
import { matchesAnyCommand } from './action-gate.mjs';

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
  return decideBefore({ dir: cwd, tool: toolName, args: input });
}

/**
 * PreToolUse deny (the blocking contract, measured live on codex 0.159.2 —
 * probe14, 2026-10-22): exit 0 + stdout JSON `{"decision":"block","reason"}`.
 * The older exit-2+stderr path FAILS OPEN there (the exit-2 branch requires
 * can_apply_control_effects() and falls to the generic "hook exited with code
 * 2" Failed arm — probes 6-13 every commit landed); the stdout-JSON legacy
 * decision IS enforced and is also a documented Claude Code PreToolUse deny
 * shape, so one shape covers both harnesses. Synchronous stdout write so the
 * payload is flushed before exit on Windows.
 */
function denyPreTool(reason) {
  writeSync(1, JSON.stringify({ decision: 'block', reason: `[trust-no-agent] ${reason}` }) + '\n');
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
    } else if (event === 'SessionStart' || event === 'PostCompact') {
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
          const resp = payload.tool_response && typeof payload.tool_response === 'object' ? payload.tool_response : {};
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
  let ledgerText = '';
  try { ledgerText = readFileSync(join(cwd, '.trust', 'progress.txt'), 'utf8'); } catch { /* no ledger */ }
  // The allowlist is the PROJECT's, resolved from the same cwd the ledger came
  // from (F1, 2026-10-21): the framework's own gates graded an adopter's claim.
  return vetoVerdict({ ledgerText, today: new Date(), root: cwd });
}

// Self-execute only when run directly (the repo-wide guard pattern: every
// other script in scripts/ carries it — importing this module must not run
// the hook, so the doctor can reuse canonicalSessionFloor).
if (process.argv[1] && process.argv[1].endsWith('gate-hook.mjs')) main();
