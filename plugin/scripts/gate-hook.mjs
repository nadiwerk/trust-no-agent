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
 * Usage (this is a hook, not a CLI):
 *   echo '{"hook_event_name":"UserPromptSubmit","prompt":"fix the crash"}' \
 *     | node gate-hook.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReinject } from './reinject.mjs';

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

function buildSessionStartContext() {
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
      '\n\nSkills are installed globally (~/.claude/skills). Check the trigger matrix before ' +
      'responding; the three MANDATORY skills load on their domain, not on self-trigger.'
    );
  }
  return null;
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

function main() {
  let payload = {};
  try {
    const raw = readStdin();
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const event = String(payload.hook_event_name || '');
  try {
    if (event === 'UserPromptSubmit') {
      emit(event, buildPromptContext(String(payload.prompt || '')));
    } else if (event === 'SessionStart' || event === 'PostCompact') {
      emit(event, buildSessionStartContext());
    }
    // Any other event: nothing to say.
  } catch {
    /* fail-open */
  }
  process.exit(0);
}

main();
