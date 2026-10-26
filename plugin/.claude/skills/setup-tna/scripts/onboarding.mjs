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
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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

/**
 * EVERY harness this tree belongs to, not just the first one found.
 *
 * Origin 2026-10-25 (omp fix-list #10, measured): `detectHarness` returns ONE
 * name and the project order wins absolutely. This repo carries `.opencode/` AND
 * `.pi/`, so it resolved to `opencode`, the stamp recorded `copiedAdapters` for pi
 * only, and the omp adapters on disk came from a `--refresh` sweep with no
 * provenance at all — a single leftover directory made the omp install silently
 * empty. The hooks component must install for every harness present; only the
 * skill destination needs one answer (a tree has one primary runtime).
 *
 * @param {string} cwd
 * @returns {string[]} families present here, primary first
 */
export function detectHarnessFamilies(cwd) {
  const found = [];
  for (const [dir, name] of [['.opencode', 'opencode'], ['.omp', 'omp'], ['.pi', 'pi'], ['.dsh', 'dsh']]) {
    if (existsSync(join(cwd, dir))) found.push(name);
  }
  const primary = detectHarness(cwd);
  if (primary !== 'unknown' && !found.includes(primary)) found.push(primary);
  // Primary first, then the rest in a stable order.
  return [primary, ...found.filter((f) => f !== primary)].filter((f) => f !== 'unknown');
}

export function detectHarness(cwd) {
  // Project-local signal FIRST: a tree carrying its own harness dir (.opencode,
  // .omp, .pi, .dsh) is that harness's tree regardless of the user's home dirs
  // (several harnesses share a machine; the home checks below are the fallback,
  // not the authority).
  if (existsSync(join(cwd, '.opencode'))) return 'opencode';
  if (existsSync(join(cwd, '.omp'))) return 'omp';
  if (existsSync(join(cwd, '.pi'))) return 'pi';
  if (existsSync(join(cwd, '.dsh'))) return 'dsh';
  const home = homedir();
  // DeepSeek Harness keeps its profiles under ~/.dsh; the marker is the profiles
  // dir, since a bare ~/.dsh can exist from a stray write.
  if (existsSync(join(home, '.dsh', 'profiles'))) return 'dsh';
  if (existsSync(join(home, '.codex', 'config.toml'))) return 'codex';
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude';
  if (existsSync(join(home, '.claude'))) return 'claude';
  if (existsSync(join(home, '.omo'))) return 'omo';
  return 'unknown';
}

/**
 * The adapters each harness needs, as [sourceInRepo, targetRelativeTo] pairs.
 *
 * WHY A TABLE (origin 2026-10-25): the install path used to copy ONE adapter
 * (tna-veto) while the framework had grown a second one (tna-discipline: floor +
 * mandatory-gate + done-gate). A fresh install therefore shipped one of four
 * layers while the receipt said the hooks were on — the exact "looks installed,
 * is a quarter enforced" failure the full-function matrix exists to catch.
 *
 * Targets:
 *   omp — home-level hooks/pre (its dispatcher autoloads that dir) plus
 *         extensions/ for the stop-gate.
 *   pi  — the project's .pi/extensions (pi autoloads user AND project dirs).
 *   dsh — the profile plugins dir; the patch row is written separately because
 *         a plugin file alone is not registered.
 */
