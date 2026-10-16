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
 * 18. Lesson capture enforced in receipts + enforced by doctor (HARD →
 *     ERROR): receipts (MANDATORY) demands the lesson before accepting a
 *     repair's done; doctor warns during the grace period and FAILS once
 *     grace is exhausted — the corrective tier is mandatory, not optional.
 * 19. Proposal handoff present in AGENTS.md §3 (HARD → ERROR): the model
 *     proposes the next chain step by name and waits for approval — a
 *     user-invoked chain never stalls because the user didn't know the way.
 * 20. Registry check never skipped by `fast` classification (HARD → ERROR):
 *     before answering, the skill registry is checked once and a matching
 *     skill — trust-no-agent's own or an external one — is proposed by name,
 *     regardless of class. Probe evidence (2026-09-06, 2 runs): teaching
 *     requests classified `fast` were answered without ever considering the
 *     registry — correct-looking output from general judgment, matching skill
 *     never consulted; same invisible-failure pattern as self-trigger (6),
 *     one layer earlier: the classification step itself hides the gap.
 * 21. Verify the artifact the user reads, never a proxy (HARD → ERROR):
 *     the router must carry the wrong-target rule — rendered-page claims are
 *     verified live (curl/open the deployed URL), committed-content claims
 *     via `git show`. Evidence (session 2026-09-09): 3× false "done" — the
 *     pushed commit was checked while the user read the GitHub Pages site,
 *     which carries its own copy of the text; a green receipt against the
 *     wrong target proves nothing.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');

// Canonical axis — must match README's "Invoked by" tables (repo decision, ledger 2026-08-30).
const USER_INVOKED = new Set(['scribe', 'save-as', 'fork-it', 'make-it-so', 'setup-tna']);

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
// 6-ENG (Adaptation wave 1): the chain's engagement is a mechanical count,
// never a mood — self-trigger was proven unreliable (0/3). The router must
// carry the engagement criteria verbatim.
if (!/Engagement criteria \(mechanical, not felt\)/.test(agentsText2))
  err('AGENTS.md: missing the mechanical engagement criteria — the chain engages by count (files/boundary/design/unknown-cause), never by mood');
if (!/more than one file/.test(agentsText2) || !/never a mood/.test(agentsText2))
  err('AGENTS.md: engagement criteria must name the counts (more than one file / never a mood)');
for (const name of MANDATORY_SKILLS) {
  // 6a. the trigger-matrix row must carry the MANDATORY marker
  if (!new RegExp(`\\| .*\\| \\\`${name}\\\` \\*\\*MANDATORY\\*\\* \\|`).test(agentsText2))
    err(`AGENTS.md trigger matrix: \`${name}\` must be marked **MANDATORY** (self-trigger proven unreliable)`);
  // 6b. the delegation contract must force load_skills for it
  if (!new RegExp(`load_skills: \\["${name}"\\]`).test(agentsText2))
    err(`AGENTS.md delegation contract: missing forced load_skills: ["${name}"]`);
}

// 6c. each MANDATORY skill carries its own Iron Law in its body (HARD).
// (Restored below.)
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

// ---- 18. Lesson capture enforced + enforced by doctor (HARD) ----
// Gap (2026-09-05, user-approved): .trust/lessons.md had exactly one writer —
// the make-it-so repair loop, a USER-invoked skill. A user who never invokes
// make-it-so (or fixes bugs via the parallel root-cause path) never feeds the
// corrective tier, silently — the same trap as model self-trigger, inverted:
// dependence on user-trigger. Two closures: (a) receipts is MANDATORY (forced
// load_skills, loaded before any done claim), so it must demand the lesson
// before accepting a repair's done — the tier then rides a skill that cannot
// be skipped; (b) doctor.mjs must enforce a starving corrective tier:
// WARN during the grace period (measured from the oldest dated ledger entry),
// FAIL once grace is exhausted (decision logic: corrective-tier.mjs, tested
// by doctor.test.mjs). Encode twice: prose in receipts, this mechanical check.
const doctorText = readFileSync(join(ROOT, 'scripts', 'doctor.mjs'), 'utf8');
for (const marker of [
  /## Lesson capture/,
  /\.trust\/lessons\.md/,
  /before accepting a (fixed|done|repair)/i,
])
  if (!marker.test(receiptsText))
    err(`receipts: missing lesson-capture marker ${marker} (corrective tier must not depend on make-it-so being invoked)`);
for (const marker of [/lessons\.md/, /corrective/i, /checkStarve/, /corrective-tier\.mjs/, /grace/i])
  if (!marker.test(doctorText))
    err(`doctor.mjs: missing corrective-tier marker ${marker} (starving tier must WARN in grace, FAIL after — not stay silent)`);

// ---- 19. Proposal handoff present in the router (HARD) ----
// The user-invoked chain (save-as → fork-it → make-it-so) stalls whenever the
// user doesn't know the next skill — the same trap as model self-trigger,
// inverted: dependence on the user remembering the map. Closure: the agent
// proposes the concrete next step (skill by name, why now) after every chain
// stage and waits for approval. Encode twice: prose in AGENTS.md §3, this
// mechanical check for the boundary.
for (const marker of [/The model proposes, the user approves/, /skill by name, why now/])
  if (!new RegExp(marker.source).test(agentsText2))
    err(`AGENTS.md §3: missing proposal-handoff marker ${marker} (user-invoked chain must never dead-end on an uninformed user)`);

// ---- 20. Registry check never skipped by `fast` classification (HARD) ----
// Probe evidence (2026-09-06, 2 runs): fresh agents given teaching requests
// classified the task `fast` and answered directly — correct-looking output
// from general judgment, but the skill registry was never consulted, so the
// matching skill (teach, an external one) was never proposed. This is the
// self-trigger pattern (6) one layer earlier: the classification step itself
// hides the gap, because every downstream check assumed the registry was
// already considered. Closure: `fast` skips the chain, never the registry —
// a matching skill (trust-no-agent's own or external) is proposed by name and
// waits for approval, regardless of class. Encode twice: prose in AGENTS.md
// §1, this mechanical check for the boundary.
for (const marker of [/`fast` skips the chain, never the registry/, /propose it by name and wait for approval, regardless of class/])
  if (!new RegExp(marker.source).test(agentsText2))
    err(`AGENTS.md §1: missing fast-skips-chain-never-registry marker ${marker} (classification must not bypass the skill-registry check)`);

