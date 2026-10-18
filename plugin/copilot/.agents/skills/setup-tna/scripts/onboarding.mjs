#!/usr/bin/env node
/**
 * Onboarding — the first-run front door (onboarding spec; tickets 01/02
 * here, CLI flow in 03). Zero dependencies.
 *
 * Two pure seams plus the discovery scan:
 *   scanSkillDirs(roots)     — explicit roots -> discovered skills
 *   suggestTriggers(text)    — a skill's own title -> keyword candidates
 *   planOnboarding({...})    — discovered + canonical + existing ->
 *                              proposals / skipped / noted
 *   serializeStamp / parseStamp — the .trust/onboarding.json consent record
 *
 * The consent stamp is PRIVATE (.trust/, gitignored, per-machine): consent
 * is personal, the router stays tracked (per-repo). A missing or malformed
 * stamp parses as NO consent (null) — never partial consent; the doctor's
 * grandfather verdict handles the pre-stamp world.
 */
import { readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';

const STOPWORDS = new Set(['skill', 'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'how', 'what', 'when', 'your', 'you']);
const COMPONENTS = ['floor', 'hooks', 'overlays', 'evidenceGate'];

/**
 * Discover skills under explicit roots: each directory holding a SKILL.md
 * becomes { name, dir, text }. First root wins on name collision.
 */
export function scanSkillDirs(roots) {
  const found = [];
  const seen = new Set();
  for (const root of roots || []) {
    if (!root || !existsSync(root)) continue;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || seen.has(d.name)) continue;
      const skillFile = join(root, d.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      seen.add(d.name);
      found.push({ name: d.name, dir: join(root, d.name), text: readFileSync(skillFile, 'utf8') });
    }
  }
  return found;
}

/** Normalize a directory name to an overlay-registry identifier. */
function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Suggest trigger keywords from a skill's own title. A v1 heuristic —
 * title words minus stopwords, up to three. The spec's Open Questions
 * own the quality tuning; nothing lands without confirmation anyway.
 */
export function suggestTriggers(text) {
  const m = /^#\s+(.+)$/m.exec(String(text || ''));
  if (!m) return [];
  const words = m[1].toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 3);
}

/**
 * Compose the onboarding plan from a discovered list. Pure: the scan
 * result, the canonical names, and the existing overlay names are inputs.
 */
export function planOnboarding({ discovered = [], canonicalNames = new Set(), existingOverlays = new Set() }) {
  const proposals = [];
  const skipped = [];
  const noted = [];
  for (const skill of discovered) {
    const name = normalizeName(skill.name);
    if (!name) { skipped.push({ name: skill.name, why: 'not an identifier' }); continue; }
    if (canonicalNames.has(name)) { skipped.push({ name, why: 'canonical skill — the framework already provides it' }); continue; }
    if (existingOverlays.has(name)) { noted.push({ name, why: 'already registered as an overlay' }); continue; }
    proposals.push({ name, dir: skill.dir, triggers: suggestTriggers(skill.text) });
  }
  return { proposals, skipped, noted };
}

/** Serialize the consent stamp. Stable key order; 2-space JSON. */
export function serializeStamp({ components = {}, harness = '', routerVersion = '', did = {}, consentedAt, workflowChoice }) {
  return JSON.stringify({
    schema: 1,
    consentedAt: consentedAt || new Date().toISOString(),
    routerVersion,
    harness,
    workflowChoice: workflowChoice || undefined,
    components: Object.fromEntries(COMPONENTS.map((c) => [c, components[c] === true])),
    did,
  }, null, 1);
}

/**
 * Parse the consent stamp. Fail-closed: malformed input or a stamp with no
 * components object parses as null (no consent), never partial consent.
 */
export function parseStamp(text) {
  let obj;
  try { obj = JSON.parse(String(text || '')); } catch { return null; }
  if (!obj || typeof obj !== 'object' || !obj.components || typeof obj.components !== 'object') return null;
  // Fail-closed: every known component must be present as a boolean. A
  // serializer-produced stamp always carries all four; anything else is
  // malformed — no consent, never partial.
  if (!COMPONENTS.every((c) => typeof obj.components[c] === 'boolean')) return null;
  return {
    schema: obj.schema ?? 1,
    workflowChoice: typeof obj.workflowChoice === 'string' ? obj.workflowChoice : undefined,
    consentedAt: obj.consentedAt ?? null,
    routerVersion: obj.routerVersion ?? '',
    harness: obj.harness ?? '',
    components: Object.fromEntries(COMPONENTS.map((c) => [c, obj.components[c] === true])),
    did: obj.did && typeof obj.did === 'object' ? obj.did : {},
  };
}

// The CLI (consent flow, --map-only, --undo) lands with ticket 03.

// ---- CLI: the human front door (ticket 03) ----
// argv guard (the repo pattern): importing this module never runs the flow —
// consent is a human act, never an agent-driven one.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENT_LABELS = {
  floor: 'the session floor (Iron Laws + MANDATORY skills quoted into every session)',
  hooks: 'the mechanical hooks (session injection + commit veto before they run)',
  overlays: 'skill mapping (your installed skills proposed as overlays into the workflow)',
  evidenceGate: 'the evidence gate (a commit without fresh test evidence is vetoed)',
};