export function adaptersFor(harness, cwd) {
  const home = homedir();
  if (harness === 'omp') {
    return [
      { src: join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts'), dest: join(home, '.omp', 'agent', 'hooks', 'pre', 'tna-veto.ts'), label: 'omp veto' },
      { src: join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts'), dest: join(home, '.omp', 'agent', 'hooks', 'pre', 'tna-discipline.ts'), label: 'omp discipline (floor + mandatory + done)' },
      { src: join(ROOT, 'veto-hooks', 'omp', 'tna-receipts-gate.ts'), dest: join(home, '.omp', 'agent', 'extensions', 'tna-receipts-gate.ts'), label: 'omp stop-gate' },
    ];
  }
  if (harness === 'pi') {
    const out = [
      { src: join(ROOT, 'veto-hooks', 'pi', 'tna-veto.ts'), dest: join(cwd, '.pi', 'extensions', 'tna-veto.ts'), label: 'pi veto' },
      { src: join(ROOT, 'veto-hooks', 'pi', 'tna-discipline.ts'), dest: join(cwd, '.pi', 'extensions', 'tna-discipline.ts'), label: 'pi discipline (floor + mandatory + done)' },
    ];
    // pi autoloads USER and project extension dirs. When a user-wide install
    // already exists, it is a second copy that can drift independently (measured
    // 2026-10-25: this machine's ~/.pi copies were the stale ones), so it is
    // refreshed too — but only when the dir already exists: onboarding never
    // creates a home-level install the user did not ask for.
    const homeExt = join(home, '.pi', 'agent', 'extensions');
    if (existsSync(homeExt)) {
      out.push({ src: join(ROOT, 'veto-hooks', 'pi', 'tna-veto.ts'), dest: join(homeExt, 'tna-veto.ts'), label: 'pi veto (user-wide)' });
      out.push({ src: join(ROOT, 'veto-hooks', 'pi', 'tna-discipline.ts'), dest: join(homeExt, 'tna-discipline.ts'), label: 'pi discipline (user-wide)' });
    }
    return out;
  }
  if (harness === 'dsh') {
    const profiles = dshProfileDirs(cwd);
    const out = [];
    for (const dir of profiles) {
      out.push({ src: join(ROOT, 'veto-hooks', 'dsh', 'tna-veto.mjs'), dest: join(dir, 'plugins', 'tna-veto.mjs'), label: `dsh veto (${basename(dir)})` });
      out.push({ src: join(ROOT, 'veto-hooks', 'dsh', 'tna-discipline.mjs'), dest: join(dir, 'plugins', 'tna-discipline.mjs'), label: `dsh discipline (${basename(dir)})` });
    }
    return out;
  }
  return [];
}

/**
 * Where each harness actually READS skills from (measured, not assumed):
 *   opencode/omp/pi — the shared Agent Skills dirs (`.agents/skills/` project,
 *                     `~/.agents/skills/` user); pi also reads `~/.pi/agent/skills`.
 *   dsh             — `$DSH_HOME/skills/<name>/SKILL.md` (its own flat dir).
 *   claude/codex    — their own plugin payloads ship the skills already.
 *
 * WHY THIS TABLE EXISTS (origin 2026-10-25): onboarding copied ZERO skills, so
 * "one command installs TNA" was true for the hooks only — the floor quotes
 * MANDATORY skills that were never installed. Quoting a skill nobody installed
 * is the inert half-install the full-function matrix exists to catch.
 */
function skillsDirsFor(harness, cwd) {
  const home = homedir();
  if (harness === 'dsh') return [join(home, '.dsh', 'skills')];
  if (harness === 'pi' || harness === 'omp' || harness === 'opencode') return [join(cwd, '.agents', 'skills')];
  return [];
}

/**
 * Install every canonical skill into `dir` without overwriting an existing one.
 * Returns { copied: [absolute paths created], skipped: [names left alone] }.
 * Never deletes, never merges: a skill dir is all-or-nothing (a half-copied
 * skill is worse than a missing one — the model reads SKILL.md and then finds
 * its referenced files absent).
 *
 * Origin 2026-10-25 (dsh fix-list #10, measured): when the CLI runs from the
 * setup-tna SKILL PAYLOAD (`~/.dsh/skills/setup-tna/`), `ROOT` is that skill
 * folder — it carries `veto-hooks/` but no `skills/`. `installSkills` found no
 * source and returned `{copied: [], skipped: []}`, so the install reported
 * success having copied ZERO skills. A silent no-op is the worst possible
 * outcome: the receipt says the floor was consented while nothing was installed.
 * The caller now treats `missingSource` as a hard failure instead.
 */
function installSkills(dir, { onlyMissing = true } = {}) {
  const copied = [];
  const skipped = [];
  const source = join(ROOT, 'skills');
  if (!existsSync(source)) return { copied, skipped, missingSource: source };
  mkdirSync(dir, { recursive: true });
  for (const category of readdirSync(source, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = join(source, category.name);
    for (const entry of readdirSync(categoryDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const from = join(categoryDir, entry.name);
      if (!existsSync(join(from, 'SKILL.md'))) continue;
      const to = join(dir, entry.name);
      if (onlyMissing && existsSync(to)) { skipped.push(entry.name); continue; }
      copyTree(from, to);
      copied.push(to);
    }
  }
  return { copied, skipped };
}

/** Recursive copy (Node has no copyDirSync). Files only — skills carry no links. */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) writeFileSync(dst, readFileSync(src));
  }
}

/** sha256 of a file's bytes — the drift record the stamp carries. */
function fileHash(path) {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return ''; }
}

