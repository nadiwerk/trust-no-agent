// tna-discipline.ts — trust-no-agent discipline extension for pi
// (~/.pi/agent/extensions).
//
// Three layers, ported from the omp adapter (~/.omp/agent/hooks/pre/
// tna-discipline.ts) onto pi's event contract:
//
//   1. FLOOR. `before_agent_start` → the four Iron Laws + the MANDATORY section,
//      QUOTED from the project router (never copied), so the injected block
//      cannot drift from the rules it re-injects.
//   2. MANDATORY CLASSIFICATION. The same event classifies the prompt against
//      expect-fail / root-cause / receipts and appends a LOAD directive. It is a
//      keyword signal: the text says "verify, this is not proof of a violation".
//   3. COMPLETION-CLAIM GATE. `agent_before_settle` → a closing claim with no
//      verifying tool call in the turn gets a notice appended (or the settle is
//      held open with `continue: true`), matching the omp session_stop port.
//
// WHY: measured 2026-10-25 — pi shipped ONLY tna-veto.ts. No floor, no
// classification, no done-gate: the veto blocked the last action while the
// reasoning producing that action was unguarded, which is the split the router
// exists to remove.
//
// POSTURE — FAIL-OPEN, ALWAYS. Every handler swallows its own errors and
// returns undefined: a discipline layer that can break a session is worse than
// no discipline layer. The veto is the only layer that blocks, and it lives in
// its own file.
//
// pi contract used here (dist/core/extensions/types.d.ts):
//   before_agent_start → { systemPrompt?: string } (replace the whole prompt;
//     later handlers observe the override)
//   agent_before_settle → { entries?, continue? } (BoundaryResult)

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || homedir();

// Fallback router sources: the upstream checkout on this machine. The project's
// own AGENTS.md is always tried FIRST, at call time.
// Fallback router sources, in order: the skill payload that ships WITH the
// framework (the setup-tna references copy every harness install already
// carries), then the shared Agent Skills location, then the upstream checkout at
// its conventional location. The current project's AGENTS.md is always tried
// FIRST at call time (resolveFloor(cwd)), so these fallbacks only matter outside
// an adopted project.
//
// Origin 2026-10-25: the list used to be hard-coded to the maintainer's own
// `~/projects/trust-no-agent` checkout — a path no adopter has — so on a fresh
// install the floor silently found nothing and fail-open meant "no floor".
const ROUTER_FALLBACK_ROOTS = [
  join(HOME, '.pi', 'agent', 'skills', 'setup-tna', 'references'),
  join(HOME, '.agents', 'skills', 'setup-tna', 'references'),
  join(HOME, '.claude', 'skills', 'setup-tna', 'references'),
  join(HOME, 'projects', 'trust-no-agent', 'plugin'),
  join(HOME, 'projects', 'trust-no-agent'),
];
const ROUTER_SOURCE_FILES = ['AGENTS.md', 'WORKFLOW.md'];

// The floor spans the four Iron Laws + the MANDATORY section. Router files shape
// those differently, so match by sentinel line, not by heading shape, and
// refuse a half floor: no law lines → no floor (silent fail-open).
const LAW_SENTINELS = [
  /No acting until/i,
  /No production .+ without [^.]*failing test first/i,
  /No completion claims? without fresh verification/i,
  /expensive, irreversible, or shared-system action/i,
];

/**
 * Extract the discipline floor from router file text. Shape-agnostic:
 * sentinel-matched law lines, not heading forms.
 * @param {string} text
 * @returns {string | null}
 */
