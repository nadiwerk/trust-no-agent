#!/usr/bin/env node
/**
 * Skill-description audit — adapts the eval criteria from anthropics/skills
 * `skill-creator` (scripts/improve_description.py) to a static audit:
 *   1. Hard limit: description ≤ 1024 chars (Claude Code truncates above it).
 *   2. Imperative phrasing: "Use ..." beats "This skill does ..." — the
 *      description competes for trigger decisions, phrasing matters.
 *   3. Length: 100–200 words target (over 200 = context tax on every request,
 *      AGENTS.md §8 "descriptions are the only always-on cost").
 *   4. Invocation class: every description in the always-visible list pays
 *      rent on every request — report which skills auto-fire vs are gated
 *      (disable-model-invocation: true) so the cost is visible, not silent.
 *
 * Static by design: the full skill-creator loop (claude -p trigger evals,
 * should_trigger pairs, description rewriting) is the deep pass; this script
 * is the cheap gate that runs in CI without spawning sessions.
 *
 * Run:  node scripts/skill-desc-audit.mjs [skills-dir ...]
 * Exit 0 = no hard defects. Exit 1 = defect found (over-1024 / empty desc).
 * Advisory findings (not-imperative, verbose, auto-fires) print but do not fail.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = process.argv.slice(2);
const targets = dirs.length ? dirs : [join(ROOT, 'skills')];

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_-]+):\s*(.*)$/i.exec(line.trim());
    if (kv) fm[kv[1].toLowerCase()] = kv[2].trim();
  }
  return fm;
}

// Recursive: TNA canonical skills nest per category (skills/discipline/, skills/engineering/, ...)
function findSkills(dir, depth = 0) {
  if (depth > 3) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...findSkills(p, depth + 1));
    else if (e.name === 'SKILL.md') out.push(p);
  }
  return out;
}

let audited = 0, hard = 0;
const advisory = [];
const missing = targets.filter((dir) => !existsSync(dir));
if (missing.length || !targets.length) {
  console.error(
    `AUDIT-FAIL: target dir(s) missing or none given: ${missing.join(', ') || '(no args)'}\n` +
      `Usage: node scripts/skill-desc-audit.mjs <skills-dir> [more-dirs...]`
  );
  process.exit(1);
}
for (const dir of targets) {
  for (const p of findSkills(dir)) {
    const name = basename(dirname(p));
    audited++;
    const fm = parseFrontmatter(readFileSync(p, 'utf8'));
    const desc = (fm?.description || '').replace(/^["']|["']$/g, '').replace(/\\"/g, '"').trim();
    if (!desc) { console.log(`HARD  ${name}: empty description`); hard++; continue; }
    if (desc.length > 1024) { console.log(`HARD  ${name}: ${desc.length} chars > 1024 (truncation)`); hard++; continue; }
    const words = desc.split(/\s+/).length;
    const flags = [];
    if (!/^use\b/i.test(desc)) flags.push('not-imperative (advisory: prefer "Use ..." phrasing per skill-creator)');
    if (words > 200) flags.push(`verbose: ${words} words (advisory: target 100-200, every word taxes every request)`);
    if (fm['disable-model-invocation'] !== 'true') flags.push('auto-fires: in every session\'s visible list (confirm this is intended)');
    if (flags.length) advisory.push(`${name}: ${flags.join(' | ')}`);
  }
}
console.log(`\nAudited ${audited} skill descriptions across ${targets.length} dir(s).`);
if (advisory.length) console.log(`Advisory (${advisory.length}):\n  ` + advisory.join('\n  '));
if (hard) { console.log(`FAIL: ${hard} hard defect(s).`); process.exit(1); }
console.log('PASS: no hard defects (over-1024 / empty).');
