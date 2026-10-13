#!/usr/bin/env node
/**
 * Fail-first test for scripts/overlay-registry.mjs — the overlay registry parser
 * seam (decision-composition ticket 01; spec AC1/AC2/AC3/AC14/AC15, AC9 half).
 * Zero dependencies. Run: node scripts/overlay-registry.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = parser behavior drift.
 *
 * Seam: parseOverlayFrontmatter (frontmatter text -> entry + named errors),
 * deriveAnchorCatalog (canonical skill headings -> anchor set),
 * parseSkillOverlays (directory -> validated entries). Fixtures are hand-written
 * literals plus temp-dir round-trips against a synthetic skill (independent
 * source of truth).
 */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOverlayFrontmatter, deriveAnchorCatalog, parseSkillOverlays } from './overlay-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(HERE, '..', 'skills', 'engineering');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};
const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

// ---- A. Well-formed frontmatter parses (spec AC1) ----
{
  const res = parseOverlayFrontmatter([
    '---',
    'name: error-forensics',
    'extends: root-cause/Phase-1',
    'role: insert-after',
    'triggers: error, crash, stack trace',
    '---',
    '',
    '# error-forensics',
    'body text',
  ].join('\n'));
  check('A1 a well-formed overlay yields zero errors', res.errors.length === 0, JSON.stringify(res));
  check('A2 fields parse: name/extends/role/triggers',
    res.entry.name === 'error-forensics' && res.entry.extends === 'root-cause/Phase-1'
    && res.entry.role === 'insert-after' && res.entry.triggers.length === 3, JSON.stringify(res.entry));
}

// ---- B. Triggers absent = explicit-only (spec AC14) ----
{
  const res = parseOverlayFrontmatter([
    '---', 'name: manual-only', 'extends: root-cause/Phase-1', 'role: wrap', '---', 'body',
  ].join('\n'));
  check('B1 absent triggers parses as explicit-only (empty list, no error)',
    res.errors.length === 0 && Array.isArray(res.entry.triggers) && res.entry.triggers.length === 0, JSON.stringify(res));
}

// ---- C. Missing required fields rejected ----
{
  const noExtends = parseOverlayFrontmatter(['---', 'name: incomplete', 'role: insert-after', '---', 'body'].join('\n'));
  check('C1 missing extends is a named error', noExtends.errors.some((e) => /extends/.test(e)), JSON.stringify(noExtends.errors));
  const noRole = parseOverlayFrontmatter(['---', 'name: x', 'extends: root-cause/Phase-1', '---', 'b'].join('\n'));
  check('C2 missing role is a named error', noRole.errors.some((e) => /role/.test(e)), JSON.stringify(noRole.errors));
  const noBlock = parseOverlayFrontmatter('# no frontmatter at all');
  check('C3 a file without a frontmatter block is a named error', noBlock.errors.length > 0, JSON.stringify(noBlock.errors));
}

// ---- D. Illegal roles rejected (spec AC3) ----
{
  for (const role of ['replace', 'remove', 'skip']) {
    const res = parseOverlayFrontmatter(['---', 'name: x', 'extends: root-cause/Phase-1', `role: ${role}`, '---', 'b'].join('\n'));
    check(`D1 role "${role}" is rejected by name`, res.errors.some((e) => new RegExp(role).test(e)), JSON.stringify(res.errors));
  }
}

// ---- E. Unknown anchor rejected, naming it (spec AC2) ----
{
  const dir = tmp('overlay-e-');
  mkdirSync(join(dir, 'bad-anchor'), { recursive: true });
  writeFileSync(join(dir, 'bad-anchor', 'SKILL.md'),
    ['---', 'name: bad-anchor', 'extends: root-cause/Phase-99', 'role: insert-after', '---', 'b'].join('\n'));
  const res = parseSkillOverlays(dir, { skillsRoot: SKILLS_ROOT });
  check('E1 an anchor outside the derived catalog is rejected, naming it',
    res.errors.some((e) => /Phase-99/.test(e) && /catalog|anchor/i.test(e)), JSON.stringify(res.errors));
  rmSync(dir, { recursive: true, force: true });
}

// ---- F. Catalog derivation round-trips (spec AC15) ----
{
  const catalog = deriveAnchorCatalog(SKILLS_ROOT);
  check('F1 the real catalog carries root-cause/Phase-1..4 (derived from headings)',
    ['root-cause/Phase-1', 'root-cause/Phase-2', 'root-cause/Phase-3', 'root-cause/Phase-4'].every((a) => catalog.has(a)),
    JSON.stringify([...catalog]));
  const dir = tmp('overlay-f-');
  mkdirSync(join(dir, 'fixture-skill'), { recursive: true });
  writeFileSync(join(dir, 'fixture-skill', 'SKILL.md'), '# fixture\nno phases here');
  const before = deriveAnchorCatalog(dir);
  check('F2 a skill without phase headings exposes no anchors', before.size === 0, JSON.stringify([...before]));
  writeFileSync(join(dir, 'fixture-skill', 'SKILL.md'), '# fixture\n\n### Phase 1 - do the thing\n');
  const after = deriveAnchorCatalog(dir);
  check('F3 adding a phase heading makes the anchor appear without any registry edit',
    after.has('fixture-skill/Phase-1'), JSON.stringify([...after]));
  rmSync(dir, { recursive: true, force: true });
}

// ---- G. Missing skill file reported (spec AC9 half — the doctor surfaces it in 04) ----
{
  const dir = tmp('overlay-g-');
  mkdirSync(join(dir, 'empty-skill'), { recursive: true }); // no SKILL.md inside
  const res = parseSkillOverlays(dir, { skillsRoot: SKILLS_ROOT });
  check('G1 a skill directory without SKILL.md is a named error',
    res.errors.some((e) => /empty-skill/.test(e) && /SKILL\.md/.test(e) && /missing/i.test(e)), JSON.stringify(res.errors));
  rmSync(dir, { recursive: true, force: true });
}

// ---- H. Absent overlay directory is fail-open, not an error ----
{
  const res = parseSkillOverlays(join(tmpdir(), `overlay-absent-${Date.now()}`), { skillsRoot: SKILLS_ROOT });
  check('H1 an absent overlay directory yields zero entries and zero errors (fail-open)',
    res.entries.length === 0 && res.errors.length === 0, JSON.stringify(res));
}

// ---- I. Static scan: node: builtins only (spec AC11 section) ----
{
  const src = readFileSync(new URL('./overlay-registry.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  check('I1 the registry module imports nothing outside node: builtins',
    imports.length > 0 && imports.every((s) => s.startsWith('node:')), JSON.stringify(imports));
}

// ---- J. Closure scan: every new feature module imports node: only (spec AC11) ----
// Ticket 08's automated half: the zero-dependency constraint is checked
// across ALL modules the feature added (not just this one). A module with
// zero imports is trivially compliant (floor-composer is pure). RED observed
// against a deliberately dirtied module before this section landed.
{
  for (const mod of ['./overlay-registry.mjs', './floor-composer.mjs']) {
    const src = readFileSync(new URL(mod, import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    check(`J1 ${mod} imports nothing outside node: builtins (closure scan)`,
      imports.every((s) => s.startsWith('node:')), JSON.stringify(imports));
  }
}

console.log(failures === 0 ? '\nAll overlay-registry expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