// ---- 21. Verify the artifact the user reads, never a proxy (HARD) ----
// Session evidence (2026-09-09): three consecutive "done" claims were verified
// against the pushed commit (`git show`) while the user was reading the GitHub
// Pages site — site/index.html carries its own copy of the text, so every
// receipt was green and every claim false for the object the user actually
// sees. A green receipt against the wrong target is a false receipt. Closure:
// the router carries the wrong-target rule — rendered-page claims verified
// live, committed-content claims via `git show`. Encode twice: prose in
// AGENTS.md §6, this mechanical check for the boundary.
for (const marker of [/Verify the artifact the user reads, never a proxy/, /A green receipt against the wrong target is a false receipt/])
  if (!new RegExp(marker.source).test(agentsText2))
    err(`AGENTS.md §6: missing wrong-target-verification marker ${marker} (claims about what the user reads must be verified on that target)`);

// ---- 22. Ledger audit enforced (HARD) ----
// Session evidence (2026-09-09): the `Loaded:` audit trail showed 47 entries
// for receipts and 0 for root-cause/expect-fail despite domain-relevant work,
// and site receipts verified CSS strings while the user read the rendered page
// (9 commits, 3 reverts on one block — Iron Law 1 context never confirmed).
// Closure: the ledger itself is audited mechanically (scripts/ledger-audit.mjs,
// tested fail-first by ledger-audit.test.mjs, surfaced by doctor C7).
if (!existsSync(join(ROOT, 'scripts', 'ledger-audit.mjs')))
  err('scripts/ledger-audit.mjs missing (Loaded:-gap / visual-gate / context-gap audit must exist)');
if (!existsSync(join(ROOT, 'scripts', 'ledger-audit.test.mjs')))
  err('scripts/ledger-audit.test.mjs missing (audit must be fail-first tested)');
const doctorFull = readFileSync(join(ROOT, 'scripts', 'doctor.mjs'), 'utf8');
if (!/ledger-audit/.test(doctorFull))
  err('doctor.mjs: ledger audit never surfaced (C7 must run auditLedger and report findings)');

// ---- 23. Visual-gate rule in the router (HARD) ----
// Site-iteration evidence (2026-09-08/09): every site receipt verified a CSS
// string in the deployed source while the acceptance target was the rendered
// page — rule #21's wrong-target failure mode, in a new form the check #21
// markers did not cover. The router must extend the rule to rendered-output
// claims: rendered evidence for rendered claims.
for (const marker of [
  /Rendered-output claims need rendered evidence/,
  /not a string match on the deployed source/,
])
  if (!new RegExp(marker.source).test(agentsText2))
    err(`AGENTS.md §6: missing visual-gate marker ${marker} (rendered claims need rendered evidence)`);

// ---- 24. Context-confirmation rule for owner visual feedback (HARD) ----
// Green-border saga evidence (2026-09-08/09): owner screenshots were treated
// as execution orders — fixes committed without confirming desktop-vs-mobile,
// which block, what symptom; 9 commits / 3 reverts on one block. Iron Law 1
// needs a written artifact (evals: initiative-based components fail silently).
// The restatement line "Context confirmed:" is that artifact — grepable in the
// ledger, audited by scripts/ledger-audit.mjs (M3).
for (const marker of [
  /Owner visual feedback is a context to confirm, not an order to execute/,
  /Context confirmed:/,
])
  if (!new RegExp(marker.source).test(agentsText2))
    err(`AGENTS.md §6: missing context-confirmation marker ${marker} (visual feedback must be restated and confirmed before the fix)`);

// ---- 25. Ship-log carries the Context-confirmation line (HARD) ----
// Iron Law 1's written artifact: fixes from owner visual feedback must carry a
// "Context confirmed:" restatement in the ledger (audited by ledger-audit M3),
// so ship-log's Log Format must teach the line — a format the logger never
// writes cannot be audited for. Eval check that the format + the audit stay
// wired together.
if (!/Context confirmed:/.test(shipLogText))
  err('ship-log: Log Format missing the "Context confirmed:" line (Iron Law 1 restatement artifact, audited by ledger-audit M3)');

// ---- 26. Chat-receipt skim test (HARD) ----
// Evidence (2026-09-10): a receipt whose Next block ends in a hanging offer
// ("want me to...?") leaves the reader without a concrete action, and a
// Verdict line that opens with context buries the result. The skim test is
// the cheap audit: a reader who reads ONLY the first line and the last line
// of the receipt must know (a) what happened and (b) what happens next.
// Encode twice: prose in docs/chat-receipt.md §Block rules, this mechanical
// check for the boundary. Delivery layer (2026-09-23, two owner findings in one
// session: fenced blocks rendered as clipped file cards; tight single-newline
// lines collapsed into one merged paragraph): the skim test dies at the render
// layer, so the delivery rules are part of the same boundary and guarded here.
const chatReceiptText = readFileSync(join(ROOT, 'docs', 'chat-receipt.md'), 'utf8');
for (const marker of [
  /Skim test/,
  /reads only the first line and the last line/,
  /Delivery: the receipt is plain chat text/,
  /Blocks are separated, not run together/,
])
  if (!new RegExp(marker.source).test(chatReceiptText))
    err('docs/chat-receipt.md: missing skim-test rule (first line = verdict/state, last line = one concrete next action)');

// ---- 27. Ship-log writes a per-entry date header (HARD) ----
// Writer/reader reconciliation (spec `.trust/ledger-audit-fix/spec.md`, 2026-09-12).
// ledger-audit.mjs and corrective-tier.mjs attach a date to each entry from a
// preceding `## YYYY-MM-DD` header; ship-log is the writer. Before this check,
// the writer emitted no date header at all, so the reader split on a marker that
// never existed — every real ledger audited as vacuously clean (zero findings
// because zero entries parsed, indistinguishable from a genuinely clean ledger).
// Encode twice: prose in ship-log's Log Format, this mechanical check for the
// boundary — the invariant cannot regress back to blindness silently.
for (const marker of [
  // The template itself: dated header directly above the entry heading (AC1's
  // "immediately preceding" — adjacency, not mere presence).
  /^## <YYYY-MM-DD>\s*\n\s*\n### Session Summary/m,
  // The prose contract, as a literal phrase (repo doctrine: literal markers,
  // not loose patterns — a loose /date header/i would pass on prose mention
  // alone even with the template header gone).
  /The date header is mandatory/,
])
  if (!marker.test(shipLogText))
    err(`ship-log: missing date-header marker ${marker} (the ledger writer must emit a dated header per entry, or the audit parses nothing and reports a blind "clean")`);