/**
 * What this MACHINE has installed, per harness — the input C10 (doctor) and
 * `--refresh` reason about. Exported so the doctor reads the same table the
 * installer writes; a second, hand-maintained list would be the drift it is
 * meant to detect.
 *
 * The scan covers EVERY harness that keeps copied adapters, not just the one
 * this project is detected as (origin 2026-10-25: doctor ran in an opencode
 * project, printed "not applicable", and missed the drifted pi/omp adapters on
 * the same machine — the exact blind spot C10 exists to close). A family with
 * nothing on disk is skipped: a harness that was never installed is not a
 * defect.
 *
 * @returns {{groups: Array<{harness: string, adapters: Array<{path: string, state: 'current'|'missing'|'drift'|'unregistered', installed?: string, shipped?: string}>}>}}
 */
export function detectInstalledAdapters(cwd) {
  const groups = [];
  const home = homedir();
  const families = [
    {
      harness: 'pi',
      pairs: [
        // pi autoloads user AND project extension dirs; both can exist.
        [join(ROOT, 'veto-hooks', 'pi', 'tna-veto.ts'), join(cwd, '.pi', 'extensions', 'tna-veto.ts')],
        [join(ROOT, 'veto-hooks', 'pi', 'tna-discipline.ts'), join(cwd, '.pi', 'extensions', 'tna-discipline.ts')],
        [join(ROOT, 'veto-hooks', 'pi', 'tna-veto.ts'), join(home, '.pi', 'agent', 'extensions', 'tna-veto.ts')],
        [join(ROOT, 'veto-hooks', 'pi', 'tna-discipline.ts'), join(home, '.pi', 'agent', 'extensions', 'tna-discipline.ts')],
      ],
    },
    {
      harness: 'omp',
      pairs: [
        [join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts'), join(home, '.omp', 'agent', 'hooks', 'pre', 'tna-veto.ts')],
        [join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts'), join(home, '.omp', 'agent', 'hooks', 'pre', 'tna-discipline.ts')],
        [join(ROOT, 'veto-hooks', 'omp', 'tna-receipts-gate.ts'), join(home, '.omp', 'agent', 'extensions', 'tna-receipts-gate.ts')],
      ],
    },
  ];
  for (const family of families) {
    const present = family.pairs.filter(([, dest]) => existsSync(dest));
    if (!present.length) continue;
    const adapters = [];
    for (const [src, dest] of present) {
      const shipped = fileHash(src);
      const installed = fileHash(dest);
      adapters.push({ path: dest, state: shipped && installed === shipped ? 'current' : 'drift', installed, shipped });
    }
    groups.push({ harness: family.harness, adapters });
  }

  // dsh: the plugin file AND the patch row. A plugin nobody loads reads as
  // installed in a directory listing and enforces nothing.
  const dshAdapters = [];
  for (const dir of dshProfileDirs(cwd)) {
    let body = '';
    try { body = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'); } catch { /* no patch */ }
    for (const [file, id] of [['tna-veto.mjs', 'tna-veto'], ['tna-discipline.mjs', 'tna-discipline']]) {
      const dest = join(dir, 'plugins', file);
      if (!existsSync(dest)) continue;
      const shipped = fileHash(join(ROOT, 'veto-hooks', 'dsh', file));
      const installed = fileHash(dest);
      const state = !body.includes(id) ? 'unregistered' : (shipped && installed === shipped ? 'current' : 'drift');
      dshAdapters.push({ path: dest, state, installed, shipped });
    }
  }
  if (dshAdapters.length) groups.push({ harness: 'dsh', adapters: dshAdapters });
  return { groups };
}

/**
 * Every dsh profile this machine can boot. A veto wired into one profile does
 * not protect a session booted on another — measured 2026-10-25: a probe ran on
 * `headless` while the plugin had only been added to `acp`, and the commit
 * landed. So the installer wires ALL of them, and creates `acp` when none
 * exists (it is the profile the bb launcher boots).
 */
export function dshProfileDirs(cwd) {
  // Project-local first: a tree carrying its own .dsh/profiles is THAT tree's
  // harness (the same rule detectHarness follows). Only when the project has none
  // does the user-level ~/.dsh/profiles apply.
  const localRoot = join(cwd, '.dsh', 'profiles');
  const roots = existsSync(localRoot) ? [localRoot] : [join(homedir(), '.dsh', 'profiles')];
  const dirs = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      // A dsh profile is a directory carrying cordis.patch.yml (or the empty
      // cordis.yml it is seeded from). `node_modules` lives in the same parent
      // and is NOT a profile — measured 2026-10-25: it was wired as one.
      const dir = join(root, name.name);
      if (!existsSync(join(dir, 'cordis.patch.yml')) && !existsSync(join(dir, 'cordis.yml')) && !existsSync(join(dir, 'package.json'))) continue;
      if (!dirs.includes(dir)) dirs.push(dir);
    }
  }
  if (dirs.length === 0) {
    const fallback = join(cwd, '.dsh', 'profiles', 'acp');
    mkdirSync(fallback, { recursive: true });
    dirs.push(fallback);
  }
  return dirs;
}

/** The cordis patch rows that REGISTER the two dsh plugins (a file alone is not loaded). */
function dshPatchRows(profileDir) {
  const at = (file) => `file:///${join(profileDir, 'plugins', file).replace(/\\/g, '/')}`;
  return [
    '# trust-no-agent: evidence-gated veto for irreversible shell actions.',
    '- insert:',
    '    - id: tna-veto',
    `      name: '${at('tna-veto.mjs')}'`,
    '# trust-no-agent: MANDATORY classification + completion-claim gate.',
    '- insert:',
    '    - id: tna-discipline',
    `      name: '${at('tna-discipline.mjs')}'`,
    '',
  ].join('\n');
}

/**
 * Register the dsh plugins in every profile's cordis.patch.yml, idempotently.
 * Returns the profiles it touched.
 */
function wireDshProfiles(cwd) {
  const touched = [];
  for (const dir of dshProfileDirs(cwd)) {
    const patch = join(dir, 'cordis.patch.yml');
    const existing = existsSync(patch) ? readFileSync(patch, 'utf8') : '# Your patch layer for this dsh profile.\n[]\n';
    const missing = [];
    if (!existing.includes('tna-veto')) missing.push('tna-veto');
    if (!existing.includes('tna-discipline')) missing.push('tna-discipline');
    if (missing.length === 0) { touched.push(`${basename(dir)} (already wired)`); continue; }

    // A profile whose layer is still the empty default `[]` must lose that line:
    // a top-level scalar and a top-level list cannot coexist in one YAML doc.
    let body = existing.replace(/^\[\]\s*$/m, '').replace(/\s*$/, '');
    const rows = dshPatchRows(dir).split('\n');
    const keep = rows.filter((line, i) => {
      if (line.includes('id: tna-veto')) return missing.includes('tna-veto');
      if (line.includes('id: tna-discipline')) return missing.includes('tna-discipline');
      // A comment/insert pair belongs to the id that follows it; drop both halves.
      if (line === '# trust-no-agent: evidence-gated veto for irreversible shell actions.') return missing.includes('tna-veto');
      if (line === '# trust-no-agent: MANDATORY classification + completion-claim gate.') return missing.includes('tna-discipline');
      if (line === '- insert:') {
        const next = rows[i + 1] ?? '';
        if (next.includes('tna-veto')) return missing.includes('tna-veto');
        if (next.includes('tna-discipline')) return missing.includes('tna-discipline');
      }
      if (line.trim() === '' && (rows[i - 1] ?? '').includes('tna-veto.mjs')) return missing.includes('tna-veto');
      if (line.trim() === '' && (rows[i - 1] ?? '').includes('tna-discipline.mjs')) return missing.includes('tna-discipline');
      return true;
    });
    writeFileSync(patch, `${body}\n\n${keep.join('\n')}`);
    touched.push(`${basename(dir)} (wired: ${missing.join(' + ')})`);
  }
  return touched;
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

function printReceipt({ components, routerVersion, harness, stamped, mapResult, hooksPathSet, consentSource, layers }) {
  const yes = (k) => (components[k] ? 'consented' : 'declined (mechanically OFF)');
  console.log('');
  console.log('Receipt');
  console.log(`  Consented: floor=${yes('floor')} hooks=${yes('hooks')} overlays=${yes('overlays')} evidence-gate=${yes('evidenceGate')} (router ${routerVersion || 'unknown'}, harness ${harness})`);
  // The layers line exists because "hooks=consented" hid WHICH layers landed:
  // a harness could report success while carrying only the veto (origin
  // 2026-10-25 — the discipline adapters had no install path).
  if (layers !== undefined) console.log(`  Layers: ${layers}`);
  console.log(`  Mapped: ${stamped ? 'stamp written to .trust/onboarding.json' : 'no stamp written (aborted)'}${mapResult ? ` - ${mapResult.discovered} discovered, ${mapResult.written.length} written (${mapResult.written.join(', ') || 'none'}), ${mapResult.plan.skipped.length} skipped, ${mapResult.plan.noted.length} already registered` : ''}`);
  if (consentSource) console.log('  Consent source: ' + consentSource);
  console.log(hooksPathSet === true
    ? '  Pending: none — hooks wired (core.hooksPath=scripts/hooks).'
    : '  Pending: hooks wiring was declined — the mechanical hooks stay OFF (consent is real).');
  console.log('  Next: ask your agent to read AGENTS.md and recite the four Iron Laws; then run /setup-tna in your chat session (or node scripts/onboarding.mjs --map-only) when new skills appear.');
}

/**
 * Install the mechanical layers for one harness: every adapter the harness
 * needs, then the skills the floor quotes.
 *
 * Returns the `did` fields the stamp records (and --undo replays). Extracted so
 * the FIRST install and the `--refresh` re-install run the same code — origin
 * 2026-10-25: a stamped tree routed straight to mapping-only and exited, so a
 * dsh profile created AFTER the first install was never wired and `--refresh`
 * could not reach the install path at all (measured on an isolated DSH_HOME:
 * the acp profile got the plugins, the headless profile created later got
 * nothing).
 */
function installLayers({ cwd, harness, components, refresh }) {
  const copiedAdapters = [];
  const skippedAdapters = [];
  const missingAdapters = [];
  const refreshedAdapters = [];
  const driftedAdapters = [];
  const adapterHashes = {};
  if (components.hooks) {
    for (const { src, dest, label } of adaptersFor(harness, cwd)) {
      if (!existsSync(src)) {
        missingAdapters.push(src);
        console.error(`Hook (${label}): source not found — skipping.`);
        continue;
      }
      const shipped = fileHash(src);
      if (existsSync(dest)) {
        const installed = fileHash(dest);
        if (installed === shipped) {
          skippedAdapters.push(label);
          adapterHashes[dest] = shipped;
          console.log(`Hook (${label}): already current at ${dest}.`);
        } else if (refresh) {
          writeFileSync(dest, readFileSync(src));
          refreshedAdapters.push(dest);
          adapterHashes[dest] = shipped;
          console.log(`Hook (${label}): refreshed at ${dest} (was ${installed.slice(0, 12)}, now ${shipped.slice(0, 12)}).`);
        } else {
          driftedAdapters.push(dest);
          adapterHashes[dest] = installed;
          console.log(`Hook (${label}): ${dest} DIFFERS from the shipped copy (installed ${installed.slice(0, 12)}, shipped ${shipped.slice(0, 12)}) — left untouched; re-run with --refresh to update it.`);
        }
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(src));
        copiedAdapters.push(dest);
        adapterHashes[dest] = shipped;
        console.log(`Hook (${label}): copied to ${dest} (ON).`);
      }
    }
    if (harness === 'dsh' && copiedAdapters.length + skippedAdapters.length + refreshedAdapters.length + driftedAdapters.length > 0) {
      for (const line of wireDshProfiles(cwd)) console.log(`dsh profile: ${line}`);
    }
  }
  // Skills (origin 2026-10-25): the floor quotes the MANDATORY skills into
  // every session, but nothing installed them — the install shipped the
  // quoting and not the quoted. Consent to the floor installs them into the
  // directory THIS harness reads; a pre-existing skill is never overwritten.
  const skillsCopied = [];
  const skillsSkipped = [];
  const skillsMissingSource = [];
  if (components.floor) {
    for (const dir of skillsDirsFor(harness, cwd)) {
      const r = installSkills(dir);
      if (r.missingSource) { skillsMissingSource.push(r.missingSource); continue; }
      for (const p of r.copied) skillsCopied.push(p);
      for (const n of r.skipped) skillsSkipped.push(n);
      if (r.copied.length) console.log(`Skills: ${r.copied.length} installed into ${dir}.`);
      if (r.skipped.length) console.log(`Skills: ${r.skipped.length} already present in ${dir} (left untouched).`);
    }
    // A payload install (running from ~/.dsh/skills/setup-tna/) has no skills/
    // tree beside it. Reporting success with zero skills copied is the silent
    // no-op this check exists to prevent (dsh fix-list #10).
    if (skillsMissingSource.length) {
      console.error(`Skills: SOURCE NOT FOUND at ${skillsMissingSource[0]} — this tree is a setup-tna SKILL PAYLOAD, not the framework checkout.`);
      console.error('  Nothing was installed for the floor component. Either run the CLI from the trust-no-agent checkout,');
      console.error('  or copy the skills yourself: cp -r <trust-no-agent>/skills/*/* ~/.agents/skills/ (or ~/.dsh/skills/ for dsh).');
      console.error('  Aborting: a "successful" install that copied no skills would misreport the floor as consented.');
      process.exit(1);
    }
  }
  return { copiedAdapters, skippedAdapters, missingAdapters, refreshedAdapters, driftedAdapters, adapterHashes, skillsCopied, skillsSkipped };
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
    // copiedAdapters is the exact list this run wrote (2026-10-25: the install
    // grew from one adapter to three per harness, and undo must follow the same
    // table or it leaves residue). Refreshed adapters are the same kind of
    // residue: this run REPLACED them, so undo removes them rather than
    // restoring an older copy it no longer has (the stamp only keeps hashes).
    for (const rawPath of [...(stamp.did.copiedAdapters || []), ...(stamp.did.refreshedAdapters || [])]) {
      const target = String(rawPath);
      // The stamp is on-disk and therefore untrusted: only a path under a known
      // harness dir may be removed, never an arbitrary string from the file.
      const normalized = target.replace(/\\/g, '/');
      const allowed = normalized.includes('/.pi/extensions/')
        || normalized.includes('/.omp/agent/hooks/pre/')
        || normalized.includes('/.omp/agent/extensions/')
        || normalized.includes('/.dsh/profiles/');
      if (!allowed) {
        console.log('Skipping suspicious adapter path in stamp: ' + JSON.stringify(normalized.slice(0, 60)));
        continue;
      }
      if (existsSync(target)) {
        rmSync(target, { force: true });
        console.log(`Hook adapter: removed ${target} (it was copied by onboarding).`);
      }
    }
    // Skills this run created. Only the recorded absolute paths are touched, and
    // only when the parent dir is a known skills location — a tampered stamp must
    // not turn undo into an arbitrary recursive delete.
    for (const rawPath of stamp.did.skillsCopied || []) {
      const target = String(rawPath);
      const normalized = target.replace(/\\/g, '/');
      const allowed = normalized.includes('/.agents/skills/') || normalized.includes('/.dsh/skills/');
      if (!allowed) {
        console.log('Skipping suspicious skill path in stamp: ' + JSON.stringify(normalized.slice(0, 60)));
        continue;
      }
      if (existsSync(target)) { rmSync(target, { recursive: true, force: true }); }
    }
    if ((stamp.did.skillsCopied || []).length) {
      console.log(`Skills: removed ${(stamp.did.skillsCopied || []).length} skill dir(s) this install created (pre-existing ones left untouched).`);
    }
    // dsh patch rows this run added: strip them so a removed plugin file is not
    // still registered (a dangling `name:` would make the profile fail to boot).
    if (stamp.did.dshProfilesWired === true) {
      for (const dir of dshProfileDirs(cwd)) {
        const patch = join(dir, 'cordis.patch.yml');
        if (!existsSync(patch)) continue;
        const body = readFileSync(patch, 'utf8');
        if (!/tna-(veto|discipline)/.test(body)) continue;
        const kept = body
          .split('\n')
          .filter((line, i, all) => {
            if (/tna-(veto|discipline)/.test(line)) return false;
            if (line === '# trust-no-agent: evidence-gated veto for irreversible shell actions.') return false;
            if (line === '# trust-no-agent: MANDATORY classification + completion-claim gate.') return false;
            if (line === '- insert:') {
              const next = all[i + 1] ?? '';
              if (/tna-(veto|discipline)/.test(next)) return false;
            }
            return true;
          })
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\s*$/, '\n');
        writeFileSync(patch, kept);
        console.log(`dsh profile: unwired tna plugins in ${basename(dir)}/cordis.patch.yml`);
      }
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
      // --refresh on a stamped tree: re-run the INSTALL path, never the consent
      // flow. Origin 2026-10-25: a stamped tree routed straight to mapping-only
      // and exited, so a dsh profile created after the first install was never
      // wired and a shipped adapter update could not be delivered at all.
      if (args.includes('--refresh')) {
        const harness = detectHarness(cwd);
        const components = existing.components;
        // Refresh EVERY family installed on this machine, not just this
        // project's harness: an opencode project still carries omp/pi/dsh
        // adapters on the same disk, and those are exactly the copies that go
        // stale unnoticed (measured 2026-10-25 — doctor ran in an opencode repo
        // and the pi/omp/dsh adapters were all behind).
        const families = new Set(detectHarnessFamilies(cwd));
        for (const g of detectInstalledAdapters(cwd).groups) families.add(g.harness);
        const layers = { copiedAdapters: [], refreshedAdapters: [], driftedAdapters: [], adapterHashes: {}, skillsCopied: [], skillsSkipped: [] };
        for (const family of families) {
          const r = installLayers({ cwd, harness: family, components, refresh: true });
          layers.copiedAdapters.push(...r.copiedAdapters);
          layers.refreshedAdapters.push(...r.refreshedAdapters);
          layers.driftedAdapters.push(...r.driftedAdapters);
          Object.assign(layers.adapterHashes, r.adapterHashes);
          layers.skillsCopied.push(...r.skillsCopied);
          layers.skillsSkipped.push(...r.skillsSkipped);
        }
        const did = {
          ...existing.did,
          copiedAdapters: [...new Set([...(existing.did.copiedAdapters || []), ...layers.copiedAdapters])],
          refreshedAdapters: layers.refreshedAdapters,
          driftedAdapters: layers.driftedAdapters,
          adapterHashes: { ...(existing.did.adapterHashes || {}), ...layers.adapterHashes },
          skillsCopied: [...new Set([...(existing.did.skillsCopied || []), ...layers.skillsCopied])],
          skillsSkipped: layers.skillsSkipped,
          dshProfilesWired: families.has('dsh') ? true : existing.did.dshProfilesWired,
        };
        writeFileSync(stampPath, serializeStamp({ components: existing.components, harness: existing.harness, routerVersion: readRouterVersion(), consentedAt: existing.consentedAt, workflowChoice: existing.workflowChoice, did }));
        console.log('');
        console.log('Receipt');
        console.log(`  Consented: unchanged (consent was recorded ${existing.consentedAt ? existing.consentedAt.slice(0, 10) : 'earlier'}; --refresh never re-asks).`);
        console.log(`  Refreshed: ${layers.refreshedAdapters.length} adapter(s) updated to the shipped copy; ${layers.copiedAdapters.length} newly installed.`);
        if (layers.driftedAdapters.length) console.log(`  Drift: ${layers.driftedAdapters.length} adapter(s) still differ (write failed?) — re-run --refresh.`);
        console.log(`  Skills: ${layers.skillsCopied.length} installed, ${layers.skillsSkipped.length} already present (left untouched).`);
        console.log('  Next: node scripts/doctor.mjs to confirm every adapter is current.');
        process.exit(0);
      }
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
    // Every adapter the harness needs — the veto (blocking) AND the discipline
    // extension (floor + mandatory-gate + done-gate). One table, so a future
    // adapter cannot ship without an install path (origin 2026-10-25: the
    // discipline adapters existed but nothing copied them).
    //
    // --refresh (origin 2026-10-25): a copy-once install has no reconciliation,
    // so an adapter shipped AFTER the first install never reaches it — measured
    // on this machine: the installed pi/omp discipline adapters both differed
    // from the shipped copies while every gate reported green. --refresh
    // rewrites an adapter whose bytes differ; without it the owner copy is still
    // left untouched, but the drift is NAMED so "consented" never reads as
    // "current".
    const refresh = args.includes('--refresh');
    // EVERY harness this tree belongs to, not just the primary one.
    // Origin 2026-10-25 (omp fix-list #10, measured): `detectHarness` returns one
    // name and project order wins absolutely, so a leftover `.opencode/` in a
    // repo that also carries `.omp/`/`.pi/` meant the omp adapters were NEVER
    // installed by the project path — the ones on disk had no provenance at all.
    const families = detectHarnessFamilies(cwd);
    const layers = { copiedAdapters: [], skippedAdapters: [], missingAdapters: [], refreshedAdapters: [], driftedAdapters: [], adapterHashes: {}, skillsCopied: [], skillsSkipped: [] };
    for (const family of families) {
      const r = installLayers({ cwd, harness: family, components, refresh });
      layers.copiedAdapters.push(...r.copiedAdapters);
      layers.skippedAdapters.push(...r.skippedAdapters);
      layers.missingAdapters.push(...r.missingAdapters);
      layers.refreshedAdapters.push(...r.refreshedAdapters);
      layers.driftedAdapters.push(...r.driftedAdapters);
      Object.assign(layers.adapterHashes, r.adapterHashes);
      layers.skillsCopied.push(...r.skillsCopied);
      layers.skillsSkipped.push(...r.skillsSkipped);
    }
    const { copiedAdapters, skippedAdapters, missingAdapters, refreshedAdapters, driftedAdapters, adapterHashes, skillsCopied, skillsSkipped } = layers;
    if (families.length > 1) console.log(`Harnesses detected in this tree: ${families.join(', ')} — adapters installed for each.`);
    // Kept for the --undo contract and for older stamps (assignment, not a new
    // declaration: the flags are declared once above with the other `did` state).
    vetoHookCopiedOmp = copiedAdapters.some((p) => p.includes(`${basename(join(homedir(), '.omp'))}`));
    vetoHookCopiedPi = copiedAdapters.some((p) => p.endsWith(join('.pi', 'extensions', 'tna-veto.ts')));
    const did = { vetoPluginCopied, vetoHookCopiedOmp, vetoHookCopiedPi, copiedAdapters, refreshedAdapters, driftedAdapters, adapterHashes, skillsCopied, skillsSkipped, dshProfilesWired: families.includes('dsh') && components.hooks, overlays: mapResult ? mapResult.written : [], hooksPathSet };
    const workflowChoice = typeof answers.workflowChoice === 'string' ? answers.workflowChoice : '';
    const consentSource = args.includes('--from-chat') ? 'forwarded via --from-chat (agent channel)' : 'interactive prompts';
    writeFileSync(stampPath, serializeStamp({ components, harness: detectHarness(cwd), routerVersion: readRouterVersion(), did, consentSource, workflowChoice }));
    const layersLine = components.hooks
      ? (harness === 'dsh'
        ? 'veto + discipline (mandatory-gate, done-gate) registered in every dsh profile; floor comes from dsh reading AGENTS.md'
        : harness === 'pi' || harness === 'omp'
          ? 'veto + discipline (floor, mandatory-gate, done-gate)'
          : harness === 'opencode'
            ? 'veto + evidence recorder (opencode plugin)'
            : 'veto hooks ship with the harness plugin (verify the hooks file in the payload)')
      : 'hooks declined — every layer is mechanically OFF';
    // Adapter/skill state is reported by NAME, never folded into "consented":
    // a drifted adapter and a current one both read as consented, and that
    // ambiguity is what hid a stale install until a manual probe found it.
    if (refreshedAdapters.length) console.log(`  Refreshed: ${refreshedAdapters.length} adapter(s) updated to the shipped copy.`);
    if (driftedAdapters.length) console.log(`  Drift: ${driftedAdapters.length} adapter(s) differ from the shipped copy and were left untouched — re-run with --refresh.`);
    if (components.floor) console.log(`  Skills: ${skillsCopied.length} installed, ${skillsSkipped.length} already present (left untouched).`);
    printReceipt({ components, routerVersion: readRouterVersion(), harness: detectHarness(cwd), stamped: true, mapResult, hooksPathSet, consentSource, layers: layersLine });
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
