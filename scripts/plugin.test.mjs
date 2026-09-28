#!/usr/bin/env node
/**
 * Fail-first test for the plugin/ mirror — the marketplace payload.
 *
 * Origin: 2026-09-27/28 audit §9. The repo nested its skills by category
 * (skills/<category>/<name>/) while every install path flattens them
 * (skills/*\/*), and marketplace installers do NOT flatten. So a plugin
 * installed from the repo root would ship nested directories that non-recursive
 * discoverers cannot see — the exact silent failure docs/compatibility.md
 * finding #1 records. The fix is a plugin/ subdirectory carrying the flat
 * layout the installer expects.
 *
 * That fix creates a new hazard, and this test is the guard for it: plugin/ is
 * a MIRROR. It duplicates the router, the hook scripts, and every skill across
 * five harness directories, and it is invisible to validate.mjs and eval.mjs,
 * which read only skills/. A mirror that drifts is worse than no mirror — the
 * marketplace would ship a stale discipline layer while every repo gate stayed
 * green, which is the same "green receipt against the wrong target" class the
 * router's §6 rule exists for.
 *
 * So this test asserts the property that makes the mirror safe: every mirrored
 * file is byte-identical to its canonical source. It is deliberately a
 * comparison test, not a snapshot — a snapshot would have to be regenerated
 * whenever a skill changed, which is how a drift guard becomes a rubber stamp.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const PLUGIN = join(ROOT, 'plugin');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

/** Every skill dir in the canonical nested layout: { name, path }. */
const canonicalSkills = () => {
  const out = [];
  for (const cat of readdirSync(SKILLS)) {
    const catPath = join(SKILLS, cat);
    if (!statSync(catPath).isDirectory()) continue;
    for (const name of readdirSync(catPath)) {
      const p = join(catPath, name);
      if (statSync(p).isDirectory()) out.push({ name, path: p });
    }
  }
  return out;
};

/** Recursively collect relative file paths under a directory. */
const filesUnder = (dir, base = dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
};

const skills = canonicalSkills();

// ---- A. The marketplace manifest points at a real plugin root ----
{
  const mktPath = join(ROOT, '.claude-plugin', 'marketplace.json');
  check('A1 .claude-plugin/marketplace.json exists', existsSync(mktPath));
  let mkt = null;
  try { mkt = JSON.parse(readFileSync(mktPath, 'utf8')); } catch { /* reported below */ }
  check('A2 it parses as JSON', mkt !== null);
  const entry = mkt?.plugins?.find((p) => p.name === 'trust-no-agent');
  check('A3 it declares the trust-no-agent plugin', Boolean(entry), JSON.stringify(mkt?.plugins?.map((p) => p.name)));
  // The source path is the load-bearing field: point it at the repo root and the
  // installer ships the NESTED skills, which non-recursive discoverers skip.
  check('A4 its source is ./plugin (the flat layout), not the repo root',
    entry?.source === './plugin', String(entry?.source));
}

// ---- B. The plugin root carries what a plugin needs ----
{
  for (const [rel, why] of [
    // The manifest lives in .claude-plugin/ beside its marketplace.json — the
    // convention both reference marketplaces on this machine use.
    ['.claude-plugin/plugin.json', 'the install identifier'],
    ['hooks/hooks.json', 'the mechanical half — without it the skills sit inert'],
    ['AGENTS.md', 'the router'],
    ['WORKFLOW.md', 'the Iron Laws half of the floor'],
    ['scripts/gate-hook.mjs', 'the hook entry point both events call'],
    ['scripts/reinject.mjs', 'the floor extractor gate-hook delegates to'],
    ['scripts/mandatory-gate.mjs', 'the classifier gate-hook delegates to'],
  ]) {
    check(`B1 plugin/${rel} present (${why})`, existsSync(join(PLUGIN, rel)));
  }
}