function canonicalSkillNames() {
  try {
    return new Set(readdirSync(join(ROOT, 'skills', 'engineering'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name));
  } catch { return new Set(); }
}

function detectHarness(cwd) {
  // Project-local signal FIRST: a tree carrying its own harness dir (.opencode,
  // .omp, .pi) is that harness's tree regardless of the user's home dirs
  // (several harnesses share a machine; the home checks below are the fallback,
  // not the authority).
  if (existsSync(join(cwd, '.opencode'))) return 'opencode';
  if (existsSync(join(cwd, '.omp'))) return 'omp';
  if (existsSync(join(cwd, '.pi'))) return 'pi';
  const home = homedir();
  if (existsSync(join(home, '.codex', 'config.toml'))) return 'codex';
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude';
  if (existsSync(join(home, '.claude'))) return 'claude';
  if (existsSync(join(home, '.omo'))) return 'omo';
  return 'unknown';
}

function readRouterVersion() {
  try {
    const m = /^## \[(\d+\.\d+\.\d+)\]/m.exec(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'));
    return m ? m[1] : '';
  } catch { return ''; }
}

function printBriefing() {
  console.log([
    'trust-no-agent onboarding — what changes in your sessions once you consent:',
    '',
    '  1. Every session starts with the discipline floor: the four Iron Laws and the',
    '     MANDATORY section, quoted verbatim from your router.',
    '  2. A commit without fresh test evidence is vetoed by the evidence gate.',
    '  3. Every work unit closes with a 4-block receipt (Verdict / Evidence / Open / Next).',
    '  4. Three skills load on their domain, not on self-trigger: expect-fail (before any',
    '     test or behavior-changing code), root-cause (before any fix), receipts (before',
    '     any done-claim).',
    '',
  ].join('\n'));
}

/** The per-harness briefing row, or the degrade note (ticket 09). */
export function harnessBriefing({ harness, compatText }) {
  if (!compatText)
    return 'Per-harness briefing: the compatibility table is not in this install (plugin payloads carry no docs/) — ask the repo for docs/compatibility.md to see what is mechanical on your harness.';
  const row = compatText.split('\n').find((l) => new RegExp(`\\|\\s*\\*{0,2}${harness}\\b`, 'i').test(l));
  if (!row) return `Per-harness briefing: no row found for "${harness}" in the compatibility table — ask the repo.`;
  return `Per-harness briefing (${harness}): ${row.replace(/\|/g, ' · ').trim()}`;
}

function readCompatText() {
  try { return readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8'); } catch { return null; }
}

function printCodexWarning() {
  console.log([
    'Codex note: Codex installs plugin hooks but SKIPS them until you trust them',
    '(~/.codex/config.toml records a trusted_hash per hook file). Until you do,',
    'the discipline floor will not be injected — the one-time trust step is yours,',
    'not automatable from here.',
    '',
  ].join('\n'));
}

function printExitAndUpdate() {
  console.log([
    'Leaving and updating:',
    '  - Leave cleanly: node scripts/onboarding.mjs --undo (removes the stamp and',
    '    the overlays onboarding created; pre-existing files stay untouched).',
    '  - Update: re-run the install, then node scripts/doctor.mjs — a stale',
    '    .trust/tna-version stamp is detected and named (the update itself is',
    '    your decision).',
    '',
  ].join('\n'));
}

function printRehearsal() {
  console.log([
    'First-task rehearsal (run this once, with your agent):',
    '  1. Ask the agent: "Read AGENTS.md. What are the four Iron Laws?" — it should',
    '     recite them.',
    '  2. Give it one small task and watch the receipt shape at the end — Verdict /',
    '     Evidence / Open / Next.',
    '',
  ].join('\n'));
}

function askConsent() {
  // Line-queue pattern: piped stdin delivers all lines before the async
  // loop registers its questions, and a question registered after 'close'
  // never fires — so lines are queued and never dropped, EOF resolves the
  // pending ask with null (fail-closed: a half-answered consent writes
  // nothing).
  const reader = makeLineReader();
  return (async () => {
    const answers = {};
    for (const c of COMPONENTS) {
      // Consent-boundary (spec AC1-AC2): an empty or unrecognized answer is
      // never consent — re-ask, max 3 attempts, then abort fail-closed.
      let granted = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const line = await reader.ask(`Enable ${COMPONENT_LABELS[c]}? [y/n] `);
        if (line === null) { reader.close(); return null; }
        const t = String(line).trim();
        if (t === '') { console.log('  Empty answer is not consent — answer y or n explicitly.'); continue; }
        if (/^y/i.test(t)) { granted = true; break; }
        if (/^n/i.test(t)) { granted = false; break; }
        console.log('  Unrecognized answer — answer y or n explicitly.');
      }
      if (granted === null) {
        reader.close();
        console.error('Consent refused after 3 unclear answers — nothing was written (fail-closed).');
        return null;
      }
      answers[c] = granted;
    }
    reader.close();
    return answers;
  })();
}

/** A never-drops-a-line stdin reader (the readline+pipe race, killed once). */
function makeLineReader() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  let waiter = null;
  rl.on('line', (l) => { if (waiter) { const w = waiter; waiter = null; w(l); } else lines.push(l); });
  rl.on('close', () => { if (waiter) { const w = waiter; waiter = null; w(null); } });
  return {
    ask: (prompt) => new Promise((resolve) => {
      process.stdout.write(prompt);
      const got = (line) => resolve(line);
      if (lines.length) got(lines.shift());
      else waiter = got;
    }),
    close: () => rl.close(),
  };
}

