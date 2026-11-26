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
import { readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const STOPWORDS = new Set(['skill', 'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'how', 'what', 'when', 'your', 'you']);
const COMPONENTS = ['floor', 'hooks', 'overlays', 'evidenceGate'];

// Harnesses whose install lives at user level (~/.tna runtime + home config
// files), versus harnesses whose payload is copied into the project tree.
// One set — a new user-level harness joins here, not in six places (roast r2
// standards #4).
const USER_LEVEL_HARNESSES = new Set(['devin', 'antigravity', 'gemini']);
// Harnesses whose skills install copies into the project's .agents/skills.
const PROJECT_SKILL_HARNESSES = new Set(['pi', 'omp', 'opencode', ...USER_LEVEL_HARNESSES]);

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
  const out = new Set();
  for (const category of ['discipline', 'engineering', 'meta']) {
    try {
      for (const d of readdirSync(join(ROOT, 'skills', category), { withFileTypes: true })) {
        if (d.isDirectory()) out.add(d.name);
      }
    } catch { /* a partial payload still contributes the categories it carries */ }
  }
  return out;
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
// Project-local markers decide the tree's primary harness. `.devin/` is the
// Devin CLI's project dir; `.agents/hooks.json` and `.gemini/settings.json`
// are FILE markers — a bare `.agents/` is the shared skills dir and belongs
// to nobody, and a bare `.gemini/` can be either gemini or antigravity state.
const PROJECT_MARKERS = [
  ['.opencode', 'opencode'], ['.omp', 'omp'], ['.pi', 'pi'], ['.dsh', 'dsh'], ['.devin', 'devin'],
];
const PROJECT_FILE_MARKERS = [
  ['.agents/hooks.json', 'antigravity'], ['.gemini/settings.json', 'gemini'],
];

/** Every home-level harness present on this machine, in primary-priority order. */
function homeHarnesses() {
  const home = homedir();
  const out = [];
  // DeepSeek Harness keeps its profiles under ~/.dsh; the marker is the profiles
  // dir, since a bare ~/.dsh can exist from a stray write.
  if (existsSync(join(home, '.dsh', 'profiles'))) out.push('dsh');
  if (existsSync(join(home, '.codex', 'config.toml'))) out.push('codex');
  if (process.env.CLAUDE_PLUGIN_ROOT || existsSync(join(home, '.claude'))) out.push('claude');
  if (existsSync(join(home, '.omo'))) out.push('omo');
  // Devin CLI: a hooks-bearing config.json OR the ~/.devin state dir.
  if (devinConfigCandidates().some((p) => existsSync(p)) || existsSync(join(home, '.devin'))) out.push('devin');
  // Antigravity keeps its named hook groups under ~/.gemini/config (the same
  // ~/.gemini root gemini uses — the marker is the config dir, not the root).
  if (existsSync(join(home, '.gemini', 'config')) || existsSync(join(home, '.gemini', 'antigravity'))) out.push('antigravity');
  if (existsSync(join(home, '.gemini', 'settings.json'))) out.push('gemini');
  return out;
}

export function detectHarnessFamilies(cwd) {
  const found = [];
  for (const [dir, name] of PROJECT_MARKERS) {
    if (existsSync(join(cwd, dir))) found.push(name);
  }
  for (const [file, name] of PROJECT_FILE_MARKERS) {
    if (existsSync(join(cwd, file))) found.push(name);
  }
  // Home signals belong in the family list too — a claude-primary project on a
  // machine that also runs devin/agy/gemini must get every harness's adapters,
  // or the other sessions on this machine stay unenforced (the same class of
  // blind spot the 2026-10-25 families fix closed for omp/pi/dsh).
  for (const name of homeHarnesses()) if (!found.includes(name)) found.push(name);
  const primary = detectHarness(cwd);
  if (primary !== 'unknown' && !found.includes(primary)) found.push(primary);
  // Primary first, then the rest in a stable order.
  return [primary, ...found.filter((f) => f !== primary)].filter((f) => f !== 'unknown');
}

export function detectHarness(cwd) {
  // Project-local signal FIRST: a tree carrying its own harness marker is that
  // harness's tree regardless of the user's home dirs (several harnesses share
  // a machine; the home checks below are the fallback, not the authority).
  for (const [dir, name] of PROJECT_MARKERS) {
    if (existsSync(join(cwd, dir))) return name;
  }
  for (const [file, name] of PROJECT_FILE_MARKERS) {
    if (existsSync(join(cwd, file))) return name;
  }
  return homeHarnesses()[0] ?? 'unknown';
}

/**
 * The config file each user-level harness reads hook entries from. Devin keeps
 * hooks inside its app config (config.json -> `hooks`); antigravity keeps
 * named hook groups in ~/.gemini/config/hooks.json; gemini in
 * ~/.gemini/settings.json -> `hooks`. All three are user-level on purpose:
 * a project-committed hooks file would point at ~/.tna on a teammate's
 * machine where the adapter may not exist — agy reads a missing hook as a
 * deny (fail-closed), so a committed config can freeze a teammate's tools.
 */
export function devinConfigCandidates() {
  const home = homedir();
  const out = [];
  if (process.platform === 'win32' || process.env.APPDATA) {
    out.push(join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'devin', 'config.json'));
  }
  out.push(join(home, '.config', 'devin', 'config.json'), join(home, '.devin', 'config.json'));
  return out;
}
export function devinConfigFile() {
  const candidates = devinConfigCandidates();
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}
export function agyConfigFile() { return join(homedir(), '.gemini', 'config', 'hooks.json'); }
export function geminiConfigFile() { return join(homedir(), '.gemini', 'settings.json'); }

/**
 * The install root for the user-level adapters (~/.tna). Their hook.mjs
 * resolves the gate runtime as ../../plugin/scripts/ relative to itself, so
 * the installed layout must preserve the repo's shape:
 *   ~/.tna/veto-hooks/<harness>/hook.mjs
 *   ~/.tna/plugin/scripts/<gate-hook + import closure>
 *   ~/.tna/scripts/reinject.mjs        (devin's `reinject` target)
 * A stable home-level path — never the checkout, never a project dir — keeps
 * the config entries valid from every project the user opens.
 */
export function tnaRuntimeDir() { return join(homedir(), '.tna'); }

// gate-hook's dynamic-import closure in plugin/scripts (computed 2026-11-24:
// every ./x.mjs reachable from gate-hook.mjs). If a new file joins the
// closure, it joins this list — a missing file makes the gate fail-open on
// every installed harness, silently.
const GATE_RUNTIME = ['gate-hook', 'reinject', 'overlay-registry', 'floor-composer', 'tna-gate', 'onboarding', 'receipt-enforcement', 'action-gate', 'mandatory-gate'];

function tnaAdapterPairs(harness) {
  const tna = tnaRuntimeDir();
  const pairs = [{ src: join(ROOT, 'veto-hooks', harness, 'hook.mjs'), dest: join(tna, 'veto-hooks', harness, 'hook.mjs'), label: `${harness} adapter` }];
  for (const f of GATE_RUNTIME) {
    pairs.push({ src: join(ROOT, 'plugin', 'scripts', `${f}.mjs`), dest: join(tna, 'plugin', 'scripts', `${f}.mjs`), label: `gate runtime (${f})` });
  }
  pairs.push({ src: join(ROOT, 'scripts', 'reinject.mjs'), dest: join(tna, 'scripts', 'reinject.mjs'), label: 'gate runtime (scripts/reinject)' });
  return pairs;
}

/**
 * The hook entries each harness needs, as pure merge plans: (existing config
 * object, installed hook path) -> { merged, added, already }. Pure so the
 * installer, the undo path, and the doctor's wired-check share one contract.
 * `marker` = the substring that identifies OUR entries anywhere in a config —
 * dedupe, undo and drift checks all key on it.
 */
// Command strings land in harness hook configs and are re-parsed by a shell.
// Double quotes alone are not enough on POSIX: $(...) and backticks still
// expand inside them, and a home dir carrying those characters would execute
// (roast r1 F9). Escaping " ` $ \ is POSIX-correct inside double quotes;
// cmd.exe never expands those characters, so a metachar-named home degrades
// to a missing-file error — fail closed, never an injected command.
const hookCmd = (hookPath) => `node "${String(hookPath).replace(/\\/g, '/').replace(/(["`$\\])/g, '\\$1')}"`;

// Consent contract for the wiring plans (roast r1 F1, spec line 88: a
// decline remains off). Each entry names the component that gates it;
// `components.hooks === false` suppresses every entry regardless. A plan
// called without components keeps the pre-consent behavior (wire all).
// A decline is active suppression, not omission: entries we previously
// wrote under a now-declined contract come back out, foreign entries stay.
const tnaMarker = (harness) => new RegExp(`veto-hooks[\\\\/]${harness}[\\\\/]hook\\.mjs`);

function stripOurEventEntries(hooksObj, event, marker, targetRe) {
  const arr = Array.isArray(hooksObj[event]) ? hooksObj[event] : [];
  const kept = arr.map((g) => {
    if (!Array.isArray(g?.hooks)) return g;
    const hooks = g.hooks.filter((h) => !(marker.test(String(h?.command ?? '')) && targetRe.test(String(h?.command ?? ''))));
    return { ...g, hooks };
  }).filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
  if (kept.length) hooksObj[event] = kept;
  else delete hooksObj[event];
}

export function planDevinConfig(cfg, hookPath, components = null) {
  const merged = { ...cfg, hooks: { ...(cfg?.hooks ?? {}) } };
  const cmd = hookCmd(hookPath);
  const WANTS = [
    ['SessionStart', 'reinject', { hooks: [{ type: 'command', command: `${cmd} reinject`, timeout: 15, statusMessage: 'trust-no-agent: injecting the discipline floor' }] }, 'floor'],
    ['UserPromptSubmit', 'gate-hook', { hooks: [{ type: 'command', command: `${cmd} gate-hook`, timeout: 15, statusMessage: 'trust-no-agent: flagging MANDATORY domains' }] }, null],
    ['PreToolUse', 'gate-hook', { matcher: '', hooks: [{ type: 'command', command: `${cmd} gate-hook`, timeout: 15, statusMessage: 'trust-no-agent: vetoing irreversible calls without fresh evidence' }] }, 'evidenceGate'],
    ['PostToolUse', 'gate-hook', { matcher: '', hooks: [{ type: 'command', command: `${cmd} gate-hook`, timeout: 15, statusMessage: 'trust-no-agent: recording action evidence' }] }, 'evidenceGate'],
  ];
  const added = [], already = [], declined = [];
  for (const [event, target, group, consentKey] of WANTS) {
    if (components && (components.hooks === false || (consentKey && components[consentKey] === false))) {
      declined.push(`${event}:${target}`);
      const marker = tnaMarker('devin');
      stripOurEventEntries(merged.hooks, event, marker, new RegExp(`hook\\.mjs"?\\s+${target}\\b`));
      continue;
    }
    const arr = Array.isArray(merged.hooks[event]) ? merged.hooks[event] : (merged.hooks[event] = []);
    // An existing hook in this event already invoking the same target through
    // OUR dispatcher is an equivalent wiring (this machine's user layer routes
    // the same targets through its own veto-hooks adapter) — adding ours would
    // double-fire. A hook.mjs at any OTHER path is foreign wiring, never proof
    // of ours (roast r2 R2: `node /evil/hook.mjs gate-hook` must not dedupe).
    const tRe = new RegExp(`veto-hooks[\\\\/]devin[\\\\/]hook\\.mjs"?\\s+${target}\\b`, 'i');
    if (arr.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => tRe.test(String(h?.command ?? ''))))) {
      already.push(`${event}:${target}`);
      continue;
    }
    arr.push(group);
    added.push(`${event}:${target}`);
  }
  return { merged, added, already, declined };
}