// ---- 28. Breakpoint question delivery is interactive-first (HARD) ----
// Owner standing order (2026-09-12): every user-facing question is delivered as
// an interactive structured prompt (per-question options with a recommended
// default) when the harness provides one, not as a prose wall the user must
// read linearly. The contract is harness-agnostic: interactive is the default
// channel, the numbered-and-recommended list is the documented fallback — the
// same split as every other portability boundary (docs/compatibility.md).
// Encode twice: prose in breakpoint, this mechanical check for the boundary.
const breakpointText = readFileSync(join(SKILLS, 'engineering', 'breakpoint', 'SKILL.md'), 'utf8');
for (const marker of [
  /## Question delivery/,
  /interactive/i,
  /numbered list with a recommended answer/i,
  /harness/i,
])
  if (!marker.test(breakpointText))
    err(`breakpoint: missing question-delivery marker ${marker} (user-facing questions must be interactive-first with a documented numbered fallback, not left to runtime initiative)`);

// ---- 29. The ledger reader accepts both writer shapes (HARD) ----
// Origin: 2026-09-19 stress test against a real 6-day adopter ledger (144 date
// headers, 71 commits). The audit was built and tested against ONE writer shape
// and produced 67 findings + 127 coverage gaps on a healthy ledger — ~95% of
// them artifacts of the reader. The second shape is not hypothetical: it is what
// an adopting project's router prescribes, so the reader must accept it or the
// audit becomes a false-signal generator in exactly the projects it was built
// for. Encode twice: prose in docs/installation.md §The ledger contract, this
// check for the boundary.
const installationText = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
for (const marker of [
  /## The ledger contract/,
  /— Rebrand X/, // the titled-header shape, shown literally
  /flat bullets/, // the heading-less entry shape
  /`progress\.txt` at the project root/, // the adopter ledger location
])
  if (!marker.test(installationText))
    err(`docs/installation.md: missing ledger-contract marker ${marker} (the two accepted ledger shapes must be documented where an adopter reads them)`);

// ---- 30. Doctor consumes the M4 blind-spot stat (HARD) ----
// `auditLedger` computed `stats.mandatoryMentions` and NOTHING read it — the
// component built to expose the 47-vs-0 blind spot was itself silently dead,
// which is the exact failure mode AGENTS.md §5 names ("components relying on
// runtime initiative fail silently; components backed by written artifacts
// work"). This check is the anti-dead-component guard: a refactor that orphans
// M4 again fails here instead of shipping quietly.
const doctorSrc = readFileSync(join(ROOT, 'scripts', 'doctor.mjs'), 'utf8');
// Match the CALL, not the identifier: an import line alone leaves the stat
// orphaned exactly as before (found by this check's own RED proof — the first
// version matched the import and stayed green with the consumer removed).
if (!/blindSpotWarning\s*\(\s*stats\s*\)/.test(doctorSrc))
  err('doctor.mjs: M4 blind-spot stat is not consumed (blindSpotWarning(stats) must be CALLED — a computed-but-unread stat is a dead component)');
if (!existsSync(join(ROOT, 'scripts', 'doctor-checks.mjs')))
  err('scripts/doctor-checks.mjs missing (hookVerdict / pickLedgerPath / blindSpotWarning decision logic must be testable outside doctor CLI)');