function discoveryRoots(cwd) {
  const home = homedir();
  return [
    join(cwd, 'skills'), join(cwd, '.agents', 'skills'), join(cwd, '.claude', 'skills'),
    join(cwd, '.cursor', 'skills'), join(cwd, '.opencode', 'skills'),
    join(home, '.agents', 'skills'), join(home, '.claude', 'skills'), join(home, '.omo', 'agent', 'skills'),
  ];
}

function existingOverlayNames(cwd) {
  try {
    return new Set(readdirSync(join(cwd, '.trust', 'skills-overlay'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name));
  } catch { return new Set(); }
}

/** Write an overlay registration: frontmatter + a pointer to the original. */
function writeOverlay(cwd, proposal) {
  const dir = join(cwd, '.trust', 'skills-overlay', proposal.name);
  mkdirSync(dir, { recursive: true });
  const fm = ['---', `name: ${proposal.name}`];
  if (proposal.triggers.length) fm.push(`triggers: ${proposal.triggers.join(', ')}`);
  fm.push('---');
  writeFileSync(join(dir, 'SKILL.md'), [
    ...fm,
    '',
    `# ${proposal.name}`,
    '',
    `This overlay registers the "${proposal.name}" skill into the trust-no-agent`,
    `workflow. The skill itself lives at: ${proposal.dir}`,
    '',
    'This file is the registration (triggers + explicit invocation), not a copy —',
    'load the original skill from that path. Anchors (extends/role) attach later',
    'via the derived canonical catalog.',
  ].join('\n'));
}

/**
 * The mapping phase (ticket 04): discover, plan, confirm, write. `--yes`
 * and `--map-only` accept every proposal without prompting; the
 * interactive path asks per proposal.
 */
async function mapPhase(cwd, { yes, onlySkills } = {}) {
  const discovered = scanSkillDirs(discoveryRoots(cwd));
  const plan = planOnboarding({
    discovered,
    canonicalNames: canonicalSkillNames(),
    existingOverlays: existingOverlayNames(cwd),
  });
  const written = [];
  for (const p of plan.proposals) {
    // --from-chat carries the human's confirmed skill names; only those land.
    if (onlySkills && !onlySkills.includes(p.name)) continue;
    let ok = yes;
    if (!yes) {
      const reader = makeLineReader();
      const line = await reader.ask(`Map "${p.name}"${p.triggers.length ? ` (suggested triggers: ${p.triggers.join(', ')})` : ''} into the workflow? [Y/n] `);
      reader.close();
      ok = line !== null && (String(line).trim() === '' || /^y/i.test(String(line).trim()));
    }
    if (ok) { writeOverlay(cwd, p); written.push(p.name); }
  }
  return { discovered: discovered.length, plan, written };
}

function printReceipt({ components, routerVersion, harness, stamped, mapResult, hooksPathSet, consentSource }) {
  const yes = (k) => (components[k] ? 'consented' : 'declined (mechanically OFF)');
  console.log('');
  console.log('Receipt');
  console.log(`  Consented: floor=${yes('floor')} hooks=${yes('hooks')} overlays=${yes('overlays')} evidence-gate=${yes('evidenceGate')} (router ${routerVersion || 'unknown'}, harness ${harness})`);
  console.log(`  Mapped: ${stamped ? 'stamp written to .trust/onboarding.json' : 'no stamp written (aborted)'}${mapResult ? ` — ${mapResult.discovered} discovered, ${mapResult.written.length} written (${mapResult.written.join(', ') || 'none'}), ${mapResult.plan.skipped.length} skipped, ${mapResult.plan.noted.length} already registered` : ''}`);
  if (consentSource) console.log('  Consent source: ' + consentSource);
  console.log(hooksPathSet === true
    ? '  Pending: none — hooks wired (core.hooksPath=scripts/hooks).'
    : '  Pending: hooks wiring was declined — the mechanical hooks stay OFF (consent is real).');
  console.log('  Next: ask your agent to read AGENTS.md and recite the four Iron Laws; then run /setup-tna in your chat session (or node scripts/onboarding.mjs --map-only) when new skills appear.');
}

async function main() {
  const args = process.argv.slice(2);
  const cwd = process.cwd();

  // --undo: reverse exactly what onboarding did (ticket 06).
  if (args.includes('--undo')) {
    const stampPath = join(cwd, '.trust', 'onboarding.json');
    let stamp = null;
    try { stamp = parseStamp(readFileSync(stampPath, 'utf8')); } catch { /* no stamp */ }
    if (!stamp) {
      console.log('Nothing to undo — no consent stamp (this tree was never onboarded).');
      process.exit(0);
    }
    const removed = { overlays: [], hooksPath: false };
    for (const rawName of stamp.did.overlays || []) {
      // The stamp is an on-disk file treated as untrusted here: an overlay name
      // must survive a normalizeName round-trip EXACTLY (the same whitelist the
      // write path used) before any rmSync touches the filesystem — otherwise a
      // tampered stamp ("overlays": ["../.."]) deletes arbitrary directories.
      const name = normalizeName(rawName);
      if (!name || name !== String(rawName)) {
        console.log('Skipping suspicious overlay name in stamp: ' + JSON.stringify(String(rawName).slice(0, 40)));
        continue;
      }
      const dir = join(cwd, '.trust', 'skills-overlay', name);
      if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); removed.overlays.push(name); }
    }
    // The veto plugin is removed only when THIS onboarding copied it
    // (did.vetoPluginCopied) — a pre-existing or user-created plugin copy
    // (vetoPluginCopied false/absent) is never touched.
    if (stamp.did.vetoPluginCopied === true) {
      const vetoDir = join(cwd, '.opencode', 'plugins', 'tna-gate');
      if (existsSync(vetoDir)) { rmSync(vetoDir, { recursive: true, force: true }); }
      console.log('Veto plugin: removed .opencode/plugins/tna-gate (it was copied by onboarding).');
    }
    if (stamp.did.vetoHookCopiedOmp === true) {
      const vetoOmp = join(homedir(), '.omp', 'agent', 'hooks', 'pre', 'tna-veto.ts');
      if (existsSync(vetoOmp)) { rmSync(vetoOmp, { force: true }); console.log('Veto hook (omp): removed ~/.omp/agent/hooks/pre/tna-veto.ts (it was copied by onboarding).'); }
    }
    if (stamp.did.vetoHookCopiedPi === true) {
      const vetoPi = join(cwd, '.pi', 'extensions', 'tna-veto.ts');
      if (existsSync(vetoPi)) { rmSync(vetoPi, { force: true }); console.log('Veto hook (pi): removed .pi/extensions/tna-veto.ts (it was copied by onboarding).'); }
    }
    // The overlay root is removed only when empty — pre-existing overlays
    // (not created by onboarding) stay untouched.
    const overlayRoot = join(cwd, '.trust', 'skills-overlay');
    if (existsSync(overlayRoot)) {
      try { if (readdirSync(overlayRoot).length === 0) rmSync(overlayRoot, { recursive: true, force: true }); } catch { /* keep */ }
    }
    if (stamp.did.hooksPathSet) {
      try { execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd, stdio: 'pipe' }); removed.hooksPath = true; } catch { /* not set / not a repo */ }
    }
    rmSync(stampPath, { force: true });
    console.log('Receipt');
    console.log(`  Consented: none — consent withdrawn (stamp removed).`);
    console.log(`  Mapped: ${removed.overlays.length ? `removed overlays: ${removed.overlays.join(', ')}` : 'no overlays were created'}${removed.hooksPath ? '; core.hooksPath unset' : ''}`);
    console.log('  Pending: none.');
    console.log('  Next: pre-existing files were left untouched; re-run node scripts/onboarding.mjs to onboard again.');
    process.exit(0);
  }

  // --from-chat (setup-command ticket 01): the chat channel forwards the
  // human's collected answers; the CLI remains the SOLE writer. The answers
  // JSON carries { components: {...}, mapSkills: [...] }. Fail-closed: an
  // empty or malformed answers JSON writes nothing. A stamped tree routes
  // to mapping-only (never re-asks consent). A declined component ignores
  // its section's answers.
  if (args.includes('--from-chat')) {
    let answers = null;
    try {
      const raw = args[args.indexOf('--from-chat') + 1];
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && parsed.components && typeof parsed.components === 'object'
        && COMPONENTS.every((c) => typeof parsed.components[c] === 'boolean')) {
        answers = parsed;
      }
    } catch { /* malformed = no answers */ }
    if (!answers) {
      console.error('--from-chat requires a valid answers JSON: {"components":{"floor":bool,...},"mapSkills":[...]}');
      process.exit(1);
    }
    const stampPath = join(cwd, '.trust', 'onboarding.json');
    let existing = null;
    try { existing = parseStamp(readFileSync(stampPath, 'utf8')); } catch { /* no stamp */ }

    if (existing) {
      // Mapping-only on a stamped tree: never re-asks consent.
      if (!existing.components.overlays) {
        console.log('Overlays were declined at onboarding — nothing to map.');
        process.exit(0);
      }
      const r = await mapPhase(cwd, { yes: true, onlySkills: answers.mapSkills });
      const did = { ...existing.did, overlays: [...new Set([...(existing.did.overlays || []), ...r.written])] };
      // workflowChoice rides through: a mapping-only re-run rewrites the stamp,
      // and dropping the recorded choice here would silently rewrite the
      // adopter's posture (caught fail-first by onboarding.test.mjs M3).
      writeFileSync(stampPath, serializeStamp({ components: existing.components, harness: existing.harness, routerVersion: existing.routerVersion, consentedAt: existing.consentedAt, workflowChoice: existing.workflowChoice, did }));
      printMapReceipt(r, existing);
      process.exit(0);
    }

    const components = answers.components;
    mkdirSync(join(cwd, '.trust'), { recursive: true });
    // The stamp is private: make sure `.trust/` is gitignored — appending to
    // the adopter's existing .gitignore (never clobbering). Without this the
    // doctor fails right after a "successful" onboarding (the one-door
    // promise).
    if (components.floor || components.overlays) {
      const giPath = join(cwd, '.gitignore');
      let gi = '';
      try { gi = readFileSync(giPath, 'utf8'); } catch { /* no .gitignore yet */ }
      if (!/(^|\n)\s*\.trust\/?\s*(\n|$)/.test(gi)) {
        const sep = gi.endsWith('\n') || gi === '' ? '' : '\n';
        writeFileSync(giPath, gi + sep + '.trust/\n');
      }
    }
    let mapResult = null;
    if (components.overlays) {
      // Consent-boundary (spec AC3): mapSkills must be an array; a non-array
      // aborts BEFORE any write (the .gitignore append and overlay dir below
      // happen only after this guard).
      const ms = answers.mapSkills;
      if (ms !== undefined && !Array.isArray(ms)) {
        console.error('mapSkills must be an array — aborting before any write (got: ' + typeof ms + ').');
        process.exit(1);
      }
      if (Array.isArray(ms)) {
        for (const entry of ms) {
          if (typeof entry !== 'string') console.log('Skipping non-string mapSkills entry: ' + JSON.stringify(String(entry).slice(0, 30)) + ' — only skill-name strings are accepted.');
        }
      }
      mapResult = await mapPhase(cwd, { yes: true, onlySkills: (ms || []).filter((e) => typeof e === 'string') });
    }
    // Consent is real (setup-tna unification): consenting hooks WIRES
    // core.hooksPath — the component turns ON mechanically, or /setup-tna
    // alone cannot complete a first install. Declining leaves the config
    // untouched (off, not broken).
    let hooksPathSet = false;
    if (components.hooks) {
      // Guard (security review 2026-10-16): core.hooksPath may only point at
      // scripts/hooks when that directory EXISTS in this tree. From the
      // setup-tna skill payload the hooks directory is not shipped — setting
      // the config anyway would make git silently run NO hooks, disabling the
      // adopter's pre-existing pre-commit enforcement. In that case the wiring
      // is refused with a named manual command instead of a silent regression.
      const hooksDir = join(cwd, 'scripts', 'hooks');
      if (!existsSync(join(hooksDir, 'commit-msg')) && !existsSync(join(hooksDir, 'pre-commit'))) {
        console.error('hooks wiring refused: scripts/hooks not found in this tree (running from the setup-tna skill payload?).');
        console.error('Clone the repo and run the CLI from its root, or wire manually once the hooks exist:');
        console.error('  git config core.hooksPath scripts/hooks');
      } else {
        try {
          execFileSync('git', ['config', 'core.hooksPath', 'scripts/hooks'], { cwd, stdio: 'pipe' });
          hooksPathSet = true;
        } catch (e) {
          console.error(`hooks wiring failed — set it manually: git config core.hooksPath scripts/hooks (${e && e.message ? e.message : 'unknown error'})`);
        }
      }
    }
        // Veto plugin copy (veto-plugin-onboarding spec AC1-AC3): when hooks are
    // consented AND the harness is OpenCode, copy the veto plugin into the
    // project so the mid-session veto actually runs there. Never clobber a
    // pre-existing copy; record did.vetoPluginCopied for --undo.
    let vetoPluginCopied = false;
    let vetoHookCopiedOmp = false;
    let vetoHookCopiedPi = false;
    const harness = detectHarness(cwd);
    if (components.hooks && harness === 'opencode') {
      const srcPlugin = join(ROOT, '.opencode', 'plugins', 'tna-gate');
      const destPlugin = join(cwd, '.opencode', 'plugins', 'tna-gate');
      if (existsSync(destPlugin)) {
        console.log('Veto plugin: already present at .opencode/plugins/tna-gate (left untouched).');
      } else if (existsSync(join(srcPlugin, 'index.js'))) {
        mkdirSync(destPlugin, { recursive: true });
        for (const entry of readdirSync(srcPlugin, { withFileTypes: true })) {
          if (entry.isFile()) writeFileSync(join(destPlugin, entry.name), readFileSync(join(srcPlugin, entry.name)));
        }
        vetoPluginCopied = true;
        console.log('Veto plugin: copied to .opencode/plugins/tna-gate (mid-session veto is ON).');
      } else {
        console.error('Veto plugin: source .opencode/plugins/tna-gate not found in this tree — skipping (copy manually from the repo).');
      }
    }
    // Veto hook copy for omp (home-level hooks/pre) and pi (project .pi/extensions)
    if (components.hooks && harness === 'omp') {
      const srcVeto = join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts');
      const destVeto = join(homedir(), '.omp', 'agent', 'hooks', 'pre', 'tna-veto.ts');
      if (existsSync(destVeto)) {
        console.log('Veto hook (omp): already present at ~/.omp/agent/hooks/pre/tna-veto.ts (left untouched).');
      } else if (existsSync(srcVeto)) {
        mkdirSync(dirname(destVeto), { recursive: true });
        writeFileSync(destVeto, readFileSync(srcVeto));
        vetoHookCopiedOmp = true;
        console.log('Veto hook (omp): copied to ~/.omp/agent/hooks/pre/tna-veto.ts (mid-session veto is ON).');
      } else {
        console.error('Veto hook (omp): source not found — skipping.');
      }
    }
    if (components.hooks && harness === 'pi') {
      const srcVetoPi = join(ROOT, 'veto-hooks', 'pi', 'tna-veto.ts');
      const destVetoPi = join(cwd, '.pi', 'extensions', 'tna-veto.ts');
      if (existsSync(destVetoPi)) {
        console.log('Veto hook (pi): already present at .pi/extensions/tna-veto.ts (left untouched).');
      } else if (existsSync(srcVetoPi)) {
        mkdirSync(dirname(destVetoPi), { recursive: true });
        writeFileSync(destVetoPi, readFileSync(srcVetoPi));
        vetoHookCopiedPi = true;
        console.log('Veto hook (pi): copied to .pi/extensions/tna-veto.ts (mid-session veto is ON).');
      } else {
        console.error('Veto hook (pi): source not found — skipping.');
      }
    }