export function planAgyConfig(cfg, hookPath, components = null) {
  const merged = { ...cfg };
  const marker = /veto-hooks[\\/]antigravity[\\/]hook\.mjs/;
  // Both entries are the evidence gate (veto + recorder): a declined
  // evidenceGate or hooks consent unwires ours and adds nothing.
  if (components && (components.hooks === false || components.evidenceGate === false)) {
    return { merged: unwireConfig('antigravity', merged), added: [], already: [], declined: ['PreToolUse', 'PostToolUse'] };
  }
  const entry = { matcher: '*', hooks: [{ type: 'command', command: hookCmd(hookPath), timeout: 20 }] };
  const group = merged['tna-veto'] && typeof merged['tna-veto'] === 'object' ? merged['tna-veto'] : null;
  if (!group && marker.test(JSON.stringify(merged))) return { merged, added: [], already: ['wired under another group'], declined: [] };
  const g = group ?? {};
  const added = [];
  for (const ev of ['PreToolUse', 'PostToolUse']) {
    const arr = Array.isArray(g[ev]) ? g[ev] : (g[ev] = []);
    if (arr.some((e) => marker.test(JSON.stringify(e)))) continue;
    arr.push(entry);
    added.push(ev);
  }
  if (!group) merged['tna-veto'] = g;
  return { merged, added, already: [], declined: [] };
}

export function planGeminiConfig(cfg, hookPath, components = null) {
  const merged = { ...cfg, hooks: { ...(cfg?.hooks ?? {}) } };
  const marker = /veto-hooks[\\/]gemini[\\/]hook\.mjs/;
  if (components && (components.hooks === false || components.evidenceGate === false)) {
    return { merged: unwireConfig('gemini', merged), added: [], already: [], declined: ['BeforeTool', 'AfterTool'] };
  }
  const added = [];
  for (const ev of ['BeforeTool', 'AfterTool']) {
    const arr = Array.isArray(merged.hooks[ev]) ? merged.hooks[ev] : (merged.hooks[ev] = []);
    if (arr.some((e) => marker.test(JSON.stringify(e)))) continue;
    arr.push({ hooks: [{ type: 'command', command: hookCmd(hookPath), timeout: 20000 }] });
    added.push(ev);
  }
  return { merged, added, already: [], declined: [] };
}

function stripMarkedHooks(value, marker) {
  if (Array.isArray(value)) {
    return value.map((item) => stripMarkedHooks(item, marker)).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    if (typeof value.command === 'string' && marker.test(value.command)) return undefined;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const stripped = stripMarkedHooks(child, marker);
      if (stripped !== undefined) out[key] = stripped;
    }
    if (Array.isArray(value.hooks) && value.hooks.length > 0 && Array.isArray(out.hooks) && out.hooks.length === 0) return undefined;
    return out;
  }
  return value;
}

function hasCommand(value) {
  if (Array.isArray(value)) return value.some(hasCommand);
  if (!value || typeof value !== 'object') return false;
  if (typeof value.command === 'string') return true;
  return Object.values(value).some(hasCommand);
}

/** Strip only the hook objects carrying OUR marker — foreign entries survive, even inside the same group. */
export function unwireConfig(harness, cfg) {
  const marker = new RegExp(`veto-hooks[\\\\/]${harness}[\\\\/]hook\\.mjs`);
  const stripped = stripMarkedHooks(cfg, marker);
  if (harness === 'antigravity' && stripped && typeof stripped === 'object' && stripped['tna-veto'] && !hasCommand(stripped['tna-veto'])) {
    delete stripped['tna-veto'];
  }
  return stripped;
}

/**
 * Strip exactly the named entries — undo's per-entry provenance (roast r1 F3).
 * `unwireConfig` removes EVERY marker-matching command; this removes only the
 * recorded identities ('Event:target' for devin, 'Event' for agy/gemini), so
 * pre-existing marker-matching entries another install or the user wrote are
 * preserved. Still marker-gated: a foreign entry under a recorded id survives.
 */
export function unwireConfigEntries(harness, cfg, entries) {
  const marker = tnaMarker(harness);
  const out = JSON.parse(JSON.stringify(cfg ?? {}));
  // Command-level strip matching stripMarkedHooks: foreign commands merged
  // into one element with ours stay; the element goes only when it had hooks
  // and every one of them carried our marker.
  const stripMarkerCommands = (arr) =>
    arr.map((e) => {
      if (!Array.isArray(e?.hooks)) return e;
      const hooks = e.hooks.filter((h) => !(typeof h?.command === 'string' && marker.test(h.command)));
      if (e.hooks.length > 0 && hooks.length === 0) return null;
      return { ...e, hooks };
    }).filter((e) => e !== null);
  for (const eid of entries || []) {
    if (harness === 'devin') {
      const [event, target] = String(eid).split(':');
      if (!event || !target || !out.hooks || typeof out.hooks !== 'object') continue;
      stripOurEventEntries(out.hooks, event, marker, new RegExp(`hook\\.mjs"?\\s+${target}\\b`));
    } else if (harness === 'antigravity') {
      const g = out['tna-veto'];
      if (!g || typeof g !== 'object' || !Array.isArray(g[eid])) continue;
      const kept = stripMarkerCommands(g[eid]);
      if (kept.length) g[eid] = kept;
      else delete g[eid];
      if (!hasCommand(g)) delete out['tna-veto'];
    } else if (harness === 'gemini') {
      const arr = out.hooks?.[eid];
      if (!Array.isArray(arr)) continue;
      const kept = stripMarkerCommands(arr);
      if (kept.length) out.hooks[eid] = kept;
      else delete out.hooks[eid];
    }
  }
  return out;
}

const WIRING = {
  devin: { file: devinConfigFile, plan: planDevinConfig },
  antigravity: { file: agyConfigFile, plan: planAgyConfig },
  gemini: { file: geminiConfigFile, plan: planGeminiConfig },
};

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
export function adaptersFor(harness, cwd, { createFallback = true } = {}) {
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
    // createFallback:false for read-only callers (preflight/scans) — the acp
    // fallback is an install write, not something a check may leave behind.
    const profiles = dshProfileDirs(cwd, { createFallback });
    const out = [];
    for (const dir of profiles) {
      out.push({ src: join(ROOT, 'veto-hooks', 'dsh', 'tna-veto.mjs'), dest: join(dir, 'plugins', 'tna-veto.mjs'), label: `dsh veto (${basename(dir)})` });
      out.push({ src: join(ROOT, 'veto-hooks', 'dsh', 'tna-discipline.mjs'), dest: join(dir, 'plugins', 'tna-discipline.mjs'), label: `dsh discipline (${basename(dir)})` });
    }
    return out;
  }
  if (USER_LEVEL_HARNESSES.has(harness)) {
    return tnaAdapterPairs(harness);
  }
  return [];
}

/**
 * Where each harness actually READS skills from (measured, not assumed):
 *   opencode/omp/pi — the shared Agent Skills dirs (`.agents/skills/` project,
 *                     `~/.agents/skills/` user); pi also reads `~/.pi/agent/skills`.
 *   dsh             — `$DSH_HOME/skills/<name>/SKILL.md` (its own flat dir).
 *   claude/codex    — their own plugin payloads ship the skills already.
 *   devin/agy/gemini — the shared `.agents/skills/` project dir (Devin reads it
 *                     on this machine: the session skill list shows
 *                     `.agents/skills` sources).
 *
 * WHY THIS TABLE EXISTS (origin 2026-10-25): onboarding copied ZERO skills, so
 * "one command installs TNA" was true for the hooks only — the floor quotes
 * MANDATORY skills that were never installed. Quoting a skill nobody installed
 * is the inert half-install the full-function matrix exists to catch.
 */
function skillsDirsFor(harness, cwd) {
  const home = homedir();
  if (harness === 'dsh') return [join(home, '.dsh', 'skills')];
  if (PROJECT_SKILL_HARNESSES.has(harness)) {
    return [join(cwd, '.agents', 'skills')];
  }
  return [];
}

/**
 * Why skillsDirsFor returns [] and that is CORRECT: claude/codex ship their
 * skills inside the plugin payload — a floor consent here copies nothing and
 * the receipt must say so, not let "consented" read as "installed". Returns
 * the one-line note the install prints (null when there is nothing to say).
 */
function skillsNoteFor(harness) {
  if (harness === 'claude' || harness === 'codex') {
    return `Skills: none copied — this harness's skills ship inside the plugin payload; verify the plugin is installed (doctor PL).`;
  }
  return null;
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
function installSkills(dir, { onlyMissing = true, tx = null } = {}) {
  const copied = [];
  const skipped = [];
  const source = join(ROOT, 'skills');
  if (!existsSync(source)) return { copied, skipped, missingSource: source };
  mkdirInstall(tx, dir);
  for (const category of readdirSync(source, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = join(source, category.name);
    for (const entry of readdirSync(categoryDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const from = join(categoryDir, entry.name);
      if (!existsSync(join(from, 'SKILL.md'))) continue;
      const to = join(dir, entry.name);
      if (onlyMissing && existsSync(to)) { skipped.push(entry.name); continue; }
      copyTree(from, to, tx);
      copied.push(to);
    }
  }
  return { copied, skipped };
}

/** Recursive copy (Node has no copyDirSync). Files only — skills carry no links. */
function copyTree(from, to, tx = null) {
  mkdirInstall(tx, to);
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst, tx);
    else if (entry.isFile()) writeInstallFile(tx, dst, readFileSync(src));
  }
}

/** sha256 of a file's bytes — the drift record the stamp carries. */
function fileHash(path) {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return ''; }
}

/** sha256 over a directory tree (sorted paths + file bytes) — the drift record for directory resources. */
function dirHash(root) {
  const h = createHash('sha256');
  const walk = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, `${prefix}${entry.name}/`);
      else if (entry.isFile()) { h.update(prefix + entry.name); h.update(readFileSync(p)); }
    }
  };
  try { walk(root, ''); return h.digest('hex'); } catch { return ''; }
}

function normalizePathKey(path) {
  return resolve(String(path)).replace(/\\/g, '/');
}

function ownershipRegistryPath() {
  return join(tnaRuntimeDir(), 'ownership.json');
}

function fileResourceKey(path) {
  return `file:${normalizePathKey(path)}`;
}

function dirResourceKey(path) {
  return `dir:${normalizePathKey(path)}`;
}

function configResourceKey(harness, file) {
  return `config:${harness}:${normalizePathKey(file)}`;
}

function emptyOwnershipRegistry() {
  return { schema: 1, resources: {} };
}

