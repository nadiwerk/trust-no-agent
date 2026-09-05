#!/usr/bin/env node
/**
 * trust-no-agent skill evals — static tier.
 * Pure Node, zero dependencies. Run: node scripts/eval.mjs
 * Exit 0 = consistent. Exit 1 = drift found.
 *
 * Checks (semantics validate.mjs does not cover):
 *  1. Invocation axis consistency for every skill:
 *     - user-invoked skills: SKILL.md frontmatter has disable-model-invocation: true
 *       AND agents/openai.yaml has allow_implicit_invocation: false
 *     - model-invoked skills: neither flag present
 *  2. README skills tables declare the same axis per skill.
 *  3. Descriptions are trigger-shaped (soft check → WARN, never ERROR).
 *  4. Deterministic-picker gates present in quality-gate skills.
 *  5. Mechanical-seam markers present (soft check → WARN).
 *  6. MANDATORY discipline skills enforced in the router (HARD check → ERROR):
 *     6a trigger-matrix row carries the MANDATORY marker, 6b the delegation
 *     contract forces load_skills, 6c each skill's own body carries its Iron Law.
 *  7. Test-writing is never `fast` (HARD check → ERROR).
 *  8. Canonical-ledger contract present in ship-log + router (HARD → ERROR).
 *  9. Operational-claims class present in receipts + make-it-so (HARD → ERROR).
 * 10. Memory-modes doctrine present in design.md + ship-log (HARD → ERROR).
 * 11. Instruction trust-boundary rule present in SECURITY.md (HARD → ERROR).
 * 12. Spec gate present: save-as acceptance criteria + adversarial self-review,
 *     fork-it traceability gate, expect-fail acceptance-test Iron Law, router
 *     gate line (HARD → ERROR). Upstream gate: specifications are proven
 *     testable BEFORE fork-it slices them, class `loop` only.
 * 13. Canonical large-feature chain identical in WORKFLOW.md, AGENTS.md,
 *     docs/skills/README.md (+ root README), with explicit scribe/classify
 *     placement rules in WORKFLOW.md rule 2 (HARD → ERROR).
 * 14. Trigger matrix routes auto-classified large features to `breakpoint`
 *     (HARD → ERROR).
 * 15. fork-it publish gate runs the ticket-graph validator (HARD → ERROR).
 * 16. Recovery index present in ship-log (HARD → ERROR): one-line-per-entry
 *     index at .trust/index.md, read first on recovery, trimmed by rotation.
 * 17. Reflection-at-rotation + Tags line present in ship-log (HARD → ERROR):
 *     rotation scans for recurring patterns and surfaces rule-inheritance
 *     candidates to the user; every entry carries a Tags line for grepability.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');

// Canonical axis — must match README's "Invoked by" tables (repo decision, ledger 2026-08-30).
const USER_INVOKED = new Set(['scribe', 'save-as', 'fork-it', 'make-it-so']);

const errors = [];
const warns = [];
const err = (msg) => { errors.push(msg); console.log('ERROR ' + msg); };
const warn = (msg) => { warns.push(msg); console.log('WARN  ' + msg); };

if (!existsSync(SKILLS)) { err('missing skills/ directory'); process.exit(1); }

const declared = new Map(); // name -> { axis, cat }
for (const cat of readdirSync(SKILLS).filter((d) => statSync(join(SKILLS, d)).isDirectory())) {
  for (const skill of readdirSync(join(SKILLS, cat))) {
    const dir = join(SKILLS, cat, skill);
    if (!statSync(dir).isDirectory()) continue;
    const fm = readFileSync(join(dir, 'SKILL.md'), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) { err(`no frontmatter: ${cat}/${skill}`); continue; }
    declared.set(skill, { axis: USER_INVOKED.has(skill) ? 'user' : 'model', cat, fm: fm[1] });
  }
}

// Full SKILL.md body of a declared skill (frontmatter included), or '' if missing.
const skillBody = (name) => {
  for (const [n, { cat }] of declared) if (n === name) {
    const p = join(SKILLS, cat, n, 'SKILL.md');
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  return '';
};

// ---- 1. frontmatter + openai.yaml flags match the canonical axis ----
for (const [name, { axis, cat, fm }] of declared) {
  const wantsDisable = axis === 'user';
  const hasDisable = /^disable-model-invocation:\s*true$/m.test(fm);
  if (wantsDisable !== hasDisable)
    err(`${cat}/${name}: disable-model-invocation should be ${wantsDisable} (axis: ${axis}-invoked), found ${hasDisable}`);

  const yamlPath = join(SKILLS, cat, name, 'agents', 'openai.yaml');
  if (!existsSync(yamlPath)) { warn(`${cat}/${name}: no openai.yaml to check allow_implicit_invocation`); continue; }
  const yaml = readFileSync(yamlPath, 'utf8');
  const hasNoImplicit = /allow_implicit_invocation:\s*false/.test(yaml);
  if (wantsDisable && !hasDisable) continue; // frontmatter error already reported
  if (wantsDisable !== hasNoImplicit)
    err(`${cat}/${name}: openai.yaml allow_implicit_invocation: false should be ${wantsDisable}, found ${hasNoImplicit}`);
}

// ---- 2. README tables agree ----
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
for (const m of readme.matchAll(/\| `([a-z-]+)` \| (user|model) \|/g)) {
  const [, name, axis] = m;
  if (!declared.has(name)) { err(`README declares unknown skill: ${name}`); continue; }
  if (declared.get(name).axis !== axis)
    err(`README says "${name}" is ${axis}-invoked, canonical axis is ${declared.get(name).axis}-invoked`);
}
for (const name of USER_INVOKED)
  if (!new RegExp(`\\| \\\`${name}\\\` \\| user \\|`).test(readme))
    err(`README skills table missing user-invoked skill: ${name}`);

// ---- 3. descriptions are trigger-shaped (soft) ----
const TRIGGER_CUE = /(use when|use after|use before|use if|whenever|when the user|when a|when you|trigger|must use|sebelum|saat|ketika)/i;
for (const [name, { cat, fm }] of declared) {
  const desc = fm.match(/^description:\s*(.+)$/m)?.[1] ?? '';
  if (desc.length < 20) warn(`${cat}/${name}: description very short (${desc.length} chars)`);
  else if (!TRIGGER_CUE.test(desc)) warn(`${cat}/${name}: description has no trigger cue (reads like a summary?)`);
}

// ---- 4. deterministic-picker gates present in the quality-gate skills (soft) ----
// Deterministic-picker doctrine: quality gates commit to categorical features,
// never free-form verdicts.
const PICKER_GATES = new Map([
  // receipts: the "fail-first proven" boolean is the mechanical seam that lets
  // a hook/CI gate enforce the discipline even when the model would skip it —
  // a claim about new production behavior without it is an opinion, not a receipt.
  ['receipts', /## Categorical gate \(deterministic picker\)/],
  ['ship-log', /loggable only when every dimension is answered/],
  ['roast-my-code', /from this closed set/],
]);

// Mechanical-seam markers: a skill may declare that a condition is checked
// mechanically (see the rule "encode it twice — prose + mechanical check").
// If the prose marker is dropped, the mechanical check below fails, so the
// discipline cannot silently regress into a soft self-assessment.
const MECHANICAL_SEAMS = new Map([
  ['receipts', ['fail-first proven', 'mechanical seam']],
]);
for (const [name, re] of PICKER_GATES) {
  const text = skillBody(name);
  if (!text) { warn(`${name}: skill not found for picker-gate check`); continue; }
  if (!re.test(text)) warn(`${name}: missing deterministic-picker gate (${re.source})`);
}

// ---- 5. mechanical-seam markers present (soft) ----
// A skill that declares a mechanical seam must keep the prose marker that names
// it. Dropping the marker is how a discipline silently regresses into a soft
// self-assessment; this check makes that regression visible.
for (const [name, markers] of MECHANICAL_SEAMS) {
  const text = skillBody(name);
  if (!text) { warn(`${name}: skill not found for mechanical-seam check`); continue; }
  for (const marker of markers) {
    if (typeof marker === 'string' && !text.includes(marker))
      warn(`${name}: missing mechanical-seam marker "${marker}"`);
    else if (marker instanceof RegExp && !marker.test(text))
      warn(`${name}: missing mechanical-seam marker ${marker}`);
  }
}

// ---- 6. MANDATORY discipline skills enforced in the router (HARD) ----
// Self-trigger is proven unreliable (evals: 0/3 fresh agents loaded the skill
// when the scenario demanded it). The router must therefore make the three
// Iron-Law discipline skills MANDATORY, not advisory — and the delegation
// contract must force load_skills into subagents. This check is HARD (ERROR,
// not WARN) because dropping the mandate silently re-opens the exact gap the
// evals exposed: a model that "responds on the merits" instead of loading the
// skill. Encode twice: prose in AGENTS.md, this mechanical check for the boundary.
const MANDATORY_SKILLS = ['expect-fail', 'root-cause', 'receipts'];
const agentsText2 = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
for (const name of MANDATORY_SKILLS) {
  // 6a. the trigger-matrix row must carry the MANDATORY marker
  if (!new RegExp(`\\| .*\\| \\\`${name}\\\` \\*\\*MANDATORY\\*\\* \\|`).test(agentsText2))
    err(`AGENTS.md trigger matrix: \`${name}\` must be marked **MANDATORY** (self-trigger proven unreliable)`);
  // 6b. the delegation contract must force load_skills for it
  if (!new RegExp(`load_skills: \\["${name}"\\]`).test(agentsText2))
    err(`AGENTS.md delegation contract: missing forced load_skills: ["${name}"]`);
}

// 6c. each MANDATORY skill carries its own Iron Law in its body (HARD).
// The router mandate (6a) proves the skill is *named*, not that the skill
// *enforces* anything once loaded — a body that lost its Iron Law would still
// pass 6a. Depth check: every MANDATORY skill must contain the exact Iron Law
// sentence inside its own SKILL.md. Literal markers (like every other HARD
// check in this file); a regex loose enough to match paraphrases is loose
// enough to miss the real sentence.
const IRON_LAW_BODIES = new Map([
  ['expect-fail', 'NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST'],
  ['root-cause', 'NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST'],
  ['receipts', 'Receipts or it didn\'t happen'],
]);
for (const [name, marker] of IRON_LAW_BODIES) {
  const body = skillBody(name);
  if (!body) { err(`${name}: skill body not found for Iron-Law check`); continue; }
  if (!body.includes(marker))
    err(`${name}: body missing its own Iron Law ("${marker}") — router mandate without in-skill enforcement`);
}

// ---- 7. test-writing is never `fast` (HARD) ----
// Evals: an agent classified a test-writing task as `fast` and skipped the
// expect-fail skill, writing a tautological test. The router must therefore
// forbid `fast` for test-writing, or the fail-first discipline silently drops.
// Encode twice: prose in AGENTS.md §1, this mechanical check for the boundary.
if (!/Writing tests is never `fast`/.test(agentsText2))
  err('AGENTS.md §1: missing rule "Writing tests is never `fast`" (test-writing must be full/loop, never fast)');

// ---- 8. Canonical-ledger contract present (HARD) ----
// Proven empirically (2026-09-01): gitignored files do not exist in a fresh git
// worktree, so the framework's own parallel-writer model (fork-it: one worktree
// per writer; ship-log: ledger at <project>/.trust/) destroys every parallel
// ticket's ledger entry at worktree removal. ship-log must define the
// canonical-ledger + worktree-handoff contract and the router must point at it.
// Encode twice: prose in ship-log/AGENTS.md, this mechanical check for the boundary.
const shipLogText = readFileSync(join(SKILLS, 'meta', 'ship-log', 'SKILL.md'), 'utf8');
for (const marker of [/## Canonical ledger & worktree handoff/, /provisional/, /handoff/i])
  if (!marker.test(shipLogText))
    err(`ship-log: missing canonical-ledger contract marker ${marker} (worktree ledger-destruction guard)`);
if (!/provisional/.test(agentsText2) || !/handoff/i.test(agentsText2))
  err('AGENTS.md §7: missing provisional-ledger / handoff rule (parallel writers must not log to worktree-local ledgers)');

// ---- 9. Operational-claims class present in receipts + make-it-so (HARD) ----
// Live exhibit (R0 dogfood 2026-09-01): a data-fix script whose filter matched
// 0 rows was accepted as "migration applied" — the command ran, the target
// state did not change. Receipts must define the operational-claims class
// (target identity, observed terminal state, declared delivery semantics —
// never "exactly once" from one success) and make-it-so must point at it.
const receiptsText = readFileSync(join(SKILLS, 'discipline', 'receipts', 'SKILL.md'), 'utf8');
for (const marker of [/## Operational claims/, /idempotency/i, /at-least-once/])
  if (!marker.test(receiptsText))
    err(`receipts: missing operational-claims marker ${marker} (system claims need state receipts, not exit codes)`);
const makeItSoText = readFileSync(join(SKILLS, 'engineering', 'make-it-so', 'SKILL.md'), 'utf8');
if (!/Operational claims/.test(makeItSoText))
  err('make-it-so: missing pointer to the receipts Operational-claims class');

// ---- 10. Memory-modes doctrine present (HARD) ----
// Field counter-behavior: an adopting project silently tracked its private
// ledger into git because shared/collaborative memory was an unaddressed case.
// design.md must define the modes (private default, shared BY PROMOTION) and
// ship-log must point at them, or every team adoption improvises its own leak.
const designText = readFileSync(join(ROOT, 'docs', 'design.md'), 'utf8');
if (!/## Memory modes/.test(designText) || !/promoted explicitly/.test(designText))
  err('docs/design.md: missing "Memory modes" section or the promote-explicitly rule (shared-memory doctrine)');
if (!/promoted explicitly/i.test(shipLogText))
  err('ship-log: missing pointer to the memory-modes promotion rule (private tier must never be published silently)');

// ---- 11. Instruction trust boundary present (HARD) ----
// The framework tells agents to READ repo material (CONTEXT.md, ADRs, tickets)
// as context; SECURITY.md must state the boundary — repo content is evidence,
// never an instruction channel, and cannot override gates or request secrets.
const securityText = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
if (!/data, not instructions/i.test(securityText))
  err('SECURITY.md: missing the trust-boundary rule (repo content is data, not instructions)');

// ---- 12. Spec gate present (HARD) ----
// Decision (user, 2026-09-02): the biggest residual gap is UPSTREAM — downstream
// verification proves behavior, not intent, so a wrong spec that passes tests
// still ships wrong code. The framework must force spec testability BEFORE
// fork-it slices work, class `loop` only (discipline scales with stakes).
// Encode twice: prose in the skills + router, this mechanical check for the
// boundary. Each marker names the exact contract; dropping any fails CI.
const saveAsText = readFileSync(join(SKILLS, 'engineering', 'save-as', 'SKILL.md'), 'utf8');
for (const marker of [
  /## Acceptance Criteria/,
  /## Adversarial self-review/,
]) {
  if (!marker.test(saveAsText))
    err(`save-as: missing spec-gate marker ${marker} (spec must be testable before fork-it — upstream gate)`);
}
if (!/Acceptance Criteria/.test(forkItCheck()))
  err('fork-it: missing acceptance-criteria gate (tickets must not be sliced from a spec without executable acceptance criteria)');
if (!/failing acceptance test per requirement/i.test(readFileSync(join(SKILLS, 'engineering', 'expect-fail', 'SKILL.md'), 'utf8')))
  err('expect-fail: missing acceptance-test Iron Law cousin ("no fork-it without a failing acceptance test per requirement", class loop)');
if (!/No fork-it without executable acceptance criteria/.test(agentsText2))
  err('AGENTS.md chain section: missing spec-gate rule "No fork-it without executable acceptance criteria" (class loop)');

// fork-it is read here (after check #6 already read agentsText2) so both gates
// share one read pattern; inline helper keeps the marker block self-contained.
function forkItCheck() {
  return readFileSync(join(SKILLS, 'engineering', 'fork-it', 'SKILL.md'), 'utf8');
}

// ---- 13. Canonical large-feature chain identical across docs (HARD) ----
// Field exhibit (omx audit 2026-09-03, Required): the chain appeared as 6
// skills (WORKFLOW.md, AGENTS.md) vs 7 with a `classify` prefix
// (docs/skills/README.md, root README) — reconcilable readings, not provably
// one chain. The canonical chain is the 6 skill stages; classify is the router
// decision made BEFORE the chain (AGENTS.md §1), and scribe is the variant
// that replaces breakpoint+save-as (WORKFLOW.md rule 2). Every doc quotes the
// identical fenced chain line; dropping or rewording any fails CI.
const CANON_CHAIN = ['breakpoint', 'save-as', 'fork-it', 'make-it-so', 'roast-my-code', 'ship-log'];
const fencedChain = (text) => {
  const found = [];
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g))
    for (const line of m[1].split('\n')) {
      const nodes = line.split('→').map((s) => s.trim()).filter(Boolean);
      if (nodes.length > 1 && nodes.every((n) => /^[a-z][a-z-]*$/.test(n))) found.push(nodes);
    }
  return found;
};
for (const [label, text] of [
  ['WORKFLOW.md', readFileSync(join(ROOT, 'WORKFLOW.md'), 'utf8')],
  ['AGENTS.md', agentsText2],
  ['docs/skills/README.md', readFileSync(join(ROOT, 'docs', 'skills', 'README.md'), 'utf8')],
  ['README.md', readFileSync(join(ROOT, 'README.md'), 'utf8')],
]) {
  const chains = fencedChain(text);
  if (chains.length !== 1 || chains[0].join('|') !== CANON_CHAIN.join('|'))
    err(`${label}: must quote the canonical chain fenced verbatim — exactly one chain line [${CANON_CHAIN.join(' → ')}], found ${chains.length ? chains.map((c) => `[${c.join(' → ')}]`).join(', ') : 'none'}`);
}
const workflowText = readFileSync(join(ROOT, 'WORKFLOW.md'), 'utf8');
if (!/`?scribe`? replaces breakpoint and save-as/.test(workflowText))
  err('WORKFLOW.md rule 2: missing scribe-placement rule ("scribe replaces breakpoint and save-as" when decisions are recorded)');
if (!/classify sits before the chain/.test(workflowText))
  err('WORKFLOW.md rule 2: missing classify-placement rule ("classify sits before the chain" — router decision, not a stage)');

// ---- 14. Trigger matrix binds auto-classified large features to the chain (HARD) ----
// Audit premise check (finding 2.2): the large-feature row loading `breakpoint`
// EXISTS in the matrix — the real gap is nothing binds that row to the
// canonical chain, so matrix and chain can drift apart silently. The row must
// load `breakpoint` AND name the chain source.
if (!/\| Large feature about to start[^\n]*\|[^\n]*`breakpoint`/.test(agentsText2))
  err('AGENTS.md trigger matrix: missing large-feature row loading `breakpoint`');
if (!/\| Large feature about to start[^\n]*chain[^\n]*\|/.test(agentsText2))
  err('AGENTS.md trigger matrix: large-feature row must name the canonical chain (matrix↔chain binding — "chain: WORKFLOW.md rule 2")');

// ---- 15. fork-it publish gate runs the ticket-graph validator (HARD) ----
// Audit finding 3.1: a malformed ticket graph passed all repo gates. Local
// tickets published under .trust/<slug>/issues/ must pass scripts/tickets.mjs
// (blockers resolve, numbered blockers-first, acyclic) before work starts.
if (!/node scripts\/tickets\.mjs/.test(forkItCheck()))
  err('fork-it: missing publish gate running `node scripts/tickets.mjs` on the issues dir (ticket graph must validate: blockers resolve, acyclic)');

// ---- 16. Recovery index present in ship-log (HARD) ----
// Gap analysis vs yith-archive (2026-09-05, user-approved proposal #1): yith
// recovers via a context bundle (index-first); the ledger's recovery rule says
// "re-read the ledger", which reads every full entry. ship-log must define a
// one-line-per-entry recovery index at .trust/index.md — title + date + status
// (open/closed) — read FIRST on recovery, then specific entries; rotation
// trims the index in lockstep. Encode twice: prose in ship-log, this
// mechanical check for the boundary.
for (const marker of [
  /## Recovery index/,
  /\.trust\/index\.md/,
  /one line per entry/i,
  /read the index first/i,
])
  if (!marker.test(shipLogText))
    err(`ship-log: missing recovery-index marker ${marker} (recovery must be index-first, not full-ledger scan)`);

// ---- 17. Reflection-at-rotation + Tags line present (HARD) ----
// yith-adapt proposals #2 and #3 (2026-09-05, user-approved). #2: yith's
// mem::patterns/reflect surface recurring patterns as rule candidates — the
// ledger's rotation step already reads every older entry, so that is where a
// pattern scan belongs; recurring pain must surface as rule-inheritance
// candidates to the USER (rule-inheritance.md: entry is gated, user-decided),
// never auto-landed as a router rule. #3: yith tags memories for retrieval;
// the ledger equivalent is a per-entry `Tags:` line — grep is the
// markdown-native recall (AGENTS.md §8 lookup ladder). Encode twice: prose in
// ship-log, this mechanical check for the boundary.
if (!/## Reflection at rotation/.test(shipLogText))
  err('ship-log: missing "## Reflection at rotation" section (rotation must scan for recurring patterns and surface rule-inheritance candidates to the user)');
if (!/rule-inheritance/i.test(shipLogText))
  err('ship-log: reflection section must name rule-inheritance as the destination of recurring findings (candidates go to the user, never auto-landed)');
if (!/^- Tags: .+$/m.test(shipLogText))
  err('ship-log: Log Format missing a "Tags: " line (per-entry tags make the ledger grep-retrievable)');

// ---- summary ----
if (errors.length) { console.error(`\nFAIL: ${errors.length} consistency error(s), ${warns.length} warning(s).`); process.exit(1); }
console.log(`OK: ${declared.size} skills, invocation axis consistent (${USER_INVOKED.size} user-invoked, ${declared.size - USER_INVOKED.size} model-invoked), ${warns.length} warning(s).`);