#!/usr/bin/env node
/**
 * Fail-first test for the FULL-LAYER onboarding (2026-10-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * The adapters worked, but the INSTALL path did not deliver them. Measured
 * 2026-10-25 on a clean machine state:
 *
 *   1. `detectHarness()` had no `dsh` branch at all — it checked .opencode,
 *      .omp, .pi, ~/.codex/config.toml, ~/.claude, ~/.omo. A DeepSeek Harness
 *      user got NO hooks, NO profile patch, NO receipt line: dsh support was
 *      purely manual, which is how the whole session's work landed here.
 *   2. The hooks component copied only `tna-veto.ts` for omp/pi. The discipline
 *      adapter (floor + mandatory-gate + done-gate) had no copy path, so a fresh
 *      install shipped ONE of four layers.
 *   3. `--undo` reversed only what it knew about, so anything new copied would
 *      become residue.
 *
 * This test pins the install contract: for each of omp / pi / dsh, consenting to
 * the hooks component must place EVERY adapter the harness needs, and --undo
 * must remove exactly what it placed.
 *
 * Seam: the onboarding CLI (a subprocess), asserting on the files it leaves on
 * disk. Never on internals.
 *
 * Zero dependencies. Run: node scripts/onboarding-layers.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ONB = join(HERE, 'onboarding.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/** Run onboarding in a temp repo. `--from-chat` carries the consent answers.
 *  HOME/USERPROFILE point at a temp dir so a test can never touch the real
 *  ~/.omp, ~/.pi or ~/.dsh on the machine running it. */
function onboard(dir, harnessDir, answers) {
  if (harnessDir !== null) mkdirSync(join(dir, harnessDir), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), '# project router\n');
  writeFileSync(join(dir, '.gitignore'), '.trust/\n');
  const fakeHome = join(dir, 'home');
  mkdirSync(fakeHome, { recursive: true });
  const r = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify(answers)], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const ALL_LAYERS = { components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: [] };

// ---- AC1. pi: every adapter the harness needs ----
// pi has no plugin installer for local hooks, so the extension dir is the whole
// install: veto (the blocking layer) AND discipline (floor + mandatory + done).
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-pi-'));
  const r = onboard(dir, '.pi', ALL_LAYERS);
  const ext = join(dir, '.pi', 'extensions');
  check('AC1a pi onboarding exits 0', r.status === 0, r.out.slice(-400));
  check('AC1b pi gets the veto adapter', existsSync(join(ext, 'tna-veto.ts')), r.out.slice(-300));
  check('AC1c pi gets the discipline adapter (floor + mandatory + done)', existsSync(join(ext, 'tna-discipline.ts')), r.out.slice(-300));
  check('AC1d the receipt names all four layers, not just the veto',
    /floor|mandatory|discipline/i.test(r.out), r.out.slice(-500));
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC2. omp: same two adapters at the home hook dir ----
// The test cannot write to the real home dir safely, so it asserts the SOURCE
// payload exists for both adapters (the copy itself is AC1's shape, proven on pi
// where the target is project-local).
{
  check('AC2a omp veto adapter is shipped', existsSync(join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')));
  check('AC2b omp discipline adapter is shipped', existsSync(join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')));
}

// ---- AC3. dsh: detected, patched, and every profile wired ----
// The gap that mattered most: no dsh branch at all.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-dsh-'));
  const r = onboard(dir, '.dsh', ALL_LAYERS);
  check('AC3a dsh onboarding exits 0', r.status === 0, r.out.slice(-400));
  check('AC3b dsh is DETECTED as its own harness (not "unknown")',
    /harness dsh/.test(r.out), r.out.slice(-500));

  const profileDir = join(dir, '.dsh', 'profiles', 'acp');
  const patch = join(profileDir, 'cordis.patch.yml');
  check('AC3c the acp profile gets a cordis.patch.yml', existsSync(patch), profileDir);
  if (existsSync(patch)) {
    const body = readFileSync(patch, 'utf8');
    check('AC3d the patch registers tna-veto', /tna-veto/.test(body), body.slice(0, 400));
    check('AC3e the patch registers tna-discipline', /tna-discipline/.test(body), body.slice(0, 400));
  }
  check('AC3f the veto plugin file lands beside the profile', existsSync(join(profileDir, 'plugins', 'tna-veto.mjs')));
  check('AC3g the discipline plugin file lands beside the profile', existsSync(join(profileDir, 'plugins', 'tna-discipline.mjs')));
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC4. --undo leaves no residue ----
// Whatever onboarding placed must be reversible; an install that cannot be
// undone is a trap, and the stamp is the record of what it placed.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-undo-'));
  const r1 = onboard(dir, '.pi', ALL_LAYERS);
  check('AC4a install exits 0', r1.status === 0, r1.out.slice(-300));
  const ext = join(dir, '.pi', 'extensions');
  check('AC4b both adapters present before undo',
    existsSync(join(ext, 'tna-veto.ts')) && existsSync(join(ext, 'tna-discipline.ts')));

  const r2 = spawnSync(process.execPath, [ONB, '--undo'], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: join(dir, 'home'), USERPROFILE: join(dir, 'home') },
  });
  check('AC4c undo exits 0', r2.status === 0, `${r2.stdout ?? ''}${r2.stderr ?? ''}`.slice(-300));
  check('AC4d the veto adapter is removed', existsSync(join(ext, 'tna-veto.ts')) === false);
  check('AC4e the discipline adapter is removed', existsSync(join(ext, 'tna-discipline.ts')) === false);
  check('AC4f the stamp is gone', existsSync(join(dir, '.trust', 'onboarding.json')) === false);
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC5. A pre-existing copy is never clobbered ----
// The owner may have edited their adapter; onboarding must not overwrite it.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-layers-keep-'));
  mkdirSync(join(dir, '.pi', 'extensions'), { recursive: true });
  writeFileSync(join(dir, '.pi', 'extensions', 'tna-veto.ts'), '// OWNER EDITED\n');
  const r = onboard(dir, '.pi', ALL_LAYERS);
  check('AC5a onboarding exits 0 with a pre-existing adapter', r.status === 0, r.out.slice(-300));
  check('AC5b the owner copy is left untouched',
    readFileSync(join(dir, '.pi', 'extensions', 'tna-veto.ts'), 'utf8') === '// OWNER EDITED\n');
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