function parseOwnershipRegistry(text) {
  let obj;
  try { obj = JSON.parse(String(text || '')); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.schema !== 1) return null;
  if (!obj.resources || typeof obj.resources !== 'object' || Array.isArray(obj.resources)) return null;
  const resources = {};
  for (const [key, value] of Object.entries(obj.resources)) {
    if (!key || typeof key !== 'string' || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const owners = value.owners;
    if (!Array.isArray(owners) || owners.length === 0 || owners.some((owner) => typeof owner !== 'string' || !owner)) return null;
    if (new Set(owners).size !== owners.length) return null;
    if (key.startsWith('file:')) {
      if (value.kind !== 'file' || typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash)) return null;
      resources[key] = { kind: 'file', owners: [...owners], hash: value.hash };
      continue;
    }
    if (key.startsWith('dir:')) {
      if (value.kind !== 'dir' || typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash)) return null;
      resources[key] = { kind: 'dir', owners: [...owners], hash: value.hash };
      continue;
    }
    if (key.startsWith('config:')) {
      if (value.kind !== 'config' || typeof value.harness !== 'string' || !value.harness || typeof value.file !== 'string' || !value.file) return null;
      // Per-entry provenance (roast r1 F3): which config entries each owner
      // project wired or relies on. Absent on pre-F3 records — parses as {}.
      const entries = {};
      if (value.entries !== undefined) {
        if (!value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) return null;
        for (const [eid, eowners] of Object.entries(value.entries)) {
          if (!eid || !Array.isArray(eowners) || eowners.length === 0
            || eowners.some((o) => typeof o !== 'string' || !o) || new Set(eowners).size !== eowners.length) return null;
          entries[eid] = [...eowners];
        }
      }
      resources[key] = { kind: 'config', owners: [...owners], harness: value.harness, file: value.file, entries };
      continue;
    }
    return null;
  }
  return { schema: 1, resources };
}

function readOwnershipRegistry() {
  const path = ownershipRegistryPath();
  if (!existsSync(path)) return { path, existed: false, registry: emptyOwnershipRegistry(), error: null };
  let parsed = null;
  try { parsed = parseOwnershipRegistry(readFileSync(path, 'utf8')); } catch { parsed = null; }
  if (!parsed) return { path, existed: true, registry: null, error: `malformed shared ownership record: ${path}` };
  return { path, existed: true, registry: parsed, error: null };
}

function serializeOwnershipRegistry(registry) {
  const resources = {};
  for (const key of Object.keys(registry.resources).sort()) {
    const resource = registry.resources[key];
    const owners = [...resource.owners].sort();
    if (resource.kind === 'config') {
      const entryClaims = {};
      for (const eid of Object.keys(resource.entries || {}).sort()) {
        entryClaims[eid] = [...resource.entries[eid]].sort();
      }
      resources[key] = { kind: 'config', owners, harness: resource.harness, file: resource.file };
      if (Object.keys(entryClaims).length) resources[key].entries = entryClaims;
    } else {
      resources[key] = { kind: resource.kind, owners, hash: resource.hash };
    }
  }
  return JSON.stringify({ schema: 1, resources }, null, 2) + '\n';
}

function writeOwnershipRegistry(registry, tx = null) {
  mkdirInstall(tx, dirname(ownershipRegistryPath()));
  writeInstallFile(tx, ownershipRegistryPath(), serializeOwnershipRegistry(registry));
}

function registerSharedOwnership({ cwd, families, components, layers, tx }) {
  const state = readOwnershipRegistry();
  if (state.error) throw new Error(state.error);
  const registry = state.registry;
  const owner = normalizePathKey(cwd);
  const written = new Set([...(layers.copiedAdapters || []), ...(layers.refreshedAdapters || [])].map(normalizePathKey));
  let touched = false;
  // Shared skill copies (dsh ~/.dsh/skills) are registered like every other
  // shared resource — project-local copies are the tree's own and need no
  // registry. An existing resource gains this install as an owner whether the
  // copy was written or skipped-present; a NEW resource is created only for
  // copies this install actually wrote (layers.skillsCopied).
  const copiedSet = new Set((layers.skillsCopied || []).map(normalizePathKey));
  for (const raw of layers.skillsShared || []) {
    const target = String(raw);
    const key = dirResourceKey(target);
    const hash = dirHash(target);
    if (!hash) continue;
    const existing = registry.resources[key];
    if (existing) {
      if (!existing.owners.includes(owner)) { existing.owners.push(owner); touched = true; }
      if (copiedSet.has(normalizePathKey(target)) && existing.hash !== hash) { existing.hash = hash; touched = true; }
    } else if (copiedSet.has(normalizePathKey(target))) {
      registry.resources[key] = { kind: 'dir', owners: [owner], hash };
      touched = true;
    }
  }
  if (!components.hooks) {
    if (touched || state.existed) writeOwnershipRegistry(registry, tx);
    return;
  }
  for (const family of families) {
    for (const { dest } of adaptersFor(family, cwd)) {
      const key = fileResourceKey(dest);
      const current = fileHash(dest);
      if (!current) continue;
      const existing = registry.resources[key];
      if (existing) {
        if (!existing.owners.includes(owner)) { existing.owners.push(owner); touched = true; }
        if (written.has(normalizePathKey(dest)) && existing.hash !== current) { existing.hash = current; touched = true; }
      } else if (written.has(normalizePathKey(dest))) {
        registry.resources[key] = { kind: 'file', owners: [owner], hash: current };
        touched = true;
      }
    }
    // Per-entry provenance (roast r1 F3): the entries this install WROTE are
    // claimed unconditionally; the entries it RELIES ON are claimed only when
    // another install already owns them — claiming a user's own pre-existing
    // entry would let our undo strip wiring we never wrote.
    const claimsFor = (family, file) => {
      const added = new Set();
      const relied = new Set();
      for (const w of layers.wiredConfigs || []) {
        if (w.harness !== family || normalizePathKey(w.file) !== normalizePathKey(file)) continue;
        for (const e of w.entries || []) added.add(e);
        for (const e of w.reliedOn || []) relied.add(e);
      }
      return { added, relied };
    };
    const claimConfigEntries = (resource, { added, relied }) => {
      resource.entries = resource.entries || {};
      for (const eid of added) {
        const eo = resource.entries[eid] ?? [];
        if (!eo.includes(owner)) { eo.push(owner); resource.entries[eid] = eo; touched = true; }
      }
      for (const eid of relied) {
        const eo = resource.entries[eid];
        if (eo && !eo.includes(owner)) { eo.push(owner); touched = true; }
      }
    };
    if (family === 'dsh') {
      const files = new Set();
      for (const resource of Object.values(registry.resources)) {
        if (resource.kind === 'config' && resource.harness === 'dsh') files.add(normalizePathKey(resource.file));
      }
      for (const w of layers.wiredConfigs || []) {
        if (w.harness === 'dsh') files.add(normalizePathKey(w.file));
      }
      for (const file of files) {
        const key = configResourceKey(family, file);
        const claims = claimsFor(family, file);
        const existing = registry.resources[key];
        if (existing) {
          if (!existing.owners.includes(owner)) { existing.owners.push(owner); touched = true; }
          claimConfigEntries(existing, claims);
          continue;
        }
        const addedByThisInstall = claims.added.size > 0;
        if (addedByThisInstall) {
          const resource = { kind: 'config', owners: [owner], harness: family, file: normalizePathKey(file), entries: {} };
          claimConfigEntries(resource, claims);
          registry.resources[key] = resource;
          touched = true;
        }
      }
      continue;
    }
    const wire = WIRING[family];
    if (!wire) continue;
    const file = wire.file();
    const key = configResourceKey(family, file);
    const claims = claimsFor(family, file);
    const existing = registry.resources[key];
    if (existing) {
      if (!existing.owners.includes(owner)) { existing.owners.push(owner); touched = true; }
      claimConfigEntries(existing, claims);
      continue;
    }
    const addedByThisInstall = claims.added.size > 0;
    if (addedByThisInstall) {
      const resource = { kind: 'config', owners: [owner], harness: family, file: normalizePathKey(file), entries: {} };
      claimConfigEntries(resource, claims);
      registry.resources[key] = resource;
      touched = true;
    }
  }
  if (touched || state.existed) writeOwnershipRegistry(registry, tx);
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
  for (const dir of dshProfileDirs(cwd, { createFallback: false })) {
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

  // The user-level adapter families: a copied file is not enough — the harness
  // config must carry the required event contract. A surviving veto/pre-tool
  // entry is evidence of wiring, but it cannot certify the post-tool evidence
  // recorder; the scanner therefore reports each absent registration by name.
  const runtimePairs = [
    ...GATE_RUNTIME.map((f) => [join(ROOT, 'plugin', 'scripts', `${f}.mjs`), join(home, '.tna', 'plugin', 'scripts', `${f}.mjs`)]),
    [join(ROOT, 'scripts', 'reinject.mjs'), join(home, '.tna', 'scripts', 'reinject.mjs')],
  ];
  const registrations = {};
  let userInstallEvidence = runtimePairs.some(([, dest]) => existsSync(dest));
  for (const harness of USER_LEVEL_HARNESSES) {
    registrations[harness] = registrationStatus(harness);
    const dest = join(home, '.tna', 'veto-hooks', harness, 'hook.mjs');
    if (existsSync(dest)) userInstallEvidence = true;
    if (registrations[harness].evidence) userInstallEvidence = true;
    if (!existsSync(dest)) continue;
    const shipped = fileHash(join(ROOT, 'veto-hooks', harness, 'hook.mjs'));
    const installed = fileHash(dest);
    const missingRegistrations = registrations[harness].missing;
    const state = missingRegistrations.length ? 'unregistered' : (shipped && installed === shipped ? 'current' : 'drift');
    groups.push({ harness, adapters: [{ path: dest, state, installed, shipped, missingRegistrations }] });
  }
  // The shared gate runtime the three adapters resolve at ../../plugin/scripts.
  // Once any user-level TNA evidence exists (an adapter, one runtime file, or
  // wiring), absence is an installation defect and must remain visible by exact
  // path. With no evidence at all, the machine simply does not have this layer.
  if (userInstallEvidence) {
    const runtimeAdapters = [];
    for (const [src, dest] of runtimePairs) {
      const shipped = fileHash(src);
      if (!existsSync(dest)) {
        runtimeAdapters.push({ path: dest, state: 'missing', shipped });
        continue;
      }
      const installed = fileHash(dest);
      runtimeAdapters.push({ path: dest, state: shipped && installed === shipped ? 'current' : 'drift', installed, shipped });
    }
    groups.push({ harness: 'tna-runtime', adapters: runtimeAdapters });
  }
  return { groups };
}

/**
 * Collect real command strings wired to an event under `config.hooks`.
 * Only `command` fields on event entries or inside their `hooks` arrays
 * count — a description, statusMessage, or comment containing `hook.mjs
 * gate-hook` is prose, not wiring; an event key buried under an arbitrary
 * wrapper (`backup`, `archived`) is not live registration; and a `command`
 * inside a non-hook sub-object is not an entry (roast r2 R3, r3 residual).
 */
function eventCommands(config, event) {
  const out = [];
  const collect = (value) => {
    if (Array.isArray(value)) { for (const v of value) collect(v); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'command' && typeof child === 'string') out.push(child);
      else if (key === 'hooks') collect(child);
    }
  };
  collect(config?.hooks?.[event]);
  return out.map((s) => s.replace(/\\/g, '/'));
}