// ---- C. hooks.json is portable — no machine-specific absolute path ----
// The hand-copied install this replaced hardcoded "C:/Users/Lenovo/...", so the
// plugin worked on exactly one machine. A published plugin must locate itself
// through the harness variable instead.
{
  const hooksText = readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8');
  check('C1 hooks.json uses ${CLAUDE_PLUGIN_ROOT}, not a hardcoded path',
    hooksText.includes('${CLAUDE_PLUGIN_ROOT}'), hooksText.match(/node "[^"]*"/)?.[0] ?? '');
  check('C2 hooks.json carries no absolute drive or home path',
    !/[A-Za-z]:[\\/]|\/Users\/|\/home\//.test(hooksText));
}

// ---- D. Plugin skills are flat (what the installer and non-recursive discoverers need) ----
{
  const flat = readdirSync(join(PLUGIN, 'skills')).filter((d) => statSync(join(PLUGIN, 'skills', d)).isDirectory());
  check('D1 plugin/skills holds exactly the 11 skills, flat',
    flat.length === skills.length && flat.every((d) => skills.some((s) => s.name === d)),
    `found ${flat.length}: ${flat.join(', ')}`);
  check('D2 no category nesting survived into the plugin',
    !flat.some((d) => ['discipline', 'engineering', 'meta'].includes(d)),
    flat.join(', '));
}

// ---- E. The mirror is byte-identical — the drift guard ----
{
  const mismatched = [];
  for (const { name, path } of skills) {
    const mirror = join(PLUGIN, 'skills', name);
    if (!existsSync(mirror)) { mismatched.push(`${name}: missing from plugin/skills`); continue; }
    const src = filesUnder(path);
    const dst = filesUnder(mirror);
    if (src.sort().join('|') !== dst.sort().join('|')) {
      mismatched.push(`${name}: file set differs (src ${src.length} vs mirror ${dst.length})`);
      continue;
    }
    for (const rel of src) {
      const a = readFileSync(join(path, rel));
      const b = readFileSync(join(mirror, rel));
      if (!a.equals(b)) mismatched.push(`${name}/${rel}: content differs`);
    }
  }
  check('E1 every plugin skill is byte-identical to its canonical source',
    mismatched.length === 0, mismatched.slice(0, 5).join('; '));
}

// ---- F. Per-harness mirrors are byte-identical too ----
// Same hazard, five more copies. A harness dir that drifted would ship a stale
// skill to that harness alone — the hardest kind of drift to notice.
{
  const harnesses = ['.claude', '.cursor', '.agents', '.opencode'];
  const mismatched = [];
  for (const h of harnesses) {
    const dir = join(PLUGIN, h, 'skills');
    if (!existsSync(dir)) { mismatched.push(`${h}: skills dir missing`); continue; }
    for (const { name, path } of skills) {
      const mirror = join(dir, name);
      if (!existsSync(mirror)) { mismatched.push(`${h}/${name}: missing`); continue; }
      for (const rel of filesUnder(path)) {
        const b = join(mirror, rel);
        if (!existsSync(b) || !readFileSync(join(path, rel)).equals(readFileSync(b)))
          mismatched.push(`${h}/${name}/${rel}: differs or missing`);
      }
    }
  }
  check(`F1 every per-harness skill copy (${harnesses.length} dirs) matches the canonical source`,
    mismatched.length === 0, mismatched.slice(0, 5).join('; '));
}

// ---- G. The plugin router files match the repo's ----
{
  for (const rel of ['AGENTS.md', 'WORKFLOW.md']) {
    const a = readFileSync(join(ROOT, rel));
    const b = readFileSync(join(PLUGIN, rel));
    check(`G1 plugin/${rel} is byte-identical to the repo copy`, a.equals(b));
  }
  for (const rel of ['reinject.mjs', 'mandatory-gate.mjs', 'gate-hook.mjs']) {
    const a = readFileSync(join(ROOT, 'scripts', rel));
    const b = readFileSync(join(PLUGIN, 'scripts', rel));
    check(`G2 plugin/scripts/${rel} is byte-identical to the repo copy`, a.equals(b));
  }
}

// ---- H. One version, one writer — the marketplace and plugin agree with the CHANGELOG ----
// Origin: the audit's §6 class, one layer up. `.trust/tna-version` and the
// installed plugin.json drifted to different versions and nothing read the
// second one, so doctor reported healthy while a manifest sat four releases
// behind. Publishing multiplies the writers: the CHANGELOG names the release,
// the marketplace advertises it, and the plugin manifest declares it. Three
// files, one fact — so they are checked against each other here rather than
// left to drift in the one place an installer actually reads.
{
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const released = (changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1] || '';
  check('H1 the CHANGELOG has a released version heading', released !== '', 'no [x.y.z] heading found');

  const mkt = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  const mktEntry = mkt.plugins?.find((p) => p.name === 'trust-no-agent');

  check(`H2 the marketplace entry advertises the released version (${released})`,
    mktEntry?.version === released, `marketplace says ${mktEntry?.version}`);
  check(`H3 the plugin manifest declares the released version (${released})`,
    plugin.version === released, `plugin.json says ${plugin.version}`);
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll plugin-mirror expectations hold.');
process.exit(failures ? 1 : 0);
