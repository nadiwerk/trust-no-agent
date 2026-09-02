#!/usr/bin/env node
/**
 * trust-no-agent structural validator.
 * Pure Node, zero dependencies. Run: node scripts/validate.mjs
 * Exit 0 = all checks pass. Exit 1 = structural drift found.
 *
 * Checks:
 *  1. Every skills/<cat>/<skill>/SKILL.md has a leading YAML frontmatter block
 *     whose `name` matches its folder.
 *  2. Every skill folder carries an agents/openai.yaml with a non-empty
 *     interface.display_name.
 *  3. Skill names are unique across the repo.
 *  4. Every backtick-quoted name referenced in AGENTS.md and WORKFLOW.md
 *     resolves to a real skill folder (or is a known non-skill term).
 *  5. Cross-references inside SKILL.md bodies resolve the same way.
 *  6. No unquoted frontmatter value contains ': ' — strict YAML parsers
 *     (e.g. the `npx skills` CLI) reject such scalars as nested mappings and
 *     silently skip the whole skill.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');

const errors = [];
const warn = (msg) => console.log('WARN  ' + msg);
const err = (msg) => { errors.push(msg); console.log('ERROR ' + msg); };

if (!existsSync(SKILLS)) {
  err('missing skills/ directory at ' + SKILLS);
  process.exit(1);
}

// ---- 1. frontmatter name === folder name; 2. openai.yaml present ----
const categories = readdirSync(SKILLS).filter((d) => statSync(join(SKILLS, d)).isDirectory());
const folderNames = new Set();
const declaredNames = new Set();

for (const cat of categories) {
  for (const skill of readdirSync(join(SKILLS, cat))) {
    const dir = join(SKILLS, cat, skill);
    if (!statSync(dir).isDirectory()) continue;

    const skillFile = join(dir, 'SKILL.md');
    if (!existsSync(skillFile)) { err(`missing SKILL.md: skills/${cat}/${skill}/`); continue; }
    const text = readFileSync(skillFile, 'utf8');
    // Frontmatter must be a leading --- block; extract only that block.
    const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!fmMatch) { err(`no YAML frontmatter block: skills/${cat}/${skill}/SKILL.md`); continue; }
    const fmName = fmMatch[1].match(/^name:\s*(.+)$/m);
    if (!fmName) { err(`no frontmatter name: skills/${cat}/${skill}/SKILL.md`); continue; }
    const name = fmName[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

    // Strict-YAML guard: an unquoted scalar value containing ': ' is parsed as
    // a nested mapping by strict YAML parsers, which then reject the document.
    // This is what made `npx skills add` silently skip these skills.
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s+([\s\S]*)$/);
      if (!kv) continue;
      const value = kv[2].trim();
      const quoted = (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
                     (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
      if (!quoted && /:\s/.test(value))
        err(`unquoted frontmatter "${kv[1]}" contains ': ' (strict YAML parse error): skills/${cat}/${skill}/SKILL.md`);
    }

    folderNames.add(skill);
    if (name !== skill) {
      err(`frontmatter name "${name}" != folder "${skill}"`);
    } else if (declaredNames.has(name)) {
      err(`duplicate skill name: ${name}`);
    } else {
      declaredNames.add(name);
    }

    const yaml = join(dir, 'agents', 'openai.yaml');
    if (!existsSync(yaml)) { warn(`no agents/openai.yaml: skills/${cat}/${skill}/`); continue; }
    const yamlText = readFileSync(yaml, 'utf8');
    if (!/interface:\s*\n\s*display_name:\s*\S+/.test(yamlText))
      err(`openai.yaml missing interface.display_name with value: skills/${cat}/${skill}/agents/openai.yaml`);
  }
}

// ---- 4 & 5. referenced skill names resolve ----
// Terms that appear in backticks but are not skills. Keep in sync with the
// actual prose; add new non-skill terms here only when they genuinely appear.
const NON_SKILL_TERMS = new Set([
  'progress.txt', 'package.json', 'uncertain', 'ready-for-agent', 'main', 'HEAD~5', 'npm', 'git', 'node',
  'fast', 'full', 'loop',
  'CONTEXT.md', 'CONTRIBUTING.md', '01', 'HEAD', 'Critical', 'Required', 'Nit', 'Optional', 'FYI',
  'yes', 'no', 'low', 'medium', 'high', 'block',
]);
const extractBacktickRefs = (text) =>
  [...text.matchAll(/`([A-Za-z0-9][A-Za-z0-9.-]*?)`/g)].map((m) => m[1]);

// All tracked-content files (markdown/scripts/configs), skipping gitignored dirs.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trust', '.omo', '.codegraph']);
const walkFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else if (/\.(md|mjs|yaml|yml|txt|json)$/.test(entry)) out.push(p);
  }
  return out;
};
const relPath = (p) => relative(ROOT, p);

// Chain lines appear fenced without per-name backticks; capture those too.
const extractFencedChainRefs = (text) =>
  [...text.matchAll(/^([a-z][a-z-]+) → ([a-z][a-z-]+) → ([a-z][a-z-]+) → ([a-z][a-z-]+) → ([a-z][a-z-]+) → ([a-z][a-z-]+)$/gm)]
    .map((m) => [m[1], m[2], m[3], m[4], m[5], m[6]])
    .flat();

const checkRefs = (text, source) => {
  for (const ref of new Set([...extractBacktickRefs(text), ...extractFencedChainRefs(text)])) {
    if (NON_SKILL_TERMS.has(ref)) continue;
    if (!declaredNames.has(ref) && !folderNames.has(ref))
      err(`${source} references unknown skill: \`${ref}\``);
  }
};

const readOrReport = (p, label) => {
  if (!existsSync(p)) { err(`missing required file: ${label}`); return null; }
  return readFileSync(p, 'utf8');
};

const agentsText = readOrReport(join(ROOT, 'AGENTS.md'), 'AGENTS.md');
const workflowText = readOrReport(join(ROOT, 'WORKFLOW.md'), 'WORKFLOW.md');
if (agentsText) checkRefs(agentsText, 'AGENTS.md');
if (workflowText) checkRefs(workflowText, 'WORKFLOW.md');

for (const cat of categories) {
  for (const skill of readdirSync(join(SKILLS, cat))) {
    const skillFile = join(SKILLS, cat, skill, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    checkRefs(readFileSync(skillFile, 'utf8'), `skills/${cat}/${skill}`);
  }
}

// ---- summary ----
if (errors.length) {
  console.error(`\nFAIL: ${errors.length} structural error(s).`);
  process.exit(1);
}
console.log(`OK: ${categories.length} categories, ${declaredNames.size} skills, no structural errors.`);
