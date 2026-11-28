#!/usr/bin/env node
/**
 * Fail-first test for scripts/coverage.mjs — the absence-coverage checker.
 * Zero dependencies. Run: node scripts/coverage.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = checker behavior drift.
 *
 * Seam: checkCoverage(root) over a fixture tree — canonical skills under
 * skills/<cat>/<name>/, registries (trigger-eval TRIGGERS, doctor
 * FALLBACK_SKILLS, skills-lock.json, README skill tables), and mirror roots
 * (any `skills` dir holding >=1 canonical skill must hold all + per-skill
 * file superset). Boundary rule: a `skills` dir with ZERO canonical skills
 * is a warn, never an error (partial adopter installs are legitimate).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCoverage } from './coverage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/** Minimal canonical tree: skills/engineering/{alpha,beta} with SKILL.md + agents/openai.yaml. */
const writeSkill = (root, cat, name, withYaml = true) => {
  const dir = join(root, 'skills', cat, name);
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\n`);
  if (withYaml) writeFileSync(join(dir, 'agents', 'openai.yaml'), 'interface:\n  display_name: "X"\n');
};

/** Flat mirror: <root>/<payload>/skills/<name>/ (no category layer). */
const writeFlatMirror = (root, payload, name, withYaml = true) => {
  const dir = join(root, payload, 'skills', name);
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), 'x');
  if (withYaml) writeFileSync(join(dir, 'agents', 'openai.yaml'), 'x');
};

const base = () => {
  const root = mkdtempSync(join(tmpdir(), 'coverage-test-'));
  writeSkill(root, 'engineering', 'alpha');
  writeSkill(root, 'engineering', 'beta');
  return root;
};

// ---- A. Clean tree reports no errors ----
{
  const root = base();
  writeFlatMirror(root, 'mirror', 'alpha');
  writeFlatMirror(root, 'mirror', 'beta');
  const { errors } = checkCoverage(root, { registries: false });
  check('A clean fixture reports no errors', errors.length === 0, JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- B. Mirror missing a whole skill is an error naming it ----
{
  const root = base();
  writeFlatMirror(root, 'mirror', 'alpha');
  const { errors } = checkCoverage(root, { registries: false });
  check('B missing mirror skill is reported by name',
    errors.length > 0 && errors.some((e) => e.includes('beta')), JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- C. Mirror missing a canonical FILE inside a skill is an error ----
{
  const root = base();
  writeFlatMirror(root, 'mirror', 'alpha', false); // no agents/openai.yaml
  writeFlatMirror(root, 'mirror', 'beta');
  const { errors } = checkCoverage(root, { registries: false });
  check('C missing agents/openai.yaml in mirror is reported',
    errors.some((e) => e.includes('openai.yaml') && e.includes('alpha')), JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- D. A skills dir with ZERO canonical skills warns, never errors ----
{
  const root = base();
  const foreign = join(root, 'adopter', 'skills', 'other-skill');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'SKILL.md'), 'x');
  const { errors, warns } = checkCoverage(root, { registries: false });
  check('D zero-canonical skills dir warns not errors',
    errors.length === 0 && warns.length > 0, `errors=${JSON.stringify(errors)} warns=${JSON.stringify(warns)}`);
  rmSync(root, { recursive: true, force: true });
}

// ---- E. Registry missing a skill name is reported ----
{
  const root = base();
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'trigger-eval.mjs'),
    "const TRIGGERS = {\n  'alpha': ['x'],\n};\n");
  const { errors } = checkCoverage(root, { registries: true });
  check('E TRIGGERS missing beta is reported',
    errors.some((e) => e.includes('TRIGGERS') && e.includes('beta')), JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- F. Nested payload inside a skill dir may omit its parent (self-exclusion) ----
{
  const root = base();
  writeFlatMirror(root, 'skills/engineering/beta', 'alpha'); // beta's own payload ships alpha
  const { errors } = checkCoverage(root, { registries: false });
  check('F nested payload omitting its parent skill is not an error',
    errors.length === 0, JSON.stringify(errors));
  rmSync(root, { recursive: true, force: true });
}

// ---- G. The real repo is clean ----
{
  const { errors } = checkCoverage(ROOT, { registries: true });
  check('G real checkout reports no coverage errors', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
