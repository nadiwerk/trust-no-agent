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
    ['scripts/overlay-registry.mjs', 'the overlay parser gate-hook delegates to'],
    ['scripts/floor-composer.mjs', 'the bounded floor composer gate-hook delegates to'],
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
  check('D1 plugin/skills holds exactly the 12 skills, flat',
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

// ---- F2. The /setup-tna command mirrors are byte-identical too ----
// (setup-command ticket 03) The chat front door ships per harness — a drifted
// copy would give one harness a stale procedure, the exact skill-mirror
// hazard one directory over.
{
  const harnesses = ['.claude', '.cursor', '.agents'];
  const mismatched = [];
  for (const h of harnesses) {
    const mirror = join(PLUGIN, h, 'commands', 'setup-tna.md');
    if (!existsSync(mirror)) { mismatched.push(`${h}: missing`); continue; }
    if (!readFileSync(join(ROOT, '.opencode', 'command', 'setup-tna.md')).equals(readFileSync(mirror)))
      mismatched.push(`${h}: differs`);
  }
  check(`F2 the /setup-tna command mirrors (${harnesses.length} harnesses) match the repo source`,
    mismatched.length === 0, mismatched.slice(0, 5).join('; '));
}

// ---- G. The plugin router files match the repo's ----
{
  for (const rel of ['AGENTS.md', 'WORKFLOW.md']) {
    const a = readFileSync(join(ROOT, rel));
    const b = readFileSync(join(PLUGIN, rel));
    check(`G1 plugin/${rel} is byte-identical to the repo copy`, a.equals(b));
  }
  // Derived-citation set, not a memorized list (ticket F2): a hand-pinned
  // array only pins files someone remembered — corrective-tier.mjs,
  // ledger-audit.mjs, stale-probe.mjs, tickets.mjs, doctor.mjs were cited by
  // the payload for releases while plugin/scripts/ never shipped them, and
  // this loop stayed green. So collect every `scripts/<name>.mjs` the payload
  // itself cites (markdown prose AND payload .mjs sources, which cite each
  // other and onboarding.mjs cites doctor.mjs), then require each to resolve
  // to an existing, byte-identical copy in plugin/scripts/.
  // `eval.mjs` and `*.test.mjs` are the deliberate exceptions: repo-internal
  // CI harness, adopted projects do not receive them (eval.mjs citations are
  // revoked in the same change that ships the other six; the reinject.test.mjs
  // sentence in the router names the repo's own fail-first proof, not an
  // adopter deliverable).
  // Three import shapes, not two. The static pair below missed
  // `await import('./gate-meter.mjs')` in doctor.mjs, so gate-meter.mjs was
  // cited by the payload but never shipped — and this loop stayed green for
  // releases (2026-10-22: every adopter's doctor printed "gate meter could not
  // run" while `node scripts/plugin.test.mjs` exited 0). A citation the
  // collector cannot see is indistinguishable from no citation at all, so the
  // dynamic form is collected here rather than left to the next audit.
  const cited = new Set();
  const cite = (text) => {
    for (const m of text.matchAll(/scripts\/([\w.-]+\.mjs)/g)) cited.add(m[1]);
    for (const m of text.matchAll(/from\s+'\.\/([\w.-]+\.mjs)'/g)) cited.add(m[1]);
    for (const m of text.matchAll(/import\(\s*['"]\.\/([\w.-]+\.mjs)['"]\s*\)/g)) cited.add(m[1]);
  };
  for (const rel of filesUnder(PLUGIN)) {
    if (!/\.(md|mjs)$/.test(rel)) continue;
    cite(readFileSync(join(PLUGIN, rel), 'utf8'));
  }
  for (const f of [...cited]) if (f === 'eval.mjs' || f.endsWith('.test.mjs')) cited.delete(f);
  // The owner's explicit ship list is pinned literally alongside the derived
  // set — a file Master named must ship even if the payload cites it nowhere
  // (doctor-checks.mjs is cited by no payload file today).
  const SHIP_LIST = ['corrective-tier.mjs', 'doctor-checks.mjs', 'doctor.mjs', 'gate-meter.mjs', 'ledger-audit.mjs', 'stale-probe.mjs', 'tickets.mjs'];
  for (const f of SHIP_LIST) cited.add(f);
  const missing = [...cited].filter((f) => !existsSync(join(PLUGIN, 'scripts', f))).sort();
  check('G2 every scripts/*.mjs cited by the payload resolves to a shipped file',
    missing.length === 0, `cited-but-missing: ${missing.join(', ')}`);
  for (const rel of [...cited].sort()) {
    const a = join(ROOT, 'scripts', rel);
    const b = join(PLUGIN, 'scripts', rel);
    if (!existsSync(b)) continue; // reported above
    if (!existsSync(a)) { check(`G2 plugin/scripts/${rel} has a canonical source`, false, 'no scripts/ source'); continue; }
    check(`G2 plugin/scripts/${rel} is byte-identical to the repo copy`, readFileSync(a).equals(readFileSync(b)));
  }
}

// ---- G3. The opencode plugin vendors its core — no escapes, no drift ----
// Ticket 01 (AC1): the adopter path copies .opencode/plugins/tna-gate/ into
// any project, so every .mjs beside index.js must equal scripts/<same>.
// Otherwise the shipped veto rots while tna-portable.test.mjs (which drives
// the vendored copy) stays green against a stale twin.
{
  const dir = join(ROOT, '.opencode', 'plugins', 'tna-gate');
  const vendored = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  check('G3 the plugin vendors its core modules', vendored.length > 0, vendored.join(','));
  for (const f of vendored) {
    const src = join(ROOT, 'scripts', f);
    if (!existsSync(src)) { check(`G3 vendored ${f} has a canonical source in scripts/`, false, 'no canonical source'); continue; }
    check(`G3 vendored ${f} is byte-identical to scripts/${f}`,
      readFileSync(src).equals(readFileSync(join(dir, f))));
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

// ---- I. Import closure (origin: install-path audit 2026-10-19, the omp
// failure class on the claude/codex path). gate-hook.mjs imports 6 local
// modules; onboarding.mjs and receipt-enforcement.mjs were NOT in
// plugin/scripts/ — every real claude/codex install crashed at import time
// (ERR_MODULE_NOT_FOUND, exit 1 per session prompt) while every in-repo test
// stayed green because the files exist beside the scripts here. G2 only pins
// files someone remembered to list; this pin walks the imports instead.
{
  // Derived from the shipped payload, not a remembered list. The hardcoded set
  // this replaces named eight modules and silently omitted doctor.mjs — the one
  // file whose import was actually broken — so the check could not see the
  // defect it exists to catch. A closure guard that enumerates its subjects by
  // hand is a rubber stamp for the files someone thought of.
  const shipped = readdirSync(join(PLUGIN, 'scripts')).filter((f) => f.endsWith('.mjs')).sort();
  check('I0 the payload ships at least one script to close over', shipped.length > 0, shipped.join(','));
  const localImport = (src) => [
    ...[...src.matchAll(/from\s+'\.\/([\w.-]+\.mjs)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\(\s*['"]\.\/([\w.-]+\.mjs)['"]\s*\)/g)].map((m) => m[1]),
  ];
  for (const f of shipped) {
    const missing = localImport(readFileSync(join(PLUGIN, 'scripts', f), 'utf8')).filter((d) => !existsSync(join(PLUGIN, 'scripts', d)));
    check(`I1 plugin/scripts/${f} import closure complete`, missing.length === 0, `missing: ${missing.join(', ')}`);
  }
  const srcHook = readFileSync(join(ROOT, 'scripts', 'gate-hook.mjs'), 'utf8');
  const hookDeps = localImport(srcHook);
  check('I2 gate-hook.mjs local imports are all shipped in plugin/scripts/',
    hookDeps.every((d) => existsSync(join(PLUGIN, 'scripts', d))),
    `imports: ${hookDeps.join(', ')} | missing: ${hookDeps.filter((d) => !existsSync(join(PLUGIN, 'scripts', d))).join(', ')}`);
}

// ---- J. skills-lock integrity (origin: install-path audit 2026-10-19).
// The lock's setup-tna hash went stale when the SKILL.md was rewritten after
// 6e744c3 and nobody regenerated the lock. Probed with the LIVE tool: the
// staleness does NOT break installs (the tool regenerates its own lock per
// machine — exit 0, 12/12 skills landed), and the hash algorithm is sha256
// over the RAW CHECKED-OUT bytes, so it is checkout-EOL-dependent and cannot
// be pinned CI-stable (a Linux runner reads LF, this tree checks out CRLF).
// The CI-stable pin is therefore EXISTENCE of every locked path (the omp
// class: entry ships but the file is gone); hash currency stays a
// maintainer-time record, refreshed by running the tool.
{
  const lock = JSON.parse(readFileSync(join(ROOT, 'skills-lock.json'), 'utf8'));
  for (const [name, e] of Object.entries(lock.skills || {})) {
    check(`J1 lock entry ${name} points at an existing file`, existsSync(join(ROOT, e.skillPath)), e.skillPath);
  }
}

// ---- K. Skill-count prose cannot go stale (origin: 2026-10-30 audit).
// Three files said "11 skills" while the canonical tree held 12, and every
// gate stayed green because no check read the prose. This pin derives the
// count from the canonical tree and rejects the stale number in payload text.
{
  const canonCount = skills.length;
  const NUM_WORDS = { 12: 'twelve' };
  const stale = (t) => /\b(eleven|11)\s+(discipline\s+)?skills?\b/i.test(t);
  const namesCount = (t) => new RegExp(`\\b${canonCount}\\s+(discipline\\s+)?skills?\\b`, 'i').test(t)
    || (NUM_WORDS[canonCount] ? new RegExp(`\\b${NUM_WORDS[canonCount]}\\s+(discipline\\s+)?skills?\\b`, 'i').test(t) : false);
  const payloadFiles = [
    join(PLUGIN, '.claude-plugin', 'plugin.json'),
    join(PLUGIN, 'plugin.json'),
    join(PLUGIN, '.codex-plugin', 'plugin.json'),
    join(ROOT, 'docs', 'installation.md'),
  ];
  for (const f of payloadFiles) {
    const rel = relative(ROOT, f).split('\\').join('/');
    const text = readFileSync(f, 'utf8');
    check(`K1 ${rel} names no stale 11/eleven skill count`, !stale(text), text.match(/\b(eleven|11)\s+(discipline\s+)?skills?\b/i)?.[0] ?? '');
    check(`K2 ${rel} names the canonical count (${canonCount})`, namesCount(text), `canonical: ${canonCount}`);
  }
  const doctorSrc = readFileSync(join(ROOT, 'scripts', 'doctor.mjs'), 'utf8');
  const fbMatch = doctorSrc.match(/const FALLBACK_SKILLS = \[([\s\S]*?)\];/);
  const fbNames = fbMatch ? [...fbMatch[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]) : [];
  check('K3 doctor FALLBACK_SKILLS matches the canonical count', fbNames.length === canonCount, `fallback: ${fbNames.length}, canonical: ${canonCount}`);
  check('K4 doctor FALLBACK_SKILLS includes setup-tna', fbNames.includes('setup-tna'), fbNames.join(', '));
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broken.` : '\nAll plugin-mirror expectations hold.');
process.exit(failures ? 1 : 0);
