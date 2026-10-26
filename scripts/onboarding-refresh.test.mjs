#!/usr/bin/env node
/**
 * Fail-first test for the UPDATE path and the SKILLS install path (2026-10-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2026-10-25 install-path repair delivered every adapter, but left three
 * holes that only bite an EXISTING install — measured on this machine:
 *
 *   1. NO UPDATE PATH. Onboarding skips a destination that already exists
 *      ("left untouched"). So when the framework ships a new adapter, an old
 *      install never receives it — measured: `~/.pi/agent/extensions/tna-discipline.ts`
 *      and `~/.omp/agent/hooks/pre/tna-discipline.ts` both DIFFER from the repo
 *      canonical copy, and nothing tells the operator. A copy-once install with
 *      no reconciliation is how a stale veto keeps reporting green.
 *   2. NO DRIFT VISIBILITY. Even without overwriting, the installer said nothing
 *      about the difference, so "hooks: consented" read as "hooks current".
 *   3. NO SKILLS. `onboarding.mjs` copied zero skill directories, so "one
 *      command installs TNA" was true for hooks only; the 12 skills stayed a
 *      manual `cp -r` in the docs.
 *
 * This test pins the contract:
 *   - `--refresh` reconciles an installed adapter with the shipped copy and
 *     records the content hash in the stamp (so doctor can verify later).
 *   - WITHOUT `--refresh`, an existing adapter is still left untouched, but the
 *     drift is NAMED (never silent).
 *   - consenting the floor component installs the skills into the harness's own
 *     discovery dir, and `--undo` removes exactly what it created.
 *
 * Seam: the onboarding CLI (a subprocess), asserting on files it leaves on disk.
 * HOME/USERPROFILE point at a temp dir, so a test can never touch the real
 * ~/.pi, ~/.omp or ~/.dsh on the machine running it.
 *
 * Zero dependencies. Run: node scripts/onboarding-refresh.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Run onboarding in a temp repo. `extraArgs` rides after the answers JSON. */
function onboard(dir, harnessDir, answers, extraArgs = []) {
  if (harnessDir !== null) mkdirSync(join(dir, harnessDir), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), '# project router\n');
  writeFileSync(join(dir, '.gitignore'), '.trust/\n');
  const fakeHome = join(dir, 'home');
  mkdirSync(fakeHome, { recursive: true });
  const r = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify(answers), ...extraArgs], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const ALL = { components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: [] };

// ---- AC1. --refresh reconciles a drifted adapter (the update path) ----
// The exact failure measured on this machine: an installed discipline adapter
// that differs from the shipped one and is silently kept forever.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-refresh-'));
  const ext = join(dir, '.pi', 'extensions');
  mkdirSync(ext, { recursive: true });
  writeFileSync(join(ext, 'tna-veto.ts'), '// STALE ADAPTER FROM AN OLD RELEASE\n');

  const r = onboard(dir, '.pi', ALL, ['--refresh']);
  const canonical = readFileSync(join(ROOT, 'veto-hooks', 'pi', 'tna-veto.ts'));
  const installed = readFileSync(join(ext, 'tna-veto.ts'));

  check('AC1a --refresh exits 0', r.status === 0, r.out.slice(-400));
  check('AC1b the stale adapter is replaced by the shipped copy',
    installed.equals(canonical), `installed ${sha(installed).slice(0, 12)} vs canonical ${sha(canonical).slice(0, 12)}`);
  check('AC1c the receipt names the refresh, not "left untouched"',
    /refresh/i.test(r.out) && !/tna-veto\.ts.*left untouched/i.test(r.out), r.out.slice(-600));

  // The stamp records the content hash of what it wrote — doctor's only way to
  // notice drift later without guessing which file was current.
  const stamp = JSON.parse(readFileSync(join(dir, '.trust', 'onboarding.json'), 'utf8'));
  const hashes = stamp.did && stamp.did.adapterHashes ? stamp.did.adapterHashes : {};
  const recorded = Object.entries(hashes).find(([p]) => p.endsWith('tna-veto.ts'));
  check('AC1d the stamp records the adapter content hash',
    Boolean(recorded) && recorded[1] === sha(canonical), JSON.stringify(hashes).slice(0, 300));

  rmSync(dir, { recursive: true, force: true });
}

