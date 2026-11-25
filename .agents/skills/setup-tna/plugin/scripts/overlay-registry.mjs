#!/usr/bin/env node
/**
 * Overlay registry — parse + validate user skill overlays (decision-composition
 * ticket 01; spec AC1/AC2/AC3/AC14/AC15). Zero dependencies.
 *
 * An overlay is a skill directory holding one SKILL.md whose head carries YAML
 * frontmatter: `name` (required), `extends` (required — an anchor from the
 * derived canonical catalog), `role` (required — insert-before / insert-after /
 * wrap ONLY; replace / remove / skip are rejected: an external skill may add
 * steps, never subtract gates), `triggers` (optional, comma-separated; absent
 * = explicit-invocation-only).
 *
 * The anchor catalog is DERIVED from the canonical skills' phase headings —
 * a single source of truth, never a hand-maintained list that can drift. A
 * canonical skill without phase headings exposes no anchors, so no overlay can
 * attach to it (attachment requires a named phase).
 *
 * Run:  node scripts/overlay-registry.mjs [overlay-dir]   (prints entries + errors)
 * Exit 0 = registry consistent. Exit 1 = defects found.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROLES = new Set(['insert-before', 'insert-after', 'wrap']);
// `name` is required; `extends` and `role` are validated WHEN PRESENT —
// an explicit-only overlay (no anchor) is a first-class shape since the
// onboarding proposals land anchorless by default (onboarding spec).
const REQUIRED = ['name'];
// Injection hardening (roast security Required): the name is an identifier,
// each trigger a bounded keyword — both reach the session floor verbatim.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const TRIGGER_RE = /^[a-z0-9][a-z0-9 _-]{0,39}$/;

/**
 * Parse an overlay SKILL.md's frontmatter into an entry plus named errors.
 * Pure in shape: no filesystem, no catalog — validation against the anchor
 * catalog happens in parseSkillOverlays, so this seam is testable standalone.
 */
export function parseOverlayFrontmatter(text) {
  const src = String(text || '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!m)
    return { entry: { name: '', extends: '', role: '', triggers: [] }, errors: ['frontmatter block missing (--- ... --- at the file head)'] };
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z]+):\s*(.*)$/i.exec(line.trim());
    if (kv) fields[kv[1].toLowerCase()] = kv[2].trim();
  }
  const errors = [];
  for (const k of REQUIRED)
    if (!fields[k]) errors.push(`missing required field "${k}"`);
  if (fields.role && !ROLES.has(fields.role))
    errors.push(`illegal role "${fields.role}" — only insert-before/insert-after/wrap (an overlay may add steps, never subtract gates)`);
  // Injection hardening (roast security Required): name and triggers reach the
  // session floor verbatim, so the name is an identifier and each trigger a
  // bounded keyword. Agent-authored prose cannot become floor content.
  if (fields.name && !NAME_RE.test(fields.name))
    errors.push(`illegal name "${fields.name.slice(0, 40)}" — a lowercase identifier (letters, digits, hyphens) of at most 60 chars (the name reaches the session floor verbatim)`);
  const triggers = fields.triggers
    ? fields.triggers.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  for (const t of triggers)
    if (!TRIGGER_RE.test(t))
      errors.push(`illegal trigger "${t.slice(0, 40)}" — a lowercase keyword (letters, digits, spaces, underscores, hyphens) of at most 40 chars`);
  return {
    entry: { name: fields.name || '', extends: fields.extends || '', role: fields.role || '', triggers },
    errors,
  };
}

/**
 * Derive the canonical anchor catalog from the skills' phase headings.
 * "### Phase N — ..." in <skill>/SKILL.md yields the anchor "<skill>/Phase-N".
 * A skill without phase headings contributes nothing (no attachable phase).
 */
export function deriveAnchorCatalog(skillsRoot) {
  const catalog = new Set();
  if (!existsSync(skillsRoot)) return catalog;
  for (const d of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const file = join(skillsRoot, d.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^###\s+(Phase\s+\d+)/gim))
      catalog.add(`${d.name}/${m[1].replace(/\s+/g, '-')}`);
  }
  return catalog;
}

/**
 * Scan an overlay directory into validated entries plus named errors.
 * An absent directory is fail-open: zero entries, zero errors (the session
 * floor keeps its canonical portion byte-identical; the doctor reports nothing
 * to report). `skillsRoot` is injectable for tests; default is the repo's.
 */
export function parseSkillOverlays(overlayDir, { skillsRoot } = {}) {
  const entries = [];
  const errors = [];
  const catalog = deriveAnchorCatalog(skillsRoot || join(ROOT, 'skills', 'engineering'));
  if (!overlayDir || !existsSync(overlayDir)) return { entries, errors };
  for (const d of readdirSync(overlayDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const file = join(overlayDir, d.name, 'SKILL.md');
    if (!existsSync(file)) { errors.push(`${d.name}: missing skill file (SKILL.md)`); continue; }
    const { entry, errors: parseErrors } = parseOverlayFrontmatter(readFileSync(file, 'utf8'));
    for (const e of parseErrors) errors.push(`${d.name}: ${e}`);
    if (entry.extends && !catalog.has(entry.extends))
      errors.push(`${d.name}: anchor "${entry.extends}" is not in the derived canonical catalog`);
    if (!parseErrors.length && entry.name) entries.push({ ...entry, dir: d.name });
  }
  return { entries, errors };
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || join(ROOT, '.trust', 'skills-overlay');
  const res = parseSkillOverlays(dir);
  for (const e of res.errors) console.log('ERROR ' + e);
  for (const entry of res.entries)
    console.log(`ok - ${entry.dir} (${entry.name}) extends ${entry.extends} [${entry.role}] triggers=${entry.triggers.length ? entry.triggers.join('|') : 'explicit-only'}`);
  if (res.errors.length) { console.error(`\nFAIL: ${res.errors.length} registry defect(s).`); process.exit(1); }
  console.log(`\n${res.entries.length} overlay(s) validated.`);
}