// ---- 31. The Claude Code install path wires the router's mechanical half (HARD) ----
// Origin: 2026-09-21 live install on Claude Code. The §[Claude Code] CLI section
// documented the @-import and the skill copy and never mentioned hooks — an
// install following the docs verbatim had the skills present and the router's
// mechanical half (session-start floor injection, mandatory-gate prompt
// classification) entirely absent, with no signal anything was missing. The
// same install was also a live demonstration of WHY the hook matters: the
// re-injection block it wires is the only mechanism that survived the
// half-floor bug becoming visible at all. Skills sit inert without the router
// (README: 0/3 self-trigger); the router without hooks is prose with no
// mechanical boundary. Encode twice: prose in docs/installation.md §[Claude
// Code] CLI, this check for the boundary. The markers name the artifacts an
// install must wire, so a docs edit that drops the wiring step fails here.
const ccInstallText = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
{
  const ccSection = ccInstallText.match(/### \[Claude Code\] CLI[\s\S]*?(?=\n### )/);
  if (!ccSection)
    err('docs/installation.md: §[Claude Code] CLI section missing');
  else {
    const s = ccSection[0];
    for (const [marker, why] of [
      [/hooks/, 'the Claude Code install path must wire the hook layer (SessionStart floor injection + UserPromptSubmit mandatory-gate classification) — skills + router prose alone leave the mechanical boundary unwired'],
      [/hooks\.json/, 'the hook wiring must reference hooks.json (the plugin/hook manifest), not just prose about hooks'],
      [/reinject/, 'the install must wire re-injection (compaction/resume guard) — a harness that drops AGENTS.md after compaction loses the discipline floor'],
      [/mandatory-gate|mandatory gate/i, 'the install must wire the mechanical MANDATORY-skill classifier, not rely on the model self-triggering (proven 0/3)'],
    ])
      if (!marker.test(s))
        err(`docs/installation.md §[Claude Code] CLI: missing "${marker}" — ${why}`);
  }
}

// ---- 32. The load_skills fallback is a countable artifact, not an appeal (HARD) ----
// Origin: 2026-09-27 cross-harness audit. §5 says a harness without a
// `load_skills` parameter "inject[s] the skill's procedure inline into the
// prompt instead (an unloaded skill is a dead skill)" — but check 6b above only
// guards the PARAMETERIZED path (`load_skills: ["x"]`). On a harness whose
// delegation tool has no such parameter (the audit found one: this repo's own
// Claude Code session), the primary layer cannot fire and the fallback is the
// only layer — unverifiable prose, which is the exact component class the
// framework's own evidence says fails silently (0/3 self-trigger).
//
// The fix is artifact-based, matching how every other discipline in this repo
// is made checkable: the injected procedure carries a `Loaded: <skill>` line in
// the delegation prompt, and the orchestrator verifies that line the way it
// verifies everything else. That turns "did you inject the skill inline?" from
// an appeal to a countable fact.
//
// This check guards the marker pair. It cannot verify that any individual
// delegation carried the line — no mechanical check can see inside another
// agent's prompt — so it is scoped honestly to what it proves: the contract
// names an artifact, so a delegation without one is a visible gap rather than
// an invisible one.
for (const [marker, why] of [
  [/inline procedure carries a `Loaded: <skill>` line/i,
    'the load_skills fallback must name a countable artifact (a `Loaded:` line in the injected prompt) rather than relying on the delegate to remember'],
  [/the delegation prompt carries it too/i,
    'the delegation-prompt half must be named: the subagent prompt carries the Loaded: line, not only the ledger entry after the fact'],
]) {
  if (!marker.test(agentsText2))
    err(`AGENTS.md §5 delegation contract: missing artifact-fallback marker ${marker} — ${why}`);
}

// ---- 33. The Log Format template teaches the two audited lines (HARD) ----
// Origin: 2026-09-29, M8 (lesson-gap) wiring. Both lines were already PROSE
// contracts with mechanical readers — the MANDATORY-skill audit trail (AGENTS.md
// §2 / ledger-audit M1) and the closing forward arrow (docs/chat-receipt.md
// rule 4 / ledger-audit M7) — but each had been dropped from the template at
// some point, and every entry written from the template inherited the omission.
// The result was a ledger that only LOOKED audited: seven of the repo's own
// entries in the 2026-09-15..21 window carry findings for exactly these two
// lines, while no check noticed the template was teaching a format the audit
// reads as a gap. A format the writer never emits cannot be audited for — the
// template is the writer's surface, so the invariant is guarded there.
//
// Matched against the Log Format TEMPLATE block, not the whole file: each line
// also carries an explanatory sentence elsewhere in the skill, and a prose hit
// would pass with the template stripped (the tautology class this repo has hit
// before). Encode twice: prose in ship-log's Log Format, this check for the
// boundary.
// The terminator is a column-0 `## ` heading that is NOT the template's own
// `## <YYYY-MM-DD>` placeholder — the first version used a bare `(?=\n## )`
// lookahead and the lazy match stopped at the template's own header line, so
// the block was 26 characters and the check was blind to the very lines it
// guards (caught 2026-09-29 by the RED run after the template was fixed:
// eval still reported both markers missing with them present).
const logFormat = shipLogText.match(/## Log Format[\s\S]*?(?=\n## (?!<YYYY-MM-DD>))/);
if (!logFormat)
  err('ship-log: "## Log Format" section missing (the ledger writer contract must live where the writer reads it)');
else
  for (const [marker, why] of [
    [/^- Loaded: /m,
      'the template must carry the "Loaded: " line — it is the MANDATORY-skill audit trail (AGENTS.md §2, ledger-audit M1); entries written from a template without it are flagged forever'],
    [/^- Next: /m,
      'the template must carry the "Next: " line — every close needs its forward arrow (docs/chat-receipt.md rule 4, ledger-audit M7); "none" is a value, a missing line is a finding'],
  ]) {
    if (!marker.test(logFormat[0]))
      err(`ship-log: Log Format missing ${marker} — ${why}`);
  }

// ---- 34. The ledger writer's template and the corrective tier agree (HARD) ----
// Origin: 2026-09-29. Two independent drifts met in one measurement: (a) the
// template stopped teaching the `Lesson:` line while ledger-audit.mjs M8 was
// reading it, and (b) a real adopter tier held 66 lessons with none dated and
// none in the documented form, so M8 could match nothing. The template is the
// writer's surface and the tier format is the reader's contract — both are
// guarded here, in the skill that owns them, so neither can drift silently
// again. The tier-shape half is a literal marker (the format string), matching
// repo doctrine: a loose /lesson/i would pass on prose about lessons.
if (!/^- Lesson:/m.test(shipLogText))
  err('ship-log: Log Format missing the "- Lesson:" line (a repair entry must record the lesson it produced, dated with the entry — ledger-audit.mjs M8 reads it)');
if (!/Lesson: root_cause = .*\| correction = .*\[YYYY-MM-DD\]/.test(shipLogText))
  err('ship-log: the corrective-tier format (Lesson: root_cause = … | correction = … [YYYY-MM-DD]) must be stated literally — an undated prose tier cannot be matched to the repair it taught (measured on a real adopter tier, 2026-09-29)');

// ---- 35. The delegation contract is an adapter matrix, not one API (HARD) ----
// Origin: hardening-general 2026-10-12 (the "dead API" crack — enforcement
// rode `load_skills`, which does not exist on Claude Code or opencode V2, so a
// minor harness upgrade broke the whole discipline layer). Check 6b guards the
// PARAMETERIZED path only; this check guards the matrix: AGENTS.md §5 must
// name the per-harness adapters (load_skills where it exists, veto hooks
// where it does not) and state that no single harness API carries
// enforcement. Fail-first proof: delete the matrix paragraph → RED here;
// restore → GREEN (spec AC9).
for (const [marker, why] of [
  [/adapter matrix/i,
    '§5 must name the enforcement adapter matrix — one harness API (load_skills) already died under the framework once'],
  [/tool\.execute\.before/,
    'the matrix must name the opencode veto adapter (tool.execute.before deny-by-throw)'],
  [/PreToolUse/,
    'the matrix must name the Claude/Codex pre-tool veto adapter'],
  [/No single harness API carries enforcement/,
    'the matrix must state the no-single-API rule literally — otherwise the next dead parameter silently becomes the only path again'],
]) {
  if (!marker.test(agentsText2))
    err(`AGENTS.md §5 adapter matrix: missing ${marker} — ${why}`);
}

// ---- 36. The veto guarantee is legible per harness, doc-first where unproven (HARD) ----
// Origin: hardening-general 2026-10-12 (AC5/AC10). An adopter deciding where
// to rely on the veto must read, per harness, veto vs audit-only — and
// harnesses without a live veto proof (omp, Devin) must be marked doc-first
// WARN, never hostable-by-assertion. Both docs carry the same table markers
// so neither can drift into promising what was never proven.
for (const [file, text] of [
  ['docs/compatibility.md', readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8')],
  ['docs/installation.md', readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8')],
]) {
  for (const [marker, why] of [
    [/veto vs audit-only/i,
      'the doc must carry a per-harness veto-vs-audit-only table — the guarantee differs by harness'],
    [/doc-first/i,
      'the doc must mark unproven harnesses doc-first — a veto without a live proof is a proposal, not a guarantee'],
    [/audit-only/i,
      'the doc must carry at least one explicit audit-only row — a harness with no veto wired must be named, not left to implication'],
  ]) {
    if (!marker.test(text))
      err(`${file}: missing veto-guarantee marker ${marker} — ${why}`);
  }
  // Row discipline (full-enforcement 04/AC8): a table ROW claiming veto-level
  // must name its proof status in the same row — `proven live` with its
  // receipt, or `live check open` as an honest IOU. A bare `veto` with
  // neither is how the table inflates itself one adjective at a time.
  // Rows whose level is audit-only/doc-first are out of this rule's scope
  // (their honesty marker is the level itself); rows merely mentioning the
  // word `veto` in passing are not claims.
  const compatRows = readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith('|'));
  for (const row of compatRows) {
    const cells = row.split('|').map((c) => c.trim());
    const level = cells[3] ?? '';
    if (/^veto\b/i.test(level) && !/proven live|live check open/i.test(row))
      err(`docs/compatibility.md: veto-level row names no proof status — ${row.slice(0, 90)}… (AC8: proven live, or live check open)`);
  }
}

// ---- 37. Onboarding hardening markers (HARD) ----
// Origin: newcomer-escalation ticket 01 (AC1/AC3/AC4/AC5). Each install step
// carries its one-line verification; adoption refuses dual-router setups;
// purge + sweep are documented; support starts from the doctor output.
// Prose without these markers rots silently — this check is the teeth.
{
  const installText = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
  for (const [marker, why] of [
    [/Verify:/,
      'each install step must carry its one-line verification (AC1)'],
    [/dual-router/i,
      'adoption must refuse dual-router setups by name (AC3)'],
    [/purge/i,
      'stale-skill purge must be documented (AC4)'],
    [/sweep/i,
      'the post-adoption sweep must be documented (AC4 — purge without sweep leaves dead names)'],
    [/doctor output first/i,
      'support must start from the doctor output (AC5)'],
  ]) {
    if (!marker.test(installText))
      err(`docs/installation.md: missing onboarding marker ${marker} — ${why}`);
  }
  // Region discipline (Spec-axis finding): a global /Verify:/ passes while
  // the changed steps carry none. The adoption region and the de-adoption
  // region each carry their own Verify: line, so coverage is positional,
  // not incidental.
  const adoptRegion = installText.slice(
    installText.indexOf('## Adopting into an existing project'),
    installText.indexOf('### De-adoption'),
  );
  const deadoptRegion = installText.slice(installText.indexOf('### De-adoption'));
  for (const [label, region] of [['adoption', adoptRegion], ['de-adoption', deadoptRegion]]) {
    if (!/Verify:/.test(region))
      err(`docs/installation.md: ${label} region carries no Verify: line — verification must sit on the changed steps (AC1), not only on veto rows`);
  }
}

// ---- 38. Remaining-harness verdicts (HARD) ----
// Origin: full-enforcement ticket 03 (AC4/AC5). Every harness without a veto
// carries a written verdict — OMO names why audit-only is its ceiling, and
// omp/Devin carry dated live-proof plans with a review-by date. A silent gap
// reads as an oversight; a dated verdict reads as an owned decision.
{
  const compatText = readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8');
  for (const [marker, why] of [
    [/OMO verdict/i,
      'OMO must carry a written verdict: veto adapter or why audit-only is the ceiling (AC4)'],
    [/live-proof plan/i,
      'omp/Devin must carry dated live-proof plans, not an open-ended doc-first (AC5)'],
    [/review-by 2026-11-13/i,
      'the live-proof plans need a review-by date, or doc-first has no expiry (AC5)'],
  ]) {
    if (!marker.test(compatText))
      err(`docs/compatibility.md: missing verdict marker ${marker} — ${why}`);
  }
}

// ---- 39. Every delegation brief binds VERIFY + TIMEBOX + PARTIAL (HARD) ----
// Origin: findings-adaptation ticket 02 (AC4; J2 9-field brief, adapted). Two
// failure modes the J2 corpus found: a brief with no exact verification
// command leaves "verified" to the delegate's judgement (fabricated done),
// and a brief with no timebox has no partial-return trigger (silent overrun
// or a stalled delegate nobody collects). Scoped to §5 AND to make-it-so's
// delegation section — the two surfaces that WRITE briefs — so a mention
// elsewhere cannot pass; the template-scoped doctrine of check 33. The
// filled-example marker is separate from the placeholders on purpose: AC4
// asks for a template AND satu contoh terisi, and a template alone teaches
// the shape without ever showing the substance.
{
  const briefStart = agentsText2.indexOf('## 5. Delegation discipline');
  const briefEnd = agentsText2.indexOf('## 6.');
  const briefRegion = briefStart >= 0 && briefEnd > briefStart
    ? agentsText2.slice(briefStart, briefEnd) : '';
  if (!briefRegion)
    err('AGENTS.md §5 delegation discipline section missing — the brief contract must live where briefs are written');
  else
    for (const [marker, why] of [
      [/VERIFY: </,
        'the brief template must carry the VERIFY field with an exact-command placeholder — "run the tests" is not a command'],
      [/TIMEBOX: </,
        'the brief template must carry the TIMEBOX field — an unbounded brief has no partial-return trigger'],
      [/PARTIAL: </,
        'the brief template must carry the PARTIAL field — the shape of what returns when the box expires'],
      [/VERIFY: node /,
        'the brief contract must ship one FILLED example (a concrete command), not only placeholders — AC4 asks for template + satu contoh terisi'],
    ]) {
      if (!marker.test(briefRegion))
        err(`AGENTS.md §5 brief contract: missing ${marker} — ${why}`);
    }
  for (const [marker, why] of [
    [/VERIFY:/, 'make-it-so writes briefs — its delegation section must name the VERIFY field'],
    [/TIMEBOX/, 'make-it-so must name TIMEBOX — the executor-side half of the contract'],
    [/PARTIAL/, 'make-it-so must name PARTIAL — the expiry-return shape'],
  ]) {
    if (!marker.test(makeItSoText))
      err(`make-it-so delegation section: missing ${marker} — ${why}`);
  }
}

// ---- 40. The autonomy ladder decays read-time, per harness (HARD) ----
// Origin: findings-adaptation ticket 03 (AC5, spec US5). Trust must never be
// grant-and-forget: the adopter-facing doc must state the rungs, the decay
// window, and that the level is COMPUTED at read time (no stored level to
// rot — the auto-downgrade state machine the spec rejected). Guarded where
// the adopter reads it, next to the very table the ladder parses.
{
  const compatText40 = readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8');
  for (const [marker, why] of [
    [/audit-only\s*→\s*veto-proven\s*→\s*trusted/,
      'the doc must name the three rungs in ladder order (spec US5)'],
    [/30-day|30 days|DECAY_DAYS/,
      'the doc must state the decay window — a ladder without a window is a grant-and-forget with nicer words'],
    [/read[- ]time/i,
      'the doc must state decay is computed at read time (nothing mutates the table; promotion needs fresh human proof)'],
    [/autonomy-ladder\.mjs/,
      'the doc must point at the CLI that computes the ladder, or the rule stays prose-only'],
  ]) {
    if (!marker.test(compatText40))
      err(`docs/compatibility.md autonomy ladder: missing ${marker} — ${why}`);
  }
  if (!existsSync(join(ROOT, 'scripts', 'autonomy-ladder.mjs')))
    err('scripts/autonomy-ladder.mjs missing — the ladder must be a computed verdict, not a table claim');
}

// ---- 41. Stale lessons are re-verified before they may gate (HARD) ----
// Origin: findings-adaptation ticket 04 (AC6, spec US6; corpus D11 stale-memory
// test). Memory that is never re-asserted against CURRENT behavior rots into
// either a stale prompt or a gate on a world that no longer exists. Guarded
// where the lesson is recalled (make-it-so §Lessons): the doctrine must
// name the probe CLI, the staleness window, the explicit execution sign-off,
// and the fail-closed rule — dead (probe contradicts today's tree) and
// unverifiable (no probe / undated / probes not run) lessons cannot gate
// live work. Markers are tested against the Lessons SECTION, not the whole
// file (roast 2026-10-13: a stray "deadline" elsewhere could satisfy the
// loose dead-verdict marker).
{
  const makeItSo41 = readFileSync(join(ROOT, 'skills', 'engineering', 'make-it-so', 'SKILL.md'), 'utf8');
  const lStart = makeItSo41.indexOf('## Lessons');
  const lEnd = makeItSo41.indexOf('\n## ', lStart + 1);
  const lessons41 = lStart === -1 ? '' : makeItSo41.slice(lStart, lEnd === -1 ? undefined : lEnd);
  for (const [marker, why] of [
    [/stale-probe\.mjs/,
      'the doctrine must point at the probe CLI, or staleness re-verification stays prose someone has to remember'],
    [/21[- ]day|21 days/,
      'the doctrine must state the staleness window — a probe with no window is run-at-will, not a rule'],
    [/--allow-exec/,
      'the doctrine must show the explicit execution sign-off — Probe lines are agent-authored text and must never run by default'],
    [/dead/i,
      'the doctrine must name the dead verdict (probe contradicts current behavior)'],
    [/cannot gate|can.?t gate|never gates|not be able to gate/,
      'the doctrine must say dead memory cannot gate live work (spec US6: dead memory cannot gate)'],
  ]) {
    if (!marker.test(lessons41))
      err(`make-it-so lessons section: missing ${marker} — ${why}`);
  }
  if (!existsSync(join(ROOT, 'scripts', 'stale-probe.mjs')))
    err('scripts/stale-probe.mjs missing — the staleness rule must be a computed verdict, not a memory');
}

// ---- 42. Bounded judgment is deterministic-first, judge-last, keyless (HARD) ----
// Origin: findings-adaptation ticket 05 (AC7, spec US7; corpus K6–K9). Guarded
// where judgment is described (the behavioral-eval tier — the repo's only
// judge-facing doc): bounded decisions must run free code first, consult the
// model judge once and last, carry no API key, and fail closed to
// `inconclusive` rather than pass. The seam itself must exist, so the rule
// cannot be prose about code nobody runs.
{
  const bevalReadme = readFileSync(join(ROOT, 'scripts', 'behavioral-eval', 'README.md'), 'utf8');
  for (const [marker, why] of [
    [/local-judge\.mjs/,
      'the doc must point at the judgment seam, or deterministic-first stays a suggestion'],
    [/deterministic[- ]first|deterministic graders first/i,
      'the doc must state graders run BEFORE the judge (K9: pre-check before the LLM judge)'],
    [/model judge (is )?(the )?last|last resort/i,
      'the doc must state the model judge is last resort, never the first opinion (K6)'],
    [/no API key|without an API key|API-key-free|keyless/i,
      'the doc must state judgment carries no API key (spec constraint: no model-judgment API keys)'],
    [/inconclusive/,
      'the doc must name the fail-closed verdict — a check that cannot run must say so, never pass (J4)'],
  ]) {
    if (!marker.test(bevalReadme))
      err(`scripts/behavioral-eval/README.md judgment section: missing ${marker} — ${why}`);
  }
  if (!existsSync(join(ROOT, 'scripts', 'local-judge.mjs')))
    err('scripts/local-judge.mjs missing — deterministic-first must be a computed ordering, not a slogan');
}

// ---- 43. Overlay composition: add-only, user:-marked, canonical-first (HARD) ----
// Origin: decision-composition ticket 05 (AC17; spec US7/US18/US25). Guarded
// where the mechanism is described for adopters (docs/installation.md): an
// overlay may add steps and never subtract gates (the add-only role set is
// named), the floor marks overlays `user:` (second-class), the canonical
// floor is emitted first and complete, and the mechanism is keyless with
// zero-dependency fail-open sessions. The seams must exist, so the rule
// cannot be prose about code nobody runs.
{
  const installDoc = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
  for (const [marker, why] of [
    [/overlay-registry\.mjs/,
      'the doc must point at the overlay registry seam, or composition stays a suggestion'],
    [/insert-before/,
      'the doc must name insert-before — the add-only role set is the mechanical floor on what an overlay may do'],
    [/insert-after/,
      'the doc must name insert-after — the add-only role set is the mechanical floor on what an overlay may do'],
    [/\bwrap\b/,
      'the doc must name wrap — the add-only role set is the mechanical floor on what an overlay may do'],
    [/user:/,
      'the doc must show the user: prefix — the floor marks overlays second-class, never shadowing canonical'],
    [/canonical.{0,40}(first|complete)|first and complete/i,
      'the doc must state the canonical floor is emitted first and complete — a broken overlay never degrades the core discipline'],
    [/keyless|no API key/i,
      'the doc must state the mechanism is keyless — no new API surface ships with the composition feature'],
    [/fail-open/,
      'the doc must state sessions fail open — a broken overlay never blocks the session'],
  ]) {
    if (!marker.test(installDoc))
      err(`docs/installation.md overlay section: missing ${marker} — ${why}`);
  }
  for (const seam of ['overlay-registry.mjs', 'floor-composer.mjs'])
    if (!existsSync(join(ROOT, 'scripts', seam)))
      err(`scripts/${seam} missing — composition must be a computed mechanism, not prose`);
}

// ---- 44. Onboarding: consent is real, mapping is consented, rollout is safe (HARD) ----
// Origin: onboarding ticket 10 (AC15; spec US1-US20). Guarded where the front
// door is described for adopters (docs/installation.md): the CLI named,
// per-component consent named, the declined-is-OFF rule named (consent that
// isn't real is decoration), the mapping scope named, the grandfather
// rollout named, and the undo mode named. The seam must exist, so the rule
// cannot be prose about code nobody runs.
{
  const installDoc = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
  for (const [marker, why] of [
    [/onboarding\.mjs/,
      'the doc must point at the onboarding CLI, or the front door stays undocumented'],
    [/consent per component|per component/,
      'the doc must state consent is per component (the granularity decision)'],
    [/mechanically OFF|declin\w+ (is )?OFF/,
      'the doc must state a declined component is mechanically OFF — consent that is not real is decoration'],
    [/maps your\s+installed skills/,
      'the doc must state the skill mapping scope (project + personal)'],
    [/grandfather/,
      'the doc must name the grandfather rollout — existing installs never break'],
    [/--map-only/,
      'the doc must name the re-scan mode'],
    [/--undo/,
      'the doc must name the reversal mode'],
  ]) {
    if (!marker.test(installDoc))
      err(`docs/installation.md onboarding section: missing ${marker} — ${why}`);
  }
  if (!existsSync(join(ROOT, 'scripts', 'onboarding.mjs')))
    err('scripts/onboarding.mjs missing — the front door must be a computed mechanism, not prose');
}

// ---- 45. Receipt enforcement: per-boolean, allowlist, veto, window (HARD) ----
// Origin: receipt-enforcement ticket 08 (AC13; spec US1-US15). Guarded where
// the receipt shape is documented (the receipts skill): the five booleans
// each carrying their own evidence (a blanket all-yes rejected by name),
// the repo-gate allowlist, the fast one-line receipt, the 14-day staleness
// window with re-verification before gating, and the commit veto on a
// receipt-less newest entry. The seam must exist, so the rule cannot be
// prose about code nobody runs.
{
  const receiptsSkill = readFileSync(join(ROOT, 'skills', 'discipline', 'receipts', 'SKILL.md'), 'utf8');
  for (const [marker, why] of [
    [/receipt-enforcement\.mjs/,
      'the skill must point at the enforcement seam, or the shape stays a suggestion'],
    [/each of the five booleans carrying its own evidence/,
      'the skill must state per-boolean evidence — a blanket all-yes is not a verdict'],
    [/blanket "all five hold" is not a verdict/,
      'the skill must reject the blanket verdict by name'],
    [/repo-gate allowlist/,
      'the skill must name the allowlist — "tests pass" is not evidence'],
    [/fast one-line receipt/,
      'the skill must state fast units carry a minimal receipt'],
    [/14 days|RECEIPT_STALE_DAYS/,
      'the skill must state the staleness window'],
    [/re-verif/,
      'the skill must state stale claims are re-verified before gating'],
    [/commit veto|veto denies/,
      'the skill must name the commit veto on a receipt-less newest entry'],
  ]) {
    if (!marker.test(receiptsSkill))
      err(`skills/discipline/receipts/SKILL.md receipt-enforcement section: missing ${marker} — ${why}`);
  }
  if (!existsSync(join(ROOT, 'scripts', 'receipt-enforcement.mjs')))
    err('scripts/receipt-enforcement.mjs missing — the receipt shape must be a computed check, not prose');
}

// ---- 46. /setup-tna: the chat front door is present, guarded, and honest (HARD) ----
// Origin: setup-command ticket 04; setup-as-skill ticket 01 moved the procedure
// into the skill body (single procedure source) and made the command a thin
// wrapper. The guards now live where the procedure lives: the wrapper must
// route to the skill, and the skill body must carry the machine contract
// (--from-chat, no-direct-.trust-write, no --yes, degrade path, doctor(-lite),
// byte-identical payload copies).
{
  const cmdFile = join(ROOT, '.opencode', 'command', 'setup-tna.md');
  if (!existsSync(cmdFile))
    err('.opencode/command/setup-tna.md missing — the chat front door must exist, not be prose');
  else {
    const cmdText = readFileSync(cmdFile, 'utf8');
    if (!/thin wrapper/i.test(cmdText))
      err('.opencode/command/setup-tna.md: must be a thin wrapper — the skill body is the single procedure source');
    if (!/setup-tna skill/i.test(cmdText))
      err('.opencode/command/setup-tna.md: must name the setup-tna skill it routes to');
    if (!/NEVER[^.]*\.trust\//i.test(cmdText) && !/ONLY writer of \.trust/i.test(cmdText))
      err('.opencode/command/setup-tna.md: wrapper must still surface the no-direct-.trust-write guard');
  }
  const skillBody = join(ROOT, 'skills', 'meta', 'setup-tna', 'SKILL.md');
  if (!existsSync(skillBody))
    err('skills/meta/setup-tna/SKILL.md missing — the onboarding procedure lives in the skill body (single source)');
  else {
    const skillText = readFileSync(skillBody, 'utf8');
    for (const [marker, why] of [
      [/--from-chat/,
        'the procedure must name the --from-chat flag — the CLI is the machine, the agent only forwards answers'],
      [/NEVER write[^.]*\.trust\//i,
        'the procedure must carry the no-direct-.trust-write guard — the agent is never the writer'],
      [/NEVER run `--yes`|never run `--yes`/i,
        'the procedure must forbid --yes without the human’s forwarded answers'],
      [/Degrade path|degrade path/,
        'the procedure must carry the honest degrade path for harnesses without a question mechanism'],
      [/doctor\.mjs|doctor-lite/,
        'the procedure must end with the doctor(-lite) run as the final proof'],
      [/byte-identical/i,
        'the router-copy step must demand byte-identical payload copies, never a retyped router'],
      [/explicit consent FIRST/i,
        'the router-copy step must gate on the human\u2019s explicit consent before writing into the project (Iron Law 4)'],
      [/harness is OpenCode|harness === 'opencode'|OpenCode tree/i,
        'the skill must state the OpenCode branch: the CLI copies the veto plugin when hooks are consented (veto-plugin-onboarding)'],
      [/verify[^.]*plugin install|already ships the veto|don.t re-wire|not re-wire/i,
        'the skill must carry the Claude Code/Codex branch: verify the plugin install ships the veto, never re-wire it'],
      [/audit-only/i,
        'the skill must carry the honest audit-only branch for harnesses without a hook API'],
      [/veto plugin is present|veto-plugin-present/i,
        'doctor-lite must include the veto-plugin-present check for OpenCode trees with hooks consent'],
      [/Forwarded[\s\S]{0,20}answers are the human.s, verbatim[\s\S]{0,60}never edits, fills, or[\s\S]{0,10}confirms/i,
        'the skill must name the --from-chat boundary: forwarded answers are the human\u2019s, verbatim; the agent never edits, fills, or confirms them (consent-boundary)'],
      [/STOP[^.]*copy over|never copy[^.]*over an existing/i,
        'the router-copy step must refuse to overwrite an existing project router (merge path instead)'],
    ]) {
      if (!marker.test(skillText))
        err(`skills/meta/setup-tna/SKILL.md: missing ${marker} — ${why}`);
    }
  }
}

// ---- 45a. The INCONCLUSIVE verdict is first-class (receipts skill) ----
// A verification that ran but proved nothing is INCONCLUSIVE — never a pass.
const receiptsSkill45 = readFileSync(join(ROOT, 'skills', 'discipline', 'receipts', 'SKILL.md'), 'utf8');
if (!/## The INCONCLUSIVE verdict/.test(receiptsSkill45))
  err('skills/discipline/receipts/SKILL.md: the INCONCLUSIVE verdict must be first-class — a verification that ran but proved nothing is never a pass');

// ---- 45b. Labeled claims + aggregate-report gate (Adaptation wave 1) ----
const chatReceipt45 = readFileSync(join(ROOT, 'docs', 'chat-receipt.md'), 'utf8');
if (!/Labeled claims/.test(chatReceipt45) || !/measured \/ inferred \/ guess/.test(chatReceipt45))
  err('docs/chat-receipt.md: missing the labeled-claims rule — every prose claim carries measured/inferred/guess in the same sentence');
const receipts45 = readFileSync(join(ROOT, 'skills', 'discipline', 'receipts', 'SKILL.md'), 'utf8');
if (!/## Labeled claims/.test(receipts45) || !/measured.*inferred.*guess/.test(receipts45))
  err('skills/discipline/receipts/SKILL.md: missing the labeled-claims section');
const agents46 = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
if (!/Aggregate-report gate/.test(agents46) || !/gap in the report never counts as a pass/.test(agents46))
  err('AGENTS.md: missing the aggregate-report gate — a delegated report without SHA(s)+method is dropped, and a gap never counts as a pass');

// ---- 45c. Blind reviewers + enforcement ladder (Adaptation wave 2) ----
const roastSkill45 = readFileSync(join(ROOT, 'skills', 'engineering', 'roast-my-code', 'SKILL.md'), 'utf8');
if (!/Blind reviewers \(never leak the parent's verdict\)/.test(roastSkill45))
  err('skills/engineering/roast-my-code/SKILL.md: missing the blind-reviewer rule — a reviewer that reads the parent verdict audits the verdict, not the diff');
if (!/inputs to verify[\s\S]{0,20}not the[\s\S]{0,20}conclusions drawn/.test(roastSkill45))
  err('skills/engineering/roast-my-code/SKILL.md: the blind-reviewer rule must say "pass the inputs to verify, not the conclusions drawn"');
const ruleInh46 = readFileSync(join(ROOT, 'docs', 'rule-inheritance.md'), 'utf8');
if (!/## The enforcement ladder/.test(ruleInh46))
  err('docs/rule-inheritance.md: missing the enforcement ladder — a rule lands at the highest level that works');
if (!/a rule with no enforcer is itself a\s+repeat failure/.test(ruleInh46))
  err('docs/rule-inheritance.md: the ladder must state "a rule with no enforcer is itself a repeat failure"');
if (!/proven to fail\s+on a real past mistake/.test(ruleInh46))
  err('docs/rule-inheritance.md: the ladder must require checks proven to fail on a real past mistake');

// ---- 47. setup-tna payload copies are byte-identical to the root sources (HARD) ----
// Origin: setup-as-skill ticket 02. The skill's payload (router, core rules,
// onboarding CLI) rides the skills CLI to adopters; a copy that drifts from
// the root source would ship a different framework than the repo's. Root is
// the single source of truth; the payload is a build artifact pinned to it.
{
  const pairs = [
    ['AGENTS.md', 'skills/meta/setup-tna/references/AGENTS.md'],
    ['WORKFLOW.md', 'skills/meta/setup-tna/references/WORKFLOW.md'],
    ['scripts/onboarding.mjs', 'skills/meta/setup-tna/scripts/onboarding.mjs'],
  ];
  for (const [src, dst] of pairs) {
    if (!existsSync(join(ROOT, dst))) { err(`payload copy missing: ${dst} — the setup-tna skill must carry its payload (setup-as-skill ticket 02)`); continue; }
    const a = readFileSync(join(ROOT, src));
    const b = readFileSync(join(ROOT, dst));
    if (!a.equals(b))
      err(`payload copy drifted: ${dst} is NOT byte-identical to ${src} — root is the source of truth; re-copy, never hand-edit`);
  }
}

// ---- 48. Fresh-install signature -> propose setup-tna (HARD) ----
// Origin: setup-as-skill ticket 03. A half-installed framework (skills present,
// router/stamp missing) underperforms silently - self-trigger 0/3 without the
// router. The agent must propose the setup-tna skill in that state; the model
// proposes, the user approves (Iron Law 4).
{
  const agents48 = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  if (!/Fresh-install signature . propose setup-tna/.test(agents48))
    err('AGENTS.md: missing the fresh-install mandatory-recommendation rule (propose setup-tna when skills are present but the router/stamp is not)');
  if (!/The model proposes; the user approves/.test(agents48))
    err('AGENTS.md: the fresh-install rule must keep consent with the user (the model proposes, the user approves)');
}

// ---- summary ----
if (errors.length) { console.error(`\nFAIL: ${errors.length} consistency error(s), ${warns.length} warning(s).`); process.exit(1); }
console.log(`OK: ${declared.size} skills, invocation axis consistent (${USER_INVOKED.size} user-invoked, ${declared.size - USER_INVOKED.size} model-invoked), ${warns.length} warning(s).`);