const did = { vetoPluginCopied, vetoHookCopiedOmp, vetoHookCopiedPi, overlays: mapResult ? mapResult.written : [], hooksPathSet };
    const workflowChoice = typeof answers.workflowChoice === 'string' ? answers.workflowChoice : '';
    const consentSource = args.includes('--from-chat') ? 'forwarded via --from-chat (agent channel)' : 'interactive prompts';
    writeFileSync(stampPath, serializeStamp({ components, harness: detectHarness(cwd), routerVersion: readRouterVersion(), did, consentSource, workflowChoice }));
    printReceipt({ components, routerVersion: readRouterVersion(), harness: detectHarness(cwd), stamped: true, mapResult, hooksPathSet, consentSource });
    process.exit(0);
  }

  // --map-only: re-scan the delta without re-asking consent.
  if (args.includes('--map-only')) {
    let stamp = null;
    try { stamp = parseStamp(readFileSync(join(cwd, '.trust', 'onboarding.json'), 'utf8')); } catch { /* no stamp */ }
    if (!stamp) { console.error('No consent stamp — run node scripts/onboarding.mjs first.'); process.exit(1); }
    if (!stamp.components.overlays) {
      console.log('Overlays were declined at onboarding — nothing to map.');
      process.exit(0);
    }
    const r = await mapPhase(cwd, { yes: true });
    const did = { ...stamp.did, overlays: [...new Set([...(stamp.did.overlays || []), ...r.written])] };
    writeFileSync(join(cwd, '.trust', 'onboarding.json'),
      serializeStamp({ components: stamp.components, harness: stamp.harness, routerVersion: stamp.routerVersion, consentedAt: stamp.consentedAt, did }));
    printMapReceipt(r, stamp);
    process.exit(0);
  }

  printBriefing();
  const harness = detectHarness(cwd);
  if (harness === 'codex') printCodexWarning();
  console.log(harnessBriefing({ harness, compatText: readCompatText() }));
  console.log('Consent is per component — a component you decline is mechanically OFF (the doctor records it). Nothing runs until you answer.');
  console.log('');
  let components;
  if (args.includes('--yes')) {
    components = Object.fromEntries(COMPONENTS.map((c) => [c, true]));
    console.log('--yes: default menu accepted (all components consented).');
  } else {
    components = await askConsent();
    if (!components) {
      printReceipt({ components: Object.fromEntries(COMPONENTS.map((c) => [c, false])), routerVersion: readRouterVersion(), harness: detectHarness(cwd), stamped: false });
      console.error('\nAborted — no stamp written (consent is all-or-recorded).');
      process.exit(1);
    }
  }
  mkdirSync(join(cwd, '.trust'), { recursive: true });

  // Mapping phase (ticket 04): discover, plan, confirm, write.
  let mapResult = null;
  if (components.overlays) mapResult = await mapPhase(cwd, { yes: args.includes('--yes') });
  const did = { overlays: mapResult ? mapResult.written : [], hooksPathSet: false };
  writeFileSync(join(cwd, '.trust', 'onboarding.json'),
    serializeStamp({ components, harness: detectHarness(cwd), routerVersion: readRouterVersion(), did }));
  printReceipt({ components, routerVersion: readRouterVersion(), harness: detectHarness(cwd), stamped: true, mapResult });
  printExitAndUpdate();
  printRehearsal();
}

function printMapReceipt(r, stamp) {
  console.log('');
  console.log('Receipt');
  console.log(`  Consented: overlays=consented (stamp ${stamp.consentedAt ? 'from ' + stamp.consentedAt.slice(0, 10) : 'unknown'})`);
  console.log(`  Mapped: ${r.discovered} discovered, ${r.written.length} written (${r.written.join(', ') || 'none'}), ${r.plan.skipped.length} skipped, ${r.plan.noted.length} already registered`);
  console.log('  Pending: none — --map-only never re-asks consent.');
  console.log('  Next: the new overlays join your session floor marked user:; attach anchors (extends/role) when you know the phase.');
}

if (process.argv[1] && process.argv[1].endsWith('onboarding.mjs')) main();