export function extractFloor(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const laws = [];
  for (const re of LAW_SENTINELS) {
    const line =
      lines.find((l) => re.test(l) && /^\s*(?:\d+\.|-)\s/.test(l)) ??
      lines.find((l) => re.test(l));
    if (!line) return null;
    laws.push(line.replace(/^\s*(?:\d+\.|-)\s*/, '').trim());
  }
  const out = ['The four Iron Laws (quoted from the router, not copied):'];
  laws.forEach((l, i) => out.push(`${i + 1}. ${l}`));
  const mandStart = lines.findIndex((l) => /^#+\s*(?:\d+\.\s*)?MANDATORY discipline skills/i.test(l));
  if (mandStart !== -1) {
    out.push('');
    for (let i = mandStart; i < lines.length; i++) {
      const l = lines[i];
      if (i > mandStart && /^#+\s/.test(l)) break;
      out.push(l);
    }
  }
  return out.join('\n').trim();
}

/**
 * Project router first (primary), then installed fallbacks. Fail-open: null.
 * @param {string} cwd
 * @returns {{ floor: string, source: string } | null}
 */
export function resolveFloor(cwd) {
  const roots = [cwd, ...ROUTER_FALLBACK_ROOTS].filter(Boolean);
  for (const root of roots) {
    const texts = [];
    for (const file of ROUTER_SOURCE_FILES) {
      const path = join(root, file);
      try {
        if (existsSync(path)) texts.push(readFileSync(path, 'utf8'));
      } catch {
        /* unreadable root — try the next */
      }
    }
    if (!texts.length) continue;
    const floor = extractFloor(texts.join('\n\n'));
    if (floor) return { floor, source: root };
  }
  return null;
}

/** @type {Record<string, string>} */
const DOMAIN_INSTRUCTION = {
  'expect-fail':
    'No production code and no test without a failing test first — load the `expect-fail` ' +
    'skill before writing either. Writing tests is never `fast`.',
  'root-cause':
    'Look up the root cause before proposing any fix — load the `root-cause` skill first. A ' +
    'fix proposed before the cause is known is a guess with a receipt attached.',
  receipts:
    'No "done"/"shipped"/"fixed" claim, commit, or PR without fresh verification evidence run ' +
    "in this session — load the `receipts` skill first. The agent's own claim is not evidence.",
};

// MANDATORY keyword classification.
//
// PORTED VERBATIM from scripts/mandatory-gate.mjs (2026-10-25, audit-run-blockers
// #11). The extension is installed as a project file and must not depend on the
// framework tree, so the tables are duplicated — the same trade the TEST_RUN
// matcher makes — and `scripts/harness-general.test.mjs` pins the port to the
// canonical classifier on a corpus.
//
// WHY THE PORT (measured): the old table matched bare words with no negation
// handling, so three of four ordinary sentences fired a domain:
//   "fix the typo in the heading"      -> root-cause   (canonical: none)
//   "what does the test runner print"  -> expect-fail  (canonical: none)
//   "perbaiki ejaan di docs"           -> root-cause   (canonical: none)
// A notice that fires on ordinary prose is noise, and noise is ignored.
const MANDATORY_KEYWORDS = {
  'expect-fail': ['write a test', 'write tests', 'unit test', 'write a spec', 'tulis test', 'buat test', 'add unit tests', 'test-first'],
  'root-cause': ['bug', 'error', 'failing', 'failure', 'regression', 'perbaiki bug', 'debug', 'crash', 'why does', 'broke', 'broken', 'why is this'],
  receipts: ['commit', 'push', 'shipped', 'ship', 'merge', 'merged', 'pr', 'release', 'done', 'selesai', 'beres', 'catat', 'log it', 'deploy'],
};

/**
 * Negation markers, EN + ID. Bare "no" is deliberately absent: it is both the
 * commonest English denial and the commonest Indonesian sentence opener, and a
 * complaint is a positive signal.
 */
const NEGATION_MARKERS = [
  'no need', 'no commit', 'no commits', 'no test', 'no tests', 'no spec', 'no bug', 'no bugs', 'no error',
  'no errors', 'no fix', 'no fixes',
  'not', 'dont', "don't", 'do not', 'without', 'never', 'nothing to',
  'jangan', 'tanpa', 'belum', 'tidak perlu', 'ga perlu', 'gak perlu', 'nggak perlu',
];

/** How many tokens a negation reaches forward (one clause). */
const NEGATION_WINDOW_WORDS = 6;

/** Clause boundaries: a negation never reaches past one. */
const CLAUSE_BOUNDARY = /[.,;:!?()\n]|\s(?:but|tapi|however|namun|though|meskipun)\s/;

function clauseSpans(text) {
  const spans = [];
  let start = 0;
  const re = new RegExp(CLAUSE_BOUNDARY.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    spans.push([start, m.index]);
    start = m.index + m[0].length;
  }
  spans.push([start, text.length]);
  return spans;
}

function matchIndex(text, kw) {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\b${esc}\\b`, 'i').exec(text);
  return m ? m.index : -1;
}

function isNegated(text, at, kw, spans) {
  const span = spans.find(([s, e]) => at >= s && at < e);
  if (!span) return false;
  const [s] = span;
  const through = text.slice(s, at + kw.length);
  const words = through.split(/\s+/).filter(Boolean);
  const tail = words.slice(-NEGATION_WINDOW_WORDS).join(' ');
  return NEGATION_MARKERS.some((marker) => {
    const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|\\s)${esc}(\\s|$)`, 'i').test(tail)) return true;
    return new RegExp(`(^|\\s)${esc}$`, 'i').test(through);
  });
}