/**
 * Every `command` field reachable under `config.hooks` — the evidence hint's
 * source. Raw-file text is not evidence: a comment or description containing
 * the adapter marker must not claim TNA-shaped wiring (roast r3 residual).
 */
function hookCommands(config) {
  const out = [];
  const walk = (value) => {
    if (Array.isArray(value)) { for (const v of value) walk(v); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'command' && typeof child === 'string') out.push(child);
      else walk(child);
    }
  };
  walk(config?.hooks);
  return out.map((s) => s.replace(/\\/g, '/'));
}

function parseJsonFile(file) {
  try { return { text: readFileSync(file, 'utf8'), config: JSON.parse(readFileSync(file, 'utf8')) }; }
  catch { return null; }
}

/**
 * The per-event registration contract for the user-level harnesses.
 * Returns { missing, evidence }: missing is the exact event[/target] contract
 * absent from usable JSON; evidence means this config carries TNA-shaped wiring
 * even when the contract is incomplete. Devin accepts the existing user-level
 * dispatcher form (`.../hook.mjs <target>`), the same equivalence the installer
 * merge planner recognizes, so repair does not force duplicate entries.
 */
export function registrationStatus(harness) {
  // Only the file the installer actually targets can certify registration —
  // unioning candidates let complete wiring in a file we never touch stand in
  // for a target file that lacks the contract (roast r1 F4).
  const files = [WIRING[harness]?.file?.()].filter(Boolean);
  const parsed = [...new Set(files)].map(parseJsonFile).filter(Boolean);
  const marker = `veto-hooks/${harness}/hook.mjs`;
  let evidence = parsed.some((p) => hookCommands(p.config).some((c) => c.toLowerCase().includes(marker)));

  if (harness === 'devin') {
    const required = [
      ['SessionStart', 'reinject'],
      ['UserPromptSubmit', 'gate-hook'],
      ['PreToolUse', 'gate-hook'],
      ['PostToolUse', 'gate-hook'],
    ];
    const missing = [];
    for (const [event, target] of required) {
      const targetRe = new RegExp(`veto-hooks[\\\\/]devin[\\\\/]hook\\.mjs"?\\s+${target}\\b`, 'i');
      const present = parsed.some((p) => eventCommands(p.config, event).some((cmd) => targetRe.test(cmd)));
      if (!present) missing.push(`${event}:${target}`);
      else evidence = true;
    }
    return { missing, evidence };
  }

  const events = harness === 'antigravity' ? ['PreToolUse', 'PostToolUse'] : ['BeforeTool', 'AfterTool'];
  const missing = [];
  for (const event of events) {
    const present = parsed.some((p) => eventCommands(p.config, event).some((cmd) => cmd.includes(marker)));
    if (!present) missing.push(event);
    else evidence = true;
  }
  return { missing, evidence };
}

// ---- Layered readiness (first-install trust-layer AC11) ----
// Consent and file presence are not readiness. This table is the shared honest
// vocabulary used by the installer receipt and doctor: a layer is active only
// when its installed adapter/runtime evidence is present and current; a missing
// file or registration is missing; a drifted or uninspectable layer is
// unverified; a harness without a surface is unsupported. Adapter evidence is
// never live-host proof.
const READINESS_LAYERS = [
  ['floor', 'floor'],
  ['mandatoryGate', 'mandatory-gate'],
  ['veto', 'veto'],
  ['evidenceRecorder', 'evidence-recorder'],
  ['doneGate', 'done-gate'],
  ['ledgerAppendOnly', 'ledger-append-only'],
];

const READINESS_SUPPORT = {
  devin: { floor: true, mandatoryGate: true, veto: true, evidenceRecorder: true, doneGate: false, ledgerAppendOnly: true },
  antigravity: { floor: false, mandatoryGate: false, veto: true, evidenceRecorder: true, doneGate: false, ledgerAppendOnly: true },
  gemini: { floor: false, mandatoryGate: false, veto: true, evidenceRecorder: true, doneGate: false, ledgerAppendOnly: true },
  omp: { floor: true, mandatoryGate: true, veto: true, evidenceRecorder: true, doneGate: true, ledgerAppendOnly: true },
  pi: { floor: true, mandatoryGate: true, veto: true, evidenceRecorder: true, doneGate: true, ledgerAppendOnly: true },
  dsh: { floor: true, mandatoryGate: true, veto: true, evidenceRecorder: true, doneGate: true, ledgerAppendOnly: true },
  opencode: { floor: true, mandatoryGate: true, veto: true, evidenceRecorder: true, doneGate: false, ledgerAppendOnly: true },
  claude: { floor: true, mandatoryGate: true, veto: true, evidenceRecorder: true, doneGate: false, ledgerAppendOnly: true },
  codex: { floor: true, mandatoryGate: true, veto: true, evidenceRecorder: true, doneGate: false, ledgerAppendOnly: true },
};

const READINESS_EVENTS = {
  devin: { floor: 'SessionStart:reinject', mandatoryGate: 'UserPromptSubmit:gate-hook', veto: 'PreToolUse:gate-hook', evidenceRecorder: 'PostToolUse:gate-hook', ledgerAppendOnly: 'PreToolUse:gate-hook' },
  antigravity: { veto: 'PreToolUse', evidenceRecorder: 'PostToolUse', ledgerAppendOnly: 'PreToolUse' },
  gemini: { veto: 'BeforeTool', evidenceRecorder: 'AfterTool', ledgerAppendOnly: 'BeforeTool' },
};

function readinessComponentState(key, components) {
  if (!components) return null;
  if (key === 'floor' && components.floor === false) return 'declined';
  if (key !== 'floor' && components.hooks === false) return 'declined';
  if ((key === 'veto' || key === 'evidenceRecorder' || key === 'doneGate' || key === 'ledgerAppendOnly') && components.evidenceGate === false) return 'declined';
  return null;
}

function userHarnessLayerState(key, harness, groups) {
  const adapterPath = join(homedir(), '.tna', 'veto-hooks', harness, 'hook.mjs');
  if (!existsSync(adapterPath)) return 'missing';
  const runtime = groups.find((g) => g.harness === 'tna-runtime');
  if (!runtime || runtime.adapters.some((a) => a.state === 'missing')) return 'missing';
  const registrations = registrationStatus(harness);
  const event = READINESS_EVENTS[harness]?.[key];
  if (event && registrations.missing.includes(event)) return 'missing';
  const adapter = groups.find((g) => g.harness === harness)?.adapters.find((a) => a.path === adapterPath || String(a.path).replace(/\\/g, '/') === adapterPath.replace(/\\/g, '/'));
  if (!adapter) return 'unverified';
  if (adapter.state === 'drift' || adapter.state === 'unregistered' || runtime.adapters.some((a) => a.state === 'drift')) return 'unverified';
  return 'active';
}

function copiedHarnessLayerState(key, harness, groups) {
  const group = groups.find((g) => g.harness === harness);
  const stateFor = (fragment) => group?.adapters.find((a) => String(a.path).replace(/\\/g, '/').includes(fragment))?.state ?? 'missing';
  const needed = key === 'floor' || key === 'mandatoryGate'
    ? 'tna-discipline'
    : key === 'doneGate'
      ? (harness === 'omp' ? 'tna-receipts-gate' : 'tna-discipline')
      : 'tna-veto';
  const state = stateFor(needed);
  if (state === 'current') return 'active';
  if (state === 'missing') return 'missing';
  return 'unverified';
}

/**
 * Inspect the required mechanical layers for one harness. Pure with respect to
 * the process: callers supply the scanner output, so installation and doctor
 * share the same verdict instead of maintaining parallel stories.
 */
export function inspectLayerReadiness({ cwd, harness, components = null, groups = null }) {
  const support = READINESS_SUPPORT[harness] ?? {};
  const scan = groups ?? detectInstalledAdapters(cwd).groups;
  return READINESS_LAYERS.map(([key, label]) => {
    if (!support[key]) return { key, label, state: 'unsupported' };
    const declined = readinessComponentState(key, components);
    if (declined) return { key, label, state: declined };
    if (key === 'floor' && components && components.hooks === false && (harness === 'devin' || harness === 'omp' || harness === 'pi' || harness === 'dsh' || harness === 'opencode' || harness === 'claude' || harness === 'codex')) {
      return { key, label, state: 'missing' };
    }
    let state = 'unverified';
    if (USER_LEVEL_HARNESSES.has(harness)) {
      if (!READINESS_EVENTS[harness]?.[key] && key !== 'doneGate') state = 'unsupported';
      else state = userHarnessLayerState(key, harness, scan);
    } else if (harness === 'omp' || harness === 'pi' || harness === 'dsh') {
      state = copiedHarnessLayerState(key, harness, scan);
    }
    return { key, label, state };
  });
}

export function readinessBlockers(rows) {
  return rows.filter((r) => r.state !== 'active').map((r) => `${r.label}=${r.state}`);
}

/**
 * Format the layer table. `adapterSelfTest` must say exactly what probe ran;
 * when none ran, say so. Live host proof is always open: neither the
 * installer nor doctor is the host consuming the hook.
 */
export function formatLayerReadiness(rows, { adapterSelfTest = 'not run' } = {}) {
  const lines = ['  Readiness (required layers):'];
  for (const row of rows) lines.push(`    ${row.label}: ${row.state}`);
  lines.push(`    adapter self-test: ${adapterSelfTest} — adapter-level evidence only, not live host proof`);
  lines.push('    live host proof: open — no live host session was exercised here');
  // Neither the installer nor doctor is the host consuming the hook, so live
  // host proof is always open and the verdict is partial by construction —
  // stated explicitly, not produced by a branch whose else can never run
  // (roast r1 F11). A future harness-owned proof surface re-adds the
  // parameter and both verdicts when it can actually attest proof.
  const parts = [...readinessBlockers(rows), 'live-host-proof=open'];
  lines.push(`    Overall: partial readiness — ${parts.join(', ')}`);
  return lines;
}

/**
 * Every dsh profile this machine can boot. A veto wired into one profile does
 * not protect a session booted on another — measured 2026-10-25: a probe ran on
 * `headless` while the plugin had only been added to `acp`, and the commit
 * landed. So the installer wires ALL of them, and creates `acp` when none
 * exists (it is the profile the bb launcher boots).
 */
