#!/usr/bin/env node
/**
 * coverage.mjs — absence-coverage checker (roast r1 follow-up, coverage-check ticket 01).
 *
 * Every set that must contain all canonical artifacts is checked for silent
 * absence — the bug class that bit twice in the slice-it release (trigger-eval
 * had no vocabulary for the new skill; the sync walk never saw a wholly
 * missing mirror skill).
 *
 * Two checks:
 *   (a) registries — every declared registry must name every canonical skill:
 *       trigger-eval TRIGGERS, doctor FALLBACK_SKILLS, skills-lock.json,
 *       README.md + docs/skills/README.md skill tables.
 *   (b) mirror roots — a `skills` dir that holds >=1 canonical skill must hold
 *       ALL of them, and each mirrored skill's file set must be a superset of
 *       canonical (SKILL.md, agents/openai.yaml, ...). Discovery is a walk,
 *       not a pinned list — a new payload root is covered the moment it exists.
 *
 * Boundary rule: a `skills` dir with ZERO canonical skills is a warn, never an
 * error — partial adopter installs are legitimate by design.
 *
 * CLI: node scripts/coverage.mjs [--root dir] — exit 1 on any error.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trust', '.omo', '.omx', '.codegraph']);
const SKILL_CATEGORIES = ['discipline', 'engineering', 'meta'];

/** Relative paths of every file under `dir` (no symlink following). */
function walkFiles(dir, prefix = '') {
  const out = [];
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (st.isDirectory()) out.push(...walkFiles(p, rel));
    else out.push(rel);
  }
  return out;
}

/** Canonical skill name -> sorted relative file list. */
function canonicalSkills(root) {
  const map = new Map();
  for (const cat of SKILL_CATEGORIES) {
    const catDir = join(root, 'skills', cat);
    let names;
    try { names = readdirSync(catDir); } catch { continue; }
    for (const name of names) {
      const dir = join(catDir, name);
      if (existsSync(join(dir, 'SKILL.md'))) map.set(name, walkFiles(dir).sort());
    }
  }
  return map;
}

/** Skill names present in a `skills` dir, flat or categorized. */
function skillDirsIn(skillsDir, canonNames) {
  const found = [];
  let children;
  try { children = readdirSync(skillsDir); } catch { return found; }
  for (const child of children) {
    const p = join(skillsDir, child);
    let isDir = false;
    try { isDir = statSync(p).isDirectory(); } catch { continue; } // statSync follows junctions
    if (!isDir || SKIP_DIRS.has(child)) continue;
    if (existsSync(join(p, 'SKILL.md'))) { found.push({ name: child, dir: p }); continue; }
    // Category layer: <cat>/<skill>/SKILL.md
    let subs;
    try { subs = readdirSync(p); } catch { continue; }
    for (const sub of subs) {
      const sp = join(p, sub);
      try {
        if (statSync(sp).isDirectory() && existsSync(join(sp, 'SKILL.md')))
          found.push({ name: sub, dir: sp });
      } catch { /* skip */ }
    }
  }
  return found;
}

/** All `skills` dirs under root except the canonical one. */
function discoverSkillsDirs(root) {
  const canon = join(root, 'skills');
  const out = [];
  const visit = (dir) => {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      if (name === 'skills' && p !== canon) out.push(p);
      visit(p);
    }
  };
  visit(root);
  return out;
}

/** Quoted names inside a `const X = { ... };` / `[ ... ];` block. */
function namesInBlock(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const tail = text.slice(i);
  const end = tail.search(/^};/m) >= 0 ? tail.search(/^};/m) : tail.indexOf('];');
  const block = tail.slice(0, end < 0 ? tail.length : end + 2);
  return [...block.matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]);
}

export function checkCoverage(root, { registries = true } = {}) {
  const errors = [];
  const warns = [];
  const canon = canonicalSkills(root);
  const canonNames = new Set(canon.keys());
  const rel = (p) => relative(root, p);

  // ---- (a) registries must name every canonical skill ----
  if (registries) {
    const registryChecks = [
      { file: join(root, 'scripts', 'trigger-eval.mjs'), marker: 'const TRIGGERS', label: 'TRIGGERS' },
      { file: join(root, 'scripts', 'doctor.mjs'), marker: 'const FALLBACK_SKILLS', label: 'FALLBACK_SKILLS' },
    ];
    for (const { file, marker, label } of registryChecks) {
      if (!existsSync(file)) continue;
      const names = namesInBlock(readFileSync(file, 'utf8'), marker);
      if (!names) continue;
      for (const skill of canonNames)
        if (!names.includes(skill)) errors.push(`${label} missing canonical skill: ${skill}`);
    }
    const lock = join(root, 'skills-lock.json');
    if (existsSync(lock)) {
      try {
        const locked = Object.keys(JSON.parse(readFileSync(lock, 'utf8')).skills ?? {});
        for (const skill of canonNames)
          if (!locked.includes(skill)) errors.push(`skills-lock.json missing canonical skill: ${skill}`);
      } catch { warns.push('skills-lock.json unreadable'); }
    }
    for (const doc of ['README.md', join('docs', 'skills', 'README.md')]) {
      const p = join(root, doc);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      for (const skill of canonNames)
        if (!text.includes(`\`${skill}\``)) errors.push(`${doc} missing skill row: ${skill}`);
    }
  }

  // ---- (b) mirror roots: presence of any canonical skill obligates all ----
  for (const dir of discoverSkillsDirs(root)) {
    const found = skillDirsIn(dir, canonNames);
    const canonicalFound = found.filter((f) => canonNames.has(f.name));
    if (canonicalFound.length === 0) {
      if (found.length > 0) warns.push(`${rel(dir)} holds ${found.length} non-canonical skill(s) — not a mirror, skipped`);
      continue;
    }
    const present = new Set(canonicalFound.map((f) => f.name));
    // Self-exclusion: a skills dir nested inside a skill dir (the installer's
    // own payload, e.g. setup-tna/skills) legitimately omits its parent —
    // an installer does not ship itself.
    const selfName = existsSync(join(dirname(dir), 'SKILL.md')) ? basename(dirname(dir)) : null;
    for (const skill of canonNames)
      if (!present.has(skill) && skill !== selfName)
        errors.push(`${rel(dir)} missing canonical skill: ${skill}`);
    for (const f of canonicalFound) {
      const mirrorFiles = new Set(walkFiles(f.dir));
      for (const relFile of canon.get(f.name))
        if (!mirrorFiles.has(relFile)) errors.push(`${rel(f.dir)} missing canonical file: ${relFile}`);
    }
  }

  return { errors, warns, stats: { canonical: canonNames.size } };
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argIdx = process.argv.indexOf('--root');
  const root = argIdx >= 0 ? resolve(process.argv[argIdx + 1]) : ROOT;
  const { errors, warns, stats } = checkCoverage(root, { registries: true });
  for (const w of warns) console.log(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
  if (errors.length) {
    console.error(`FAIL: ${errors.length} coverage error(s)`);
    process.exit(1);
  }
  console.log(`OK: coverage holds — ${stats.canonical} canonical skills, registries + mirror roots complete.`);
}