function matchesAny(text, keywords) {
  const spans = clauseSpans(text);
  return keywords.some((kw) => {
    let from = 0;
    for (;;) {
      const idx = matchIndex(text.slice(from), kw);
      if (idx === -1) return false;
      const at = from + idx;
      if (!isNegated(text, at, kw, spans)) return true;
      from = at + kw.length;
    }
  });
}

/**
 * Strip instruction blocks the HOST injects before classification (audit #11b):
 * a bb session's `event.prompt` already carries the host-wide AGENTS.md block,
 * which names `expect-fail` and `commit` literally, so the notice fired on the
 * framework's own prose. Two shapes are recognised: the `Instructions from:`
 * preamble and the router's numbered section headings. A block ends at a
 * non-router heading or at plainly user prose after a blank line — a strip that
 * ran to the end of the prompt would swallow the real request and blind the gate.
 */
export function stripHostInstructions(prompt) {
  const text = String(prompt ?? '');
  const lines = text.split(/\r?\n/);
  const ROUTER_HEADING = /^\s*#{1,3}\s*(\d+\.\s*)?(Klasifikasi sebelum|Trigger matrix|Aturan inti|Discipline floor|Trust No Agent)\b/i;
  const ANY_HEADING = /^\s*#{1,3}\s+\S/;
  const kept = [];
  let inside = false;
  let sawBlank = false;

  for (const line of lines) {
    if (/^\s*Instructions from:/i.test(line)) { inside = true; sawBlank = false; continue; }
    if (ROUTER_HEADING.test(line)) { inside = true; sawBlank = false; continue; }

    if (inside) {
      if (ANY_HEADING.test(line) && !ROUTER_HEADING.test(line)) {
        inside = false;
        kept.push(line);
        sawBlank = false;
        continue;
      }
      const structured = /^\s*(#{1,6}\s|\||[-*+]\s|\*\*|`|>\s|\d+\.\s)/.test(line);
      if (line.trim() === '') { sawBlank = true; continue; }
      if (sawBlank && !structured && !ROUTER_HEADING.test(line)) {
        inside = false;
        kept.push(line);
        sawBlank = false;
        continue;
      }
      sawBlank = false;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/**
 * Classify a prompt against the three MANDATORY domains (keyword signal).
 * @param {string} prompt
 * @returns {Record<string, boolean>}
 */
export function classifyPrompt(prompt) {
  const text = stripHostInstructions(prompt).toLowerCase();
  /** @type {Record<string, boolean>} */
  const verdict = {};
  for (const [domain, keywords] of Object.entries(MANDATORY_KEYWORDS)) {
    verdict[domain] = matchesAny(text, keywords);
  }
  return verdict;
}

/**
 * @param {string} prompt
 * @returns {string | null}
 */
export function buildPromptNotice(prompt) {
  if (!prompt) return null;
  const hits = Object.entries(classifyPrompt(prompt))
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (!hits.length) return null;
  const lines = hits.map((h) => `- **${h}** — ${DOMAIN_INSTRUCTION[h]}`);
  return (
    'MANDATORY DOMAIN DETECTED — trust-no-agent mandatory-gate flagged this request (keyword ' +
    'signal — verify, it is not proof of a violation):\n\n' +
    lines.join('\n') +
    '\n\nLoad each flagged skill before the work it governs. If a flag does not apply to what ' +
    'was actually asked, say so and proceed — do not perform the ritual.'
  );
}

const CLAIM_PATTERNS = [
  /\b(done|fixed|shipped|complete|completed|finished|passing|works|working)\b/i,
  /\b(selesai|beres|sudah jalan|sudah diperbaiki)\b/i,
];

const EVIDENCE_TOOLS = new Set([
  'bash', 'powershell', 'pwsh', 'shell', 'exec_command', 'read', 'grep', 'glob', 'eval',
]);

/** @param {unknown} value */
function isObject(value) {
  return typeof value === 'object' && value !== null;
}

/** Last assistant text in a message list, or ''. */
function lastAssistantText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isObject(message) || message.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block) => isObject(block) && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      if (text.trim() !== '') return text;
    }
  }
  return '';
}