// ---- AC2. Without --refresh the owner copy survives AND the drift is named ----
// Never clobber silently (AC5 of onboarding-layers.test.mjs still holds), but
// silence is what made a stale install look current.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-refresh-keep-'));
  const ext = join(dir, '.pi', 'extensions');
  mkdirSync(ext, { recursive: true });
  writeFileSync(join(ext, 'tna-veto.ts'), '// OWNER EDITED\n');

  const r = onboard(dir, '.pi', ALL);
  check('AC2a the owner copy is left untouched without --refresh',
    readFileSync(join(ext, 'tna-veto.ts'), 'utf8') === '// OWNER EDITED\n', r.out.slice(-300));
  check('AC2b the drift is NAMED (the operator is told to run --refresh)',
    /differs|drift/i.test(r.out) && /--refresh/.test(r.out), r.out.slice(-800));
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC3. Consenting the floor installs the skills into the harness dir ----
// "floor" is the component that quotes the MANDATORY skills into every session;
// quoting a skill that was never installed is the inert half-install.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-skills-pi-'));
  const r = onboard(dir, '.pi', ALL);
  const skillsDir = join(dir, '.agents', 'skills');
  const has = (name) => existsSync(join(skillsDir, name, 'SKILL.md'));
  check('AC3a onboarding exits 0', r.status === 0, r.out.slice(-400));
  check('AC3b a canonical skill lands in the harness discovery dir', has('receipts'), skillsDir);
  check('AC3c the MANDATORY trio is present', has('expect-fail') && has('root-cause') && has('receipts'), skillsDir);
  check('AC3d the receipt reports how many skills were installed',
    /Skills:\s*\d+\s+installed/.test(r.out), r.out.slice(-600));

  const stamp = JSON.parse(readFileSync(join(dir, '.trust', 'onboarding.json'), 'utf8'));
  const copied = (stamp.did && stamp.did.skillsCopied) || [];
  check('AC3e the stamp records the skills it created (for --undo)', copied.length >= 3, JSON.stringify(copied).slice(0, 200));

  // --undo removes what it created.
  const u = spawnSync(process.execPath, [ONB, '--undo'], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, HOME: join(dir, 'home'), USERPROFILE: join(dir, 'home') },
  });
  check('AC3f --undo exits 0', u.status === 0, `${u.stdout ?? ''}${u.stderr ?? ''}`.slice(-300));
  check('AC3g --undo removes the installed skills (no residue)', has('receipts') === false, skillsDir);
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC4. A pre-existing skill is never overwritten ----
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-skills-keep-'));
  const skillsDir = join(dir, '.agents', 'skills');
  mkdirSync(join(skillsDir, 'receipts'), { recursive: true });
  writeFileSync(join(skillsDir, 'receipts', 'SKILL.md'), '# OWNER receipts\n');
  const r = onboard(dir, '.pi', ALL);
  check('AC4a onboarding exits 0 with a pre-existing skill', r.status === 0, r.out.slice(-300));
  check('AC4b the owner skill is left untouched',
    readFileSync(join(skillsDir, 'receipts', 'SKILL.md'), 'utf8') === '# OWNER receipts\n', r.out.slice(-300));
  rmSync(dir, { recursive: true, force: true });
}

// ---- AC5. dsh gets the skills where dsh actually reads them ----
// dsh reads $DSH_HOME/skills/<name>/SKILL.md — not .agents/skills.
{
  const dir = mkdtempSync(join(tmpdir(), 'tna-skills-dsh-'));
  const r = onboard(dir, '.dsh', ALL);
  const home = join(dir, 'home');
  const dshSkills = join(home, '.dsh', 'skills');
  check('AC5a dsh onboarding exits 0', r.status === 0, r.out.slice(-400));
  check('AC5b skills land in ~/.dsh/skills (the dir dsh reads)',
    existsSync(join(dshSkills, 'receipts', 'SKILL.md')), dshSkills);
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