export function dshProfileDirs(cwd, { createFallback = true } = {}) {
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
  if (dirs.length === 0 && createFallback) {
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

function stripDshTnaRows(body, ids = null) {
  const on = (id) => !ids || ids.has(id);
  const vetoOn = on('tna-veto');
  const discOn = on('tna-discipline');
  return String(body)
    .split('\n')
    .filter((line, i, all) => {
      if (/tna-veto/.test(line) && vetoOn) return false;
      if (/tna-discipline/.test(line) && discOn) return false;
      if (line === '# trust-no-agent: evidence-gated veto for irreversible shell actions.' && vetoOn) return false;
      if (line === '# trust-no-agent: MANDATORY classification + completion-claim gate.' && discOn) return false;
      if (line === '- insert:') {
        const next = all[i + 1] ?? '';
        if (/tna-veto/.test(next) && vetoOn) return false;
        if (/tna-discipline/.test(next) && discOn) return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*$/, '\n');
}

/**
 * Register the dsh plugins in every profile's cordis.patch.yml, idempotently.
 * Returns the profiles it touched.
 */
function wireDshProfiles(cwd, tx = null) {
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
    writeInstallFile(tx, patch, `${body}\n\n${keep.join('\n')}`);
    touched.push(`${basename(dir)} (wired: ${missing.join(' + ')})`);
  }
  return touched;
}

/** Read the router version from the repo CHANGELOG (the one version writer). */
export function readRouterVersion() {
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
    join(cwd, '.opencode', 'skills'),
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
function writeOverlay(cwd, proposal, tx = null) {
  const dir = join(cwd, '.trust', 'skills-overlay', proposal.name);
  mkdirInstall(tx, dir);
  const fm = ['---', `name: ${proposal.name}`];
  if (proposal.triggers.length) fm.push(`triggers: ${proposal.triggers.join(', ')}`);
  fm.push('---');
  writeInstallFile(tx, join(dir, 'SKILL.md'), [
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
async function mapPhase(cwd, { yes, onlySkills, tx = null } = {}) {
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
    if (ok) { writeOverlay(cwd, p, tx); written.push(p.name); }
  }
  return { discovered: discovered.length, plan, written };
}

function printReceipt({ components, routerVersion, harness, stamped, mapResult, hooksPathSet, consentSource, layers, readinessLines = [] }) {
  const yes = (k) => (components[k] ? 'consented' : 'declined (mechanically OFF)');
  console.log('');
  console.log('Receipt');
  console.log(`  Consented: floor=${yes('floor')} hooks=${yes('hooks')} overlays=${yes('overlays')} evidence-gate=${yes('evidenceGate')} (router ${routerVersion || 'unknown'}, harness ${harness})`);
  // The layers line exists because "hooks=consented" hid WHICH layers landed:
  // a harness could report success while carrying only the veto (origin
  // 2026-10-25 — the discipline adapters had no install path).
  if (layers !== undefined) console.log(`  Layers: ${layers}`);
  for (const line of readinessLines) console.log(line);
  console.log(`  Mapped: ${stamped ? 'stamp written to .trust/onboarding.json' : 'no stamp written (aborted)'}${mapResult ? ` - ${mapResult.discovered} discovered, ${mapResult.written.length} written (${mapResult.written.join(', ') || 'none'}), ${mapResult.plan.skipped.length} skipped, ${mapResult.plan.noted.length} already registered` : ''}`);
  if (consentSource) console.log('  Consent source: ' + consentSource);
  console.log(hooksPathSet === true
    ? '  Pending: none — hooks wired (core.hooksPath=scripts/hooks).'
    : '  Pending: hooks wiring was declined or unavailable — harness adapters/skills are installed, repository git hooks stay as they were.');
  console.log('  Next: ask your agent to read AGENTS.md and recite the four Iron Laws; then run /setup-tna in your chat session (or node scripts/onboarding.mjs --map-only) when new skills appear.');
}

/**
 * One install transaction. Every file the first-install path writes is either
 * operation-created (removed on rollback) or pre-existing (its original bytes
 * restored on rollback). Git config mutations are journaled too. Empty parent
 * directories may remain after a rollback; they are inert, while a half-written
 * file is not.
 */
function createInstallTransaction(cwd) {
  const created = new Set();
  const createdDirs = new Set();
  const modified = new Map();
  const gitConfigs = new Map();
  const mkdir = (dir) => {
    const missing = [];
    let cursor = dir;
    while (!existsSync(cursor)) {
      missing.push(cursor);
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    for (const item of missing) createdDirs.add(item);
    mkdirSync(dir, { recursive: true });
  };
  const writeFile = (file, data) => {
    if (!created.has(file) && !modified.has(file)) {
      if (existsSync(file)) modified.set(file, readFileSync(file));
      else created.add(file);
    }
    writeFileSync(file, data);
  };
  const gitConfig = (cwd, key, value) => {
    if (!gitConfigs.has(key)) {
      let existed = false;
      let previous = '';
      try {
        previous = execFileSync('git', ['config', '--get', key], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
        existed = true;
      } catch { /* absent or not a repo — restore means unset */ }
      gitConfigs.set(key, { existed, previous });
    }
    execFileSync('git', ['config', key, value], { cwd, stdio: 'pipe' });
  };
  const rollback = () => {
    const errors = [];
    for (const [key, prior] of [...gitConfigs.entries()].reverse()) {
      try {
        if (prior.existed) execFileSync('git', ['config', key, prior.previous], { cwd, stdio: 'pipe' });
        else execFileSync('git', ['config', '--unset', key], { cwd, stdio: 'pipe' });
      } catch (e) { errors.push(`git config ${key}: ${e && e.message ? e.message : e}`); }
    }
    for (const [file, bytes] of [...modified.entries()].reverse()) {
      try { writeFileSync(file, bytes); }
      catch (e) { errors.push(`${file}: ${e && e.message ? e.message : e}`); }
    }
    for (const file of [...created].reverse()) {
      try { if (existsSync(file)) rmSync(file, { force: true }); }
      catch (e) { errors.push(`${file}: ${e && e.message ? e.message : e}`); }
    }
    const deepestFirst = [...createdDirs].sort((a, b) => b.length - a.length);
    for (const dir of deepestFirst) {
      try {
        if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
      } catch (e) { errors.push(`${dir}: ${e && e.message ? e.message : e}`); }
    }
    return errors;
  };
  return { writeFile, mkdir, gitConfig, rollback, created, createdDirs, modified, gitConfigs };
}

const writeInstallFile = (tx, file, data) => {
  if (tx) tx.writeFile(file, data);
  else writeFileSync(file, data);
};

const mkdirInstall = (tx, dir) => {
  if (tx) tx.mkdir(dir);
  else mkdirSync(dir, { recursive: true });
};

function writePartialInstallRecord(cwd, error, rollbackErrors, tx) {
  try {
    mkdirSync(join(cwd, '.trust'), { recursive: true });
    writeFileSync(join(cwd, '.trust', 'onboarding-partial.json'), JSON.stringify({
      schema: 1,
      failedAt: new Date().toISOString(),
      error: String(error && error.message ? error.message : error),
      rollbackErrors,
      created: [...tx.created],
      modified: [...tx.modified.keys()],
    }, null, 2) + '\n');
  } catch { /* the failure record is best-effort; the nonzero exit is the contract */ }
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
function installLayers({ cwd, harness, components, refresh, tx = null }) {
  const copiedAdapters = [];
  const skippedAdapters = [];
  const missingAdapters = [];
  const refreshedAdapters = [];
  const driftedAdapters = [];
  const adapterHashes = {};
  const wiredConfigs = [];
  const unwiredConfigs = [];
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
          writeInstallFile(tx, dest, readFileSync(src));
          refreshedAdapters.push(dest);
          adapterHashes[dest] = shipped;
          console.log(`Hook (${label}): refreshed at ${dest} (was ${installed.slice(0, 12)}, now ${shipped.slice(0, 12)}).`);
        } else {
          driftedAdapters.push(dest);
          adapterHashes[dest] = installed;
          console.log(`Hook (${label}): ${dest} DIFFERS from the shipped copy (installed ${installed.slice(0, 12)}, shipped ${shipped.slice(0, 12)}) — left untouched; re-run with --refresh to update it.`);
        }
      } else {
        mkdirInstall(tx, dirname(dest));
        writeInstallFile(tx, dest, readFileSync(src));
        copiedAdapters.push(dest);
        adapterHashes[dest] = shipped;
        console.log(`Hook (${label}): copied to ${dest} (ON).`);
      }
    }
    if (harness === 'dsh' && copiedAdapters.length + skippedAdapters.length + refreshedAdapters.length + driftedAdapters.length > 0) {
      const beforePatches = new Map(dshProfileDirs(cwd).map((dir) => {
        const file = join(dir, 'cordis.patch.yml');
        return [file, existsSync(file) ? readFileSync(file, 'utf8') : ''];
      }));
      for (const line of wireDshProfiles(cwd, tx)) console.log(`dsh profile: ${line}`);
      for (const dir of dshProfileDirs(cwd)) {
        const file = join(dir, 'cordis.patch.yml');
        if (!existsSync(file)) continue;
        const before = beforePatches.get(file) || '';
        const after = readFileSync(file, 'utf8');
        if (after === before) {
          const reliedOn = [];
          if (after.includes('tna-veto')) reliedOn.push('tna-veto');
          if (after.includes('tna-discipline')) reliedOn.push('tna-discipline');
          if (reliedOn.length) wiredConfigs.push({ harness: 'dsh', file, entries: [], reliedOn });
          continue;
        }
        const entries = [];
        if (!before.includes('tna-veto') && after.includes('tna-veto')) entries.push('tna-veto');
        if (!before.includes('tna-discipline') && after.includes('tna-discipline')) entries.push('tna-discipline');
        const reliedOn = [];
        if (after.includes('tna-veto') && !entries.includes('tna-veto')) reliedOn.push('tna-veto');
        if (after.includes('tna-discipline') && !entries.includes('tna-discipline')) reliedOn.push('tna-discipline');
        if (entries.length || reliedOn.length) wiredConfigs.push({ harness: 'dsh', file, entries, reliedOn });
      }
    }
    // The user-level harnesses: copying the adapter is half the job — the
    // harness's own config must reference it or nothing ever runs. Merge into
    // the config (never clobber: foreign entries survive), and record the
    // file in did.wiredConfigs so --undo strips exactly our entries.
    const wire = WIRING[harness];
    if (wire) {
      const file = wire.file();
      const hookPath = join(homedir(), '.tna', 'veto-hooks', harness, 'hook.mjs');
      let cfg = {};
      let unparseable = false;
      if (existsSync(file)) {
        try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch { unparseable = true; }
      }
      if (unparseable) {
        console.error(`Hook config (${harness}): ${file} is not valid JSON — left untouched; fix it or remove it and re-run.`);
        unwiredConfigs.push(file);
      } else {
        const { merged, added, already, declined } = wire.plan(cfg, hookPath, components);
        const changed = added.length > 0 || JSON.stringify(merged) !== JSON.stringify(cfg);
        if (changed) {
          mkdirInstall(tx, dirname(file));
          writeInstallFile(tx, file, JSON.stringify(merged, null, 2) + '\n');
          wiredConfigs.push({ harness, file, entries: added, reliedOn: already.filter((a) => !/\s/.test(a)) });
          console.log(`Hook config (${harness}): wired ${added.join(', ') || 'nothing'} in ${file} (existing entries preserved).`);
        } else if (already.length) {
          const claims = already.filter((a) => !/\s/.test(a));
          if (claims.length) wiredConfigs.push({ harness, file, entries: [], reliedOn: claims });
        }
        for (const a of already) console.log(`Hook config (${harness}): already wired — ${a} (left as-is).`);
        for (const d of declined || []) console.log(`Hook config (${harness}): declined by consent — ${d} (stays OFF).`);
      }
    }
  }
  // Skills (origin 2026-10-25): the floor quotes the MANDATORY skills into
  // every session, but nothing installed them — the install shipped the
  // quoting and not the quoted. Consent to the floor installs them into the
  // directory THIS harness reads; a pre-existing skill is never overwritten.
  const skillsCopied = [];
  const skillsSkipped = [];
  const skillsShared = [];
  const skillsMissingSource = [];
  if (components.floor) {
    if (skillsDirsFor(harness, cwd).length === 0) {
      const note = skillsNoteFor(harness);
      if (note) console.log(note);
    }
    for (const dir of skillsDirsFor(harness, cwd)) {
      const r = installSkills(dir, { tx });
      if (r.missingSource) { skillsMissingSource.push(r.missingSource); continue; }
      const shared = !normalizePathKey(dir).startsWith(`${normalizePathKey(cwd)}/`);
      for (const p of r.copied) { skillsCopied.push(p); if (shared) skillsShared.push(p); }
      for (const n of r.skipped) { skillsSkipped.push(n); if (shared) skillsShared.push(join(dir, n)); }
      if (r.copied.length) console.log(`Skills: ${r.copied.length} installed into ${dir}.`);
      if (r.skipped.length) console.log(`Skills: ${r.skipped.length} already present in ${dir} (left untouched).`);
    }
    // A payload install (running from ~/.dsh/skills/setup-tna/) has no skills/
    // tree beside it. Reporting success with zero skills copied is the silent
    // no-op this check exists to prevent (dsh fix-list #10).
    if (skillsMissingSource.length) {
      throw new Error(`missing required skills source: ${skillsMissingSource[0]}`);
    }
  }
  if (missingAdapters.length) {
    throw new Error(`missing required adapter source(s): ${missingAdapters.join(', ')}`);
  }
  if (unwiredConfigs.length) {
    throw new Error(`invalid harness config(s): ${unwiredConfigs.join(', ')}`);
  }
  return { copiedAdapters, skippedAdapters, missingAdapters, refreshedAdapters, driftedAdapters, adapterHashes, skillsCopied, skillsSkipped, skillsShared, wiredConfigs, unwiredConfigs };
}

/**
 * Validate every input and source the first install knows it needs BEFORE the
 * first write. Environmental write failures can still happen after preflight;
 * those are the transaction rollback's domain. Predictable invalid input never
 * reaches the transaction at all.
 */
function preflightFirstInstall({ cwd, components, mapSkills, families }) {
  const errors = [];
  const ownership = readOwnershipRegistry();
  if (ownership.error) errors.push(ownership.error);
  if (components.overlays && mapSkills !== undefined && !Array.isArray(mapSkills)) {
    errors.push(`mapSkills must be an array (got: ${typeof mapSkills})`);
  }
  if (components.hooks) {
    const missing = new Set();
    for (const family of families) {
      // Preflight is read-only — it may never create the dsh acp fallback it
      // would report as installed to (roast r1 F5).
      for (const { src, label } of adaptersFor(family, cwd, { createFallback: false })) {
        if (!existsSync(src)) missing.add(`${label}: ${src}`);
      }
      const wire = WIRING[family];
      if (wire) {
        const file = wire.file();
        if (existsSync(file)) {
          try {
            const cfg = JSON.parse(readFileSync(file, 'utf8'));
            if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) errors.push(`invalid harness config (${family}): ${file} must contain a JSON object`);
          } catch {
            errors.push(`invalid harness config (${family}): ${file} is not valid JSON`);
          }
        }
      }
    }
    for (const item of missing) errors.push(`missing required adapter source — ${item}`);
    if (detectHarness(cwd) === 'opencode' && !existsSync(join(ROOT, '.opencode', 'plugins', 'tna-gate', 'index.js'))) {
      errors.push(`missing required adapter source — opencode veto plugin: ${join(ROOT, '.opencode', 'plugins', 'tna-gate', 'index.js')}`);
    }
  }
  if (components.floor && families.some((family) => skillsDirsFor(family, cwd).length > 0)) {
    const source = join(ROOT, 'skills');
    if (!existsSync(source)) {
      errors.push(`missing required skills source: ${source}`);
    } else {
      const required = [
        join('engineering', 'expect-fail'),
        join('engineering', 'root-cause'),
        join('discipline', 'receipts'),
      ];
      for (const rel of required) {
        const skillFile = join(source, rel, 'SKILL.md');
        if (!existsSync(skillFile)) errors.push(`missing required skills source: ${skillFile}`);
      }
    }
  }
  return errors;
}

/**
 * The shared first-install writer. Terminal prompts and --from-chat differ only
 * in how consent was collected; once collected they are the same operation,
 * with the same preflight, transaction, rollback, stamp, and receipt.
 * Returns the process exit status instead of exiting so the caller keeps the
 * channel-specific epilogue under its own control.
 */
async function runFirstInstall({ cwd, components, mapSkills, workflowChoice = '', consentSource, mapYes = true, refresh = false }) {
  const families = detectHarnessFamilies(cwd);
  const preflightErrors = preflightFirstInstall({ cwd, components, mapSkills, families });
  if (preflightErrors.length) {
    console.error('Install preflight failed — nothing was written:');
    for (const error of preflightErrors) console.error(`  - ${error}`);
    return 1;
  }

  const tx = createInstallTransaction(cwd);
  try {
    mkdirInstall(tx, join(cwd, '.trust'));
    warnOrphanEvidenceGate(components);
    // The stamp is private: make sure `.trust/` is gitignored — appending to
    // the adopter's existing .gitignore (never clobbering). Without this the
    // doctor fails right after a "successful" onboarding (the one-door
    // promise).
    let gitignoreAction = 'not-needed';
    let gitignoreHadTrailingNewline = null;
    if (components.floor || components.overlays) {
      const giPath = join(cwd, '.gitignore');
      const existed = existsSync(giPath);
      let gi = '';
      try { gi = readFileSync(giPath, 'utf8'); } catch { /* no .gitignore yet */ }
      if (!/(^|\n)\s*\.trust\/?\s*(\n|$)/.test(gi)) {
        gitignoreHadTrailingNewline = gi.endsWith('\n');
        const sep = gi.endsWith('\n') || gi === '' ? '' : '\n';
        writeInstallFile(tx, giPath, gi + sep + '.trust/\n');
        gitignoreAction = existed ? 'appended' : 'created';
      } else {
        gitignoreAction = 'already-present';
      }
    }
    let mapResult = null;
    if (components.overlays) {
      if (Array.isArray(mapSkills)) {
        for (const entry of mapSkills) {
          if (typeof entry !== 'string') console.log('Skipping non-string mapSkills entry: ' + JSON.stringify(String(entry).slice(0, 30)) + ' — only skill-name strings are accepted.');
        }
      }
      mapResult = await mapPhase(cwd, {
        yes: mapYes,
        onlySkills: Array.isArray(mapSkills) ? mapSkills.filter((e) => typeof e === 'string') : null,
        tx,
      });
    }
    // Consent is real (setup-tna unification): consenting hooks WIRES
    // core.hooksPath when this tree carries repository hooks. An adopter
    // project usually has no scripts/hooks directory; that is not an install
    // failure because the harness adapters and skills are the mechanical layer
    // there. Never point git at an absent hooks directory: git would silently
    // run no hooks, disabling pre-existing enforcement.
    let hooksPathSet = false;
    if (components.hooks) {
      const hooksDir = join(cwd, 'scripts', 'hooks');
      if (!existsSync(join(hooksDir, 'commit-msg')) && !existsSync(join(hooksDir, 'pre-commit'))) {
        console.log('hooks wiring skipped: scripts/hooks is not present in this tree (harness adapters/skills still install).');
      } else {
        try {
          tx.gitConfig(cwd, 'core.hooksPath', 'scripts/hooks');
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
    const harness = detectHarness(cwd);
    if (components.hooks && harness === 'opencode') {
      const srcPlugin = join(ROOT, '.opencode', 'plugins', 'tna-gate');
      const destPlugin = join(cwd, '.opencode', 'plugins', 'tna-gate');
      if (existsSync(destPlugin)) {
        console.log('Veto plugin: already present at .opencode/plugins/tna-gate (left untouched).');
      } else {
        copyTree(srcPlugin, destPlugin, tx);
        vetoPluginCopied = true;
        console.log('Veto plugin: copied to .opencode/plugins/tna-gate (mid-session veto is ON).');
      }
    }
    const layers = { copiedAdapters: [], skippedAdapters: [], missingAdapters: [], refreshedAdapters: [], driftedAdapters: [], adapterHashes: {}, skillsCopied: [], skillsSkipped: [], skillsShared: [], wiredConfigs: [], unwiredConfigs: [] };
    for (const family of families) {
      const r = installLayers({ cwd, harness: family, components, refresh, tx });
      layers.copiedAdapters.push(...r.copiedAdapters);
      layers.skippedAdapters.push(...r.skippedAdapters);
      layers.missingAdapters.push(...r.missingAdapters);
      layers.refreshedAdapters.push(...r.refreshedAdapters);
      layers.driftedAdapters.push(...r.driftedAdapters);
      Object.assign(layers.adapterHashes, r.adapterHashes);
      layers.skillsCopied.push(...r.skillsCopied);
      layers.skillsSkipped.push(...r.skillsSkipped);
      layers.skillsShared.push(...r.skillsShared);
      layers.wiredConfigs.push(...r.wiredConfigs);
      layers.unwiredConfigs.push(...r.unwiredConfigs);
    }
    const { copiedAdapters, skippedAdapters, missingAdapters, refreshedAdapters, driftedAdapters, adapterHashes, skillsCopied, skillsSkipped, wiredConfigs } = layers;
    if (missingAdapters.length) throw new Error(`missing required adapter source(s): ${missingAdapters.join(', ')}`);
    if (layers.unwiredConfigs.length) throw new Error(`invalid harness config(s): ${layers.unwiredConfigs.join(', ')}`);
    registerSharedOwnership({ cwd, families, components, layers, tx });
    if (families.length > 1) console.log(`Harnesses detected in this tree: ${families.join(', ')} — adapters installed for each.`);
    const vetoHookCopiedOmp = copiedAdapters.some((p) => p.includes(`${basename(join(homedir(), '.omp'))}`));
    const vetoHookCopiedPi = copiedAdapters.some((p) => p.endsWith(join('.pi', 'extensions', 'tna-veto.ts')));
    const did = { vetoPluginCopied, vetoHookCopiedOmp, vetoHookCopiedPi, copiedAdapters, refreshedAdapters, driftedAdapters, adapterHashes, skillsCopied, skillsSkipped, wiredConfigs, dshProfilesWired: families.includes('dsh') && components.hooks, overlays: mapResult ? mapResult.written : [], hooksPathSet, gitignoreAction, gitignoreHadTrailingNewline };
    writeInstallFile(tx, join(cwd, '.trust', 'onboarding.json'), serializeStamp({ components, harness, routerVersion: readRouterVersion(), did, workflowChoice }));
    const layersLine = components.hooks
      ? (harness === 'dsh'
        ? 'veto + discipline (mandatory-gate, done-gate) registered in every dsh profile; floor comes from dsh reading AGENTS.md'
        : harness === 'pi' || harness === 'omp'
          ? 'veto + discipline (floor, mandatory-gate, done-gate)'
          : harness === 'opencode'
            ? 'veto + evidence recorder (opencode plugin)'
            : harness === 'devin'
              ? 'veto + floor reinjection + mandatory-gate + evidence recorder (devin user hooks; no done-gate on this harness)'
              : harness === 'antigravity'
                ? 'veto + evidence recorder (agy Pre/PostToolUse; floor + done-gate not wired — no proven agy surface)'
                : harness === 'gemini'
                  ? 'veto + evidence recorder (gemini Before/AfterTool; floor + done-gate not wired)'
                  : harness === 'claude' || harness === 'codex'
                    ? 'veto hooks ship with the harness plugin (verify the hooks file in the payload)'
                    : `no mechanical adapter for '${harness}' — audit-only: the floor runs as prose, veto/done-gate are unavailable`)
      : 'hooks declined — every layer is mechanically OFF';
    if (refreshedAdapters.length) console.log(`  Refreshed: ${refreshedAdapters.length} adapter(s) updated to the shipped copy.`);
    if (driftedAdapters.length) console.log(`  Drift: ${driftedAdapters.length} adapter(s) differ from the shipped copy and were left untouched — re-run with --refresh.`);
    if (components.floor) console.log(`  Skills: ${skillsCopied.length} installed, ${skillsSkipped.length} already present (left untouched).`);
    const readinessRows = inspectLayerReadiness({ cwd, harness, components });
    const readinessLines = formatLayerReadiness(readinessRows, { adapterSelfTest: components.hooks ? 'not run by installer' : 'not run — hooks declined' });
    printReceipt({ components, routerVersion: readRouterVersion(), harness, stamped: true, mapResult, hooksPathSet, consentSource, layers: layersLine, readinessLines });
    return 0;
  } catch (e) {
    const rollbackErrors = tx.rollback();
    console.error(`Install failed: ${e && e.message ? e.message : e}`);
    if (rollbackErrors.length === 0) {
      console.error('Rollback complete: operation-owned partial writes removed; pre-existing bytes restored. Fix the cause and retry.');
    } else {
      writePartialInstallRecord(cwd, e, rollbackErrors, tx);
      console.error(`Rollback incomplete: ${rollbackErrors.length} item(s) could not be reverted. Recoverable partial-install record: .trust/onboarding-partial.json`);
      for (const error of rollbackErrors) console.error(`  - ${error}`);
    }
    return 1;
  }
}

/**
 * The refresh install path (origin 2026-10-25, retargeted 2026-11-02):
 * re-run the INSTALL layers against a stamped tree — never the consent flow.
 * Runs for `--from-chat --refresh` AND for a bare `--refresh` on a stamped
 * tree (the bare form is the exact command the doctor's stale-skills warning
 * tells adopters to run — routing it into the consent flow made the named
 * repair a dead end; measured 2026-11-02, pinned by onboarding.test E8).
 * Also writes .trust/tna-version: doctor C6 reads it and nothing else in the
 * CLI ever did, so a successful refresh left the doctor warning "stale"
 * forever. Returns a receipt string for the caller to print.
 */
function runRefreshInstallUnchecked({ cwd, components, existing, consentedAt, tx }) {
  // Refresh EVERY family installed on this machine, not just this project's
  // harness: an opencode project still carries omp/pi/dsh adapters on the same
  // disk, and those are exactly the copies that go stale unnoticed (measured
  // 2026-10-25 — doctor ran in an opencode repo and the pi/omp/dsh adapters
  // were all behind).
  const families = new Set(detectHarnessFamilies(cwd));
  for (const g of detectInstalledAdapters(cwd).groups) families.add(g.harness);
  const layers = { copiedAdapters: [], refreshedAdapters: [], driftedAdapters: [], adapterHashes: {}, skillsCopied: [], skillsSkipped: [], skillsShared: [], wiredConfigs: [] };
  for (const family of families) {
    const r = installLayers({ cwd, harness: family, components, refresh: true, tx });
    layers.copiedAdapters.push(...r.copiedAdapters);
    layers.refreshedAdapters.push(...r.refreshedAdapters);
    layers.driftedAdapters.push(...r.driftedAdapters);
    Object.assign(layers.adapterHashes, r.adapterHashes);
    layers.skillsCopied.push(...r.skillsCopied);
    layers.skillsSkipped.push(...r.skillsSkipped);
    layers.skillsShared.push(...r.skillsShared);
    layers.wiredConfigs.push(...r.wiredConfigs);
  }
  registerSharedOwnership({ cwd, families: [...families], components, layers, tx });
  const routerVersion = readRouterVersion();
  const did = {
    ...existing.did,
    copiedAdapters: [...new Set([...(existing.did.copiedAdapters || []), ...layers.copiedAdapters])],
    refreshedAdapters: layers.refreshedAdapters,
    driftedAdapters: layers.driftedAdapters,
    adapterHashes: { ...(existing.did.adapterHashes || {}), ...layers.adapterHashes },
    skillsCopied: [...new Set([...(existing.did.skillsCopied || []), ...layers.skillsCopied])],
    skillsSkipped: layers.skillsSkipped,
    wiredConfigs: [...(existing.did.wiredConfigs || []), ...layers.wiredConfigs],
    dshProfilesWired: families.has('dsh') ? true : existing.did.dshProfilesWired,
  };
  writeInstallFile(tx, join(cwd, '.trust', 'onboarding.json'), serializeStamp({ components: existing.components, harness: existing.harness, routerVersion, consentedAt: existing.consentedAt, workflowChoice: existing.workflowChoice, did }));
  // The version marker doctor C6 reads — a refresh that skipped this left the
  // doctor warning "stale" about an install it had just refreshed.
  mkdirInstall(tx, join(cwd, '.trust'));
  writeInstallFile(tx, join(cwd, '.trust', 'tna-version'), routerVersion);
  return [
    '',
    'Receipt',
    `  Consented: unchanged (consent was recorded ${consentedAt ? consentedAt.slice(0, 10) : 'earlier'}; --refresh never re-asks).`,
    `  Refreshed: ${layers.refreshedAdapters.length} adapter(s) updated to the shipped copy; ${layers.copiedAdapters.length} newly installed.`,
    ...(layers.driftedAdapters.length ? [`  Drift: ${layers.driftedAdapters.length} adapter(s) still differ (write failed?) — re-run --refresh.`] : []),
    `  Skills: ${layers.skillsCopied.length} installed, ${layers.skillsSkipped.length} already present (left untouched).`,
    '  Next: node scripts/doctor.mjs to confirm every adapter is current.',
  ].join('\n');
}

function runRefreshInstall(args) {
  const tx = createInstallTransaction(args.cwd);
  try {
    return runRefreshInstallUnchecked({ ...args, tx });
  } catch (e) {
    const rollbackErrors = tx.rollback();
    console.error(`Install refresh failed: ${e && e.message ? e.message : e}`);
    if (rollbackErrors.length === 0) {
      console.error('Rollback complete: operation-owned partial writes removed; pre-existing bytes restored. Fix the cause and retry.');
    } else {
      writePartialInstallRecord(args.cwd, e, rollbackErrors, tx);
      console.error(`Rollback incomplete: ${rollbackErrors.length} item(s) could not be reverted. Recoverable partial-install record: .trust/onboarding-partial.json`);
      for (const error of rollbackErrors) console.error(`  - ${error}`);
    }
    process.exit(1);
  }
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
    const ownershipState = readOwnershipRegistry();
    if (ownershipState.error) {
      console.error(`${ownershipState.error}. Undo refuses to continue: shared resources and registrations are left untouched.`);
      process.exit(1);
    }
    const ownership = ownershipState.registry;
    const ownerKey = normalizePathKey(cwd);
    let ownershipDirty = false;
    const allowedAdapterPath = (normalized) => normalized.includes('/.pi/extensions/')
      || normalized.includes('/.omp/agent/hooks/pre/')
      || normalized.includes('/.omp/agent/extensions/')
      || normalized.includes('/.dsh/profiles/')
      || normalized.includes('/.tna/');
    const sharedAdapterPath = (normalized) => normalized.includes('/.tna/')
      || normalized.includes('/.omp/')
      || normalized.includes('/.dsh/')
      || normalized.startsWith(`${normalizePathKey(homedir())}/.pi/`);
    const releaseFileResource = (key) => {
      const resource = ownership.resources[key];
      if (!resource || resource.kind !== 'file' || !resource.owners.includes(ownerKey)) return { status: 'unowned' };
      resource.owners = resource.owners.filter((owner) => owner !== ownerKey);
      ownershipDirty = true;
      if (resource.owners.length) return { status: 'shared', remaining: resource.owners.length };
      delete ownership.resources[key];
      return { status: 'final', hash: resource.hash };
    };
    const releaseConfigResource = (key) => {
      const resource = ownership.resources[key];
      if (!resource || resource.kind !== 'config' || !resource.owners.includes(ownerKey)) return { status: 'unowned' };
      resource.owners = resource.owners.filter((owner) => owner !== ownerKey);
      ownershipDirty = true;
      if (resource.owners.length) return { status: 'shared', remaining: resource.owners.length };
      delete ownership.resources[key];
      return { status: 'final', resource };
    };
    const expectedConfigFiles = (harness) => (harness === 'devin' ? devinConfigCandidates()
      : harness === 'antigravity' ? [agyConfigFile(), join(cwd, '.agents', 'hooks.json')]
        : harness === 'gemini' ? [geminiConfigFile(), join(cwd, '.gemini', 'settings.json')]
          : []).map(normalizePathKey);
    const validConfigPath = (harness, normalized) => harness === 'dsh'
      ? normalized.includes('/.dsh/profiles/') && normalized.endsWith('/cordis.patch.yml')
      : expectedConfigFiles(harness).includes(normalized);
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
    const ownedFileKeys = Object.keys(ownership.resources)
      .filter((key) => key.startsWith('file:') && ownership.resources[key].owners.includes(ownerKey));
    const handledAdapters = new Set();
    for (const key of ownedFileKeys) {
      const target = key.slice('file:'.length);
      const normalized = normalizePathKey(target);
      handledAdapters.add(normalized);
      if (!allowedAdapterPath(normalized)) {
        console.log('Skipping suspicious adapter path in ownership record: ' + JSON.stringify(normalized.slice(0, 60)));
        continue;
      }
      const release = releaseFileResource(key);
      if (release.status === 'shared') {
        console.log(`Hook adapter: preserved ${target} (${release.remaining} project owner(s) remain).`);
        continue;
      }
      if (!existsSync(target)) continue;
      if (release.status === 'final' && fileHash(target) !== release.hash) {
        console.log(`Hook adapter: ${target} differs from the operation-owned copy — user-modified file left untouched.`);
        continue;
      }
      rmSync(target, { force: true });
      console.log(`Hook adapter: removed ${target} after the final project owner released it.`);
    }
    for (const rawPath of [...(stamp.did.copiedAdapters || []), ...(stamp.did.refreshedAdapters || [])]) {
      const target = String(rawPath);
      const normalized = normalizePathKey(target);
      if (handledAdapters.has(normalized)) continue;
      if (!allowedAdapterPath(normalized)) {
        console.log('Skipping suspicious adapter path in stamp: ' + JSON.stringify(normalized.slice(0, 60)));
        continue;
      }
      if (sharedAdapterPath(normalized)) {
        console.log(`Hook adapter: preserved ${target} (no trustworthy ownership record; shared resources fail closed).`);
        continue;
      }
      if (existsSync(target)) {
        rmSync(target, { force: true });
        console.log(`Hook adapter: removed ${target} (it was copied by onboarding).`);
      }
    }
    // Skills this run created. Shared skill dirs (outside the project, e.g.
    // ~/.dsh/skills) ride the ownership registry like every other shared
    // resource: only the FINAL project owner deletes, and only while the copy
    // still matches the recorded bytes (roast r1 F2 — one project's undo used
    // to rmSync every stamped path under a sibling's feet). Project-local
    // copies are the tree's own and are removed outright; a shared path with
    // no trustworthy ownership record is preserved (fail closed).
    const allowedSkillPath = (normalized) => normalized.includes('/.agents/skills/') || normalized.includes('/.dsh/skills/');
    const handledSkills = new Set();
    const ownedDirKeys = Object.keys(ownership.resources)
      .filter((key) => key.startsWith('dir:') && ownership.resources[key].owners.includes(ownerKey));
    for (const key of ownedDirKeys) {
      const target = key.slice('dir:'.length);
      const normalized = normalizePathKey(target);
      handledSkills.add(normalized);
      if (!allowedSkillPath(normalized)) {
        console.log('Skipping suspicious skill path in ownership record: ' + JSON.stringify(normalized.slice(0, 60)));
        continue;
      }
      const resource = ownership.resources[key];
      resource.owners = resource.owners.filter((owner) => owner !== ownerKey);
      ownershipDirty = true;
      if (resource.owners.length) {
        console.log(`Skills: preserved ${target} (${resource.owners.length} project owner(s) remain).`);
        continue;
      }
      delete ownership.resources[key];
      if (!existsSync(target)) continue;
      if (dirHash(target) !== resource.hash) {
        console.log(`Skills: ${target} differs from the operation-owned copy — user-modified dir left untouched.`);
        continue;
      }
      rmSync(target, { recursive: true, force: true });
      console.log(`Skills: removed ${target} after the final project owner released it.`);
    }
    for (const rawPath of stamp.did.skillsCopied || []) {
      const target = String(rawPath);
      const normalized = normalizePathKey(target);
      if (handledSkills.has(normalized)) continue;
      if (!allowedSkillPath(normalized)) {
        console.log('Skipping suspicious skill path in stamp: ' + JSON.stringify(normalized.slice(0, 60)));
        continue;
      }
      if (!normalized.startsWith(`${ownerKey}/`)) {
        console.log(`Skills: preserved ${target} (no trustworthy ownership record; shared resources fail closed).`);
        continue;
      }
      if (existsSync(target)) { rmSync(target, { recursive: true, force: true }); }
    }
    if ((stamp.did.skillsCopied || []).length) {
      console.log(`Skills: ${(stamp.did.skillsCopied || []).length} skill dir(s) recorded by this install (shared ones released through the ownership registry above).`);
    }
    if (stamp.did.vetoHookCopiedPi === true) {
      const vetoPi = join(cwd, '.pi', 'extensions', 'tna-veto.ts');
      if (existsSync(vetoPi)) { rmSync(vetoPi, { force: true }); console.log('Veto hook (pi): removed .pi/extensions/tna-veto.ts (it was copied by onboarding).'); }
    }
    const ownedConfigKeys = Object.keys(ownership.resources)
      .filter((key) => key.startsWith('config:') && ownership.resources[key].owners.includes(ownerKey));
    const processedConfigs = new Set();
    const stampedEntriesFor = (harness, file) => {
      const normalized = normalizePathKey(file);
      const ids = [];
      for (const w of stamp.did.wiredConfigs || []) {
        if (w.harness !== harness || normalizePathKey(w.file) !== normalized) continue;
        for (const e of w.entries || []) ids.push(e);
      }
      return ids;
    };
    const stripConfigEntries = (harness, file, ids) => {
      if (harness === 'dsh') {
        writeFileSync(file, stripDshTnaRows(readFileSync(file, 'utf8'), new Set(ids)));
        return;
      }
      const cfg = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify(unwireConfigEntries(harness, cfg, ids), null, 2) + '\n');
    };
    // Per-entry release (roast r1 F3): our claim comes off every entry we
    // claimed; an entry NO project still claims is stripped by exact identity
    // (marker-gated), an entry another owner relies on survives — undo removes
    // exactly what this install wrote and nothing else.
    const unwireOwnedConfig = (key, resource) => {
      processedConfigs.add(key);
      const file = resource.file;
      const normalized = normalizePathKey(file);
      if (!validConfigPath(resource.harness, normalized)) {
        console.log('Skipping suspicious config path in ownership record: ' + JSON.stringify(normalized.slice(0, 60)));
        return;
      }
      const claims = resource.entries || {};
      const unclaimed = [];
      for (const eid of Object.keys(claims)) {
        if (!claims[eid].includes(ownerKey)) continue;
        const rest = claims[eid].filter((o) => o !== ownerKey);
        ownershipDirty = true;
        if (rest.length) claims[eid] = rest;
        else { delete claims[eid]; unclaimed.push(eid); }
      }
      const release = releaseConfigResource(key);
      if (release.status === 'unowned') return;
      const toStrip = [...new Set([...unclaimed, ...stampedEntriesFor(resource.harness, file)])]
        .filter((eid) => !(resource.entries?.[eid]?.length));
      if (!existsSync(file)) return;
      if (!toStrip.length) {
        console.log(`Hook config (${resource.harness}): preserved entries in ${file} (another project still claims them).`);
        return;
      }
      try {
        stripConfigEntries(resource.harness, file, toStrip);
        console.log(`Hook config (${resource.harness}): removed our entries (${toStrip.join(', ')}) from ${file}${release.status === 'shared' ? ` (${release.remaining} project owner(s) remain)` : ' after the final project owner released them'} — other entries left untouched.`);
      } catch {
        console.log(`Hook config (${resource.harness}): ${file} no longer parses — left untouched (remove our entries by hand).`);
      }
    };
    for (const key of ownedConfigKeys) unwireOwnedConfig(key, ownership.resources[key]);
    for (const w of stamp.did.wiredConfigs || []) {
      const file = String(w.file ?? '');
      if (!file) continue;
      const key = configResourceKey(w.harness, file);
      if (processedConfigs.has(key)) continue;
      const normalized = normalizePathKey(file);
      if (!validConfigPath(w.harness, normalized)) {
        console.log('Skipping suspicious config path in stamp: ' + JSON.stringify(file.slice(0, 60)));
        continue;
      }
      const ids = (w.entries || []).filter(Boolean);
      if (!ids.length || !existsSync(file)) continue;
      try {
        stripConfigEntries(w.harness, file, ids);
        console.log(`Hook config (${w.harness}): removed our entries (${ids.join(', ')}) from ${file} (stamp provenance; other entries left untouched).`);
      } catch {
        console.log(`Hook config (${w.harness}): ${file} no longer parses — left untouched (remove our entries by hand).`);
      }
    }
    // Reverse the .gitignore write this install recorded. A file onboarding
    // created is removed only while it still contains exactly that one line;
    // an append is stripped from the tail without disturbing later edits. If
    // the shape no longer matches, the file is user state and stays untouched.
    if (stamp.did.gitignoreAction === 'created' || stamp.did.gitignoreAction === 'appended') {
      const giPath = join(cwd, '.gitignore');
      if (existsSync(giPath)) {
        const body = readFileSync(giPath, 'utf8');
        if (stamp.did.gitignoreAction === 'created') {
          if (body === '.trust/\n') { rmSync(giPath, { force: true }); console.log('.gitignore: removed (onboarding created it).'); }
          else console.log('.gitignore: onboarding created it, but it now carries user edits — left untouched.');
        } else if (body.endsWith('.trust/\n')) {
          let prior = body.slice(0, body.length - '.trust/\n'.length);
          if (stamp.did.gitignoreHadTrailingNewline === false && prior.endsWith('\n')) prior = prior.slice(0, -1);
          writeFileSync(giPath, prior);
          console.log('.gitignore: removed the .trust/ line onboarding appended (other entries preserved).');
        } else {
          console.log('.gitignore: the appended .trust/ line is no longer at the tail — left untouched.');
        }
      }
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
    if (ownershipDirty) {
      if (Object.keys(ownership.resources).length) {
        writeFileSync(ownershipState.path, serializeOwnershipRegistry(ownership));
      } else if (existsSync(ownershipState.path)) {
        rmSync(ownershipState.path, { force: true });
      }
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
        console.log(runRefreshInstall({ cwd, components: existing.components, existing, consentedAt: existing.consentedAt }));
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

    const status = await runFirstInstall({
      cwd,
      components: answers.components,
      mapSkills: answers.mapSkills,
      workflowChoice: typeof answers.workflowChoice === 'string' ? answers.workflowChoice : '',
      consentSource: 'forwarded via --from-chat (agent channel)',
      mapYes: true,
      refresh: args.includes('--refresh'),
    });
    process.exit(status);
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

  // Bare --refresh on a stamped tree (E8, origin 2026-11-02): the doctor's
  // stale-skills warning names `node scripts/onboarding.mjs --refresh` as the
  // repair — a bare refresh that fell into the consent flow made that named
  // repair a dead end. A stamped tree goes straight to the install path
  // (never re-asks consent); a tree with no stamp refuses with the named next
  // step, exactly like --map-only.
  if (args.includes('--refresh')) {
    const stamp = parseStamp((() => { try { return readFileSync(join(cwd, '.trust', 'onboarding.json'), 'utf8'); } catch { return null; } })());
    if (!stamp) { console.error('No consent stamp — run node scripts/onboarding.mjs first.'); process.exit(1); }
    console.log(runRefreshInstall({ cwd, components: stamp.components, existing: stamp, consentedAt: stamp.consentedAt }));
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
  const status = await runFirstInstall({
    cwd,
    components,
    consentSource: args.includes('--yes') ? '--yes default menu' : 'interactive prompts',
    mapYes: args.includes('--yes'),
  });
  if (status !== 0) process.exit(status);
  printExitAndUpdate();
  printRehearsal();
}

/**
 * The evidence gate is a consent label, not an engine — its veto rides on the
 * hooks adapters (gate-hook's PreToolUse path). Consenting it while declining
 * hooks arms nothing; the stamp must not read as a gate that can fire.
 */
function warnOrphanEvidenceGate(components) {
  if (components.evidenceGate && !components.hooks) {
    console.error('Evidence gate: consented, but the hooks component is declined — the stamp records consent; NOTHING enforces it (the evidence veto rides on the hooks adapters).');
  }
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