/** Block types that carry a tool call — every spelling the harnesses emit. */
const TOOL_BLOCK_TYPES = new Set(['tool-call', 'tool_use', 'toolCall']);

/**
 * Tool names used anywhere in the message list.
 *
 * Origin 2026-10-25 (audit-run-blockers #12, measured): this knew only
 * `tool_use`/`toolCall`, so pi's own `toolCall` was fine but dsh's `tool-call`
 * was not — and a turn that HAD run its tests was still flagged. Recognising
 * every spelling removes the false positive without weakening the gate (a turn
 * with no tool call at all is still flagged).
 */
function toolNamesIn(messages) {
  const names = new Set();
  if (!Array.isArray(messages)) return names;
  for (const message of messages) {
    if (!isObject(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isObject(block)) continue;
      if (typeof block.name === 'string' && TOOL_BLOCK_TYPES.has(block.type)) {
        names.add(block.name.toLowerCase());
      }
    }
  }
  return names;
}

/**
 * @param {unknown} pi
 */
export default function factory(pi) {
  let floorInjected = false;
  let needsFloorAfterCompact = false;

  pi.on('session_start', () => {
    floorInjected = false;
    needsFloorAfterCompact = false;
  });

  pi.on('session_compact', () => {
    // The compacted session lost the floor from its visible context.
    needsFloorAfterCompact = true;
  });

  pi.on('before_agent_start', (event, ctx) => {
    try {
      const cwd = ctx?.cwd || process.cwd();
      const base = typeof event?.systemPrompt === 'string' ? event.systemPrompt : '';
      const parts = [];

      if (!floorInjected || needsFloorAfterCompact) {
        const resolved = resolveFloor(cwd);
        if (resolved) {
          parts.push(
            'trust-no-agent — the router is installed and active in this session. These rules are ' +
              `quoted from the router at ${resolved.source}:\n\n${resolved.floor}\n\n` +
              'No performative agreement or performative refusal: agreement is a technical claim + ' +
              'evidence (file:line, fresh output), dissent is a technical reason + alternative. A ' +
              'bare `sudah/hapus/beres` with no artifact in the same turn is a rumor, never a receipt.',
          );
          floorInjected = true;
          needsFloorAfterCompact = false;
        }
      }

      const prompt = typeof event?.prompt === 'string' ? event.prompt : '';
      const notice = buildPromptNotice(prompt);
      if (notice) parts.push(notice);
      if (!parts.length) return;

      const injected = parts.join('\n\n');
      return { systemPrompt: base === '' ? injected : `${base}\n\n${injected}` };
    } catch {
      /* fail-open */
    }
  });

  pi.on('agent_before_settle', (event) => {
    try {
      const messages = event?.messages ?? event?.context?.contextMessages;
      const text = lastAssistantText(messages);
      if (text === '') return;

      const claim = CLAIM_PATTERNS.map((re) => re.exec(text)?.[0]).find(Boolean);
      if (!claim) return;

      const evidence = [...toolNamesIn(messages)].filter((name) => EVIDENCE_TOOLS.has(name));
      if (evidence.length > 0) return; // the turn did something checkable

      const mode = String(process.env.DONE_GATE_ENFORCE || 'block').trim().toLowerCase();
      if (mode === 'off' || mode === 'false' || mode === '0') return;

      const notice = [
        '## receipts gate — completion claim with no verification in this turn',
        '',
        `This turn's closing text asserts completion (matched: "${claim}"), but no tool call ran in`,
        'this turn that could be its evidence. The `receipts` skill is explicit: the verification',
        'command must run in THIS message — "a run from an earlier message proves nothing about the',
        'current state."',
        '',
        'Either:',
        '- run the proof command now and cite its output, or',
        '- state plainly which part is unverified and why the claim still holds.',
        '',
      ].join('\n');

      if (mode === 'warn') {
        return { entries: [{ type: 'custom_message', customType: 'tna-receipts-gate', content: notice, display: true }] };
      }
      return { continue: true, entries: [{ type: 'custom_message', customType: 'tna-receipts-gate', content: notice, display: true }] };
    } catch {
      /* fail-open */
    }
  });
}
