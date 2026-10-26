#!/usr/bin/env node
/**
 * sync-payloads.mjs — the payload generator (zero-drift contract).
 *
 * Origin: install-path audit 2026-10-19. Three of nine setup-tna payload
 * roots carried pre-0.1.39 veto adapters (a real user-reported bug) and
 * plugin/scripts/ shipped two pre-hardening modules — while every byte-sync
 * pin stayed green, because the pins enumerated a REMEMBERED list of mirrors
 * and the drifted roots were not on it. This generator replaces the lists:
 *
 *   DISCOVERY  every directory named `setup-tna` holding a SKILL.md, found by
 *              walking the working directory (never .trust/ — that is user
 *              state, not distribution). A new payload location is covered by
 *              construction; no list to forget.
 *   CANONICAL  resolved from THIS script's own location (repo root):
 *              skills/meta/setup-tna/* for payload files, scripts/ for the
 *              shared .mjs modules — mirrors never become canonical.
 *   CHECK      default mode: every mirror file must exist and be byte-identical
 *              to canonical. Any drift = exit 1 with the paths named.
 *   --write    repair mode: copy canonical over drifted/missing mirror files.
 *   --list     print the discovered roots.
 *
 * Also enforced here (same zero-drift contract, same discovery rule — a file
 * that exists in both places must be the same file):
 *   plugin/scripts/*.mjs  <-> scripts/*.mjs (same-name comparison)
 *   .opencode/plugins/tna-gate/*.mjs <-> scripts/*.mjs
 *
 * Distribution-shape rationale (why mirrors exist at all): payloads are
 * self-contained installs per harness; deduplicating them is a distribution
 * format change, out of scope. What this script removes is the MANUAL TOIL
 * and the silent drift — run `--write` after editing any shared file.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync, lstatSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CANON_SKILL = join(ROOT, 'skills', 'meta', 'setup-tna');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trust', '.omx']);

// Relative path inside a setup-tna root -> canonical file (resolved from ROOT
// or CANON_SKILL). These are the DISTRIBUTION CONTRACT, not a mirror list:
// the paths a payload must carry; the ROOTS are discovered.
const PAYLOAD_MAP = [
  ['SKILL.md', join(CANON_SKILL, 'SKILL.md')],
  ['agents/openai.yaml', join(CANON_SKILL, 'agents', 'openai.yaml')],
  ['references/AGENTS.md', join(ROOT, 'AGENTS.md')],
  ['references/WORKFLOW.md', join(ROOT, 'WORKFLOW.md')],
  ['scripts/onboarding.mjs', join(ROOT, 'scripts', 'onboarding.mjs')],
  ['scripts/file-budget.mjs', join(ROOT, 'scripts', 'file-budget.mjs')],
  ['veto-hooks/omp/tna-veto.ts', join(ROOT, 'veto-hooks', 'omp', 'tna-veto.ts')],
  ['veto-hooks/omp/tna-discipline.ts', join(ROOT, 'veto-hooks', 'omp', 'tna-discipline.ts')],
  ['veto-hooks/omp/tna-receipts-gate.ts', join(ROOT, 'veto-hooks', 'omp', 'tna-receipts-gate.ts')],
  ['veto-hooks/pi/tna-veto.ts', join(ROOT, 'veto-hooks', 'pi', 'tna-veto.ts')],
  ['veto-hooks/pi/tna-discipline.ts', join(ROOT, 'veto-hooks', 'pi', 'tna-discipline.ts')],
  ['veto-hooks/dsh/tna-veto.mjs', join(ROOT, 'veto-hooks', 'dsh', 'tna-veto.mjs')],
  ['veto-hooks/dsh/tna-discipline.mjs', join(ROOT, 'veto-hooks', 'dsh', 'tna-discipline.mjs')],
];

const walk = (dir, acc = []) => {
  let names;
  try { names = readdirSync(dir); } catch { return acc; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    // Junctions/symlinks are LOCAL INSTALL STATE (e.g. .claude/skills/setup-tna
    // on this machine, from an onboarding run) — never distribution mirrors,
    // and following them risks cycles and broken Dirents. Skipped by structure.
    if (st.isSymbolicLink()) continue;
    if (!st.isDirectory()) continue;
    if (name === 'setup-tna' && existsSync(join(p, 'SKILL.md'))) acc.push(p);
    else walk(p, acc);
  }
  return acc;
};

const discoverRoots = () => {
  const cwd = process.cwd();
  // The canonical payload root IS a mirror of scripts/ and veto-hooks/ — it is
  // the copy a `cp -r` install ships from, so a stale file there is the most
  // damaging drift of all. Origin 2026-10-25: it was filtered out ("not a
  // mirror"), which is why `skills/meta/setup-tna/veto-hooks/pi/tna-veto.ts`
  // sat 4 KB behind the adapter it was supposed to ship while every other pin
  // stayed green.
  return walk(cwd);
};

// Mirror discovery (router + script mirrors) walks the REPO the script belongs
// to, not the caller's cwd — a --write run inside a sandbox fixture tree must
// stay hermetic and never touch repo files as a side effect.
const MIRRORS_AVAILABLE = existsSync(join(CANON_SKILL, 'SKILL.md')) && existsSync(join(ROOT, 'AGENTS.md'));

/**
 * Router mirrors: every AGENTS.md / WORKFLOW.md outside the repo root IS a
 * mirror of the root file — by constitution, not by list. The router is one
 * document, distributed; a new reference/ or plugin/ copy is covered the
 * moment it exists.
 */
const discoverRouterMirrors = () => {
  const out = [];
  const walkAll = (dir) => {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { walkAll(p); continue; }
      if (name === 'AGENTS.md' || name === 'WORKFLOW.md') {
        const canonical = join(ROOT, name);
        if (p !== canonical) out.push({ mirror: p, canonical });
      }
    }
  };
  walkAll(ROOT);
  return out;
};

/** Same-name .mjs mirrors: { mirrorPath, canonicalPath } for plugin/scripts and the vendored opencode core. */
const discoverScriptMirrors = () => {
  const out = [];
  for (const dir of [join(ROOT, 'plugin', 'scripts'), join(ROOT, '.opencode', 'plugins', 'tna-gate')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.mjs')) continue;
      const canonical = join(ROOT, 'scripts', f);
      if (existsSync(canonical)) out.push({ mirror: join(dir, f), canonical });
    }
  }
  return out;
};

/**
 * Same-name adapter mirrors OUTSIDE a setup-tna payload: `plugin/<harness>/veto-hooks/`
 * copies. They are not referenced by any manifest (Copilot has no hook surface),
 * which is exactly why they rotted: measured 2026-10-25, both sat at the
 * pre-0.1.39 2319-byte shape while nine other copies were current, and the
 * zero-drift check never looked. A tracked copy of a security adapter must be
 * the current adapter or not exist — a stale one is a trap for the next reader.
 */
const discoverAdapterMirrors = () => {
  const out = [];
  const roots = [join(ROOT, 'plugin')];
  const walkAdapters = (dir) => {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { walkAdapters(p); continue; }
      if (!/^tna-veto\.(ts|mjs)$/.test(name)) continue;
      // Only the plugin/<harness>/veto-hooks/<harness>/ shape: the setup-tna
      // payloads are covered by PAYLOAD_MAP above.
      const norm = p.replace(/\\/g, '/');
      if (norm.includes('/skills/setup-tna/')) continue;
      const harness = norm.includes('/omp/') ? 'omp' : norm.includes('/pi/') ? 'pi' : null;
      if (!harness) continue;
      const canonical = join(ROOT, 'veto-hooks', harness, name);
      if (existsSync(canonical)) out.push({ mirror: p, canonical });
    }
  };
  for (const r of roots) walkAdapters(r);
  return out;
};

const same = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));

const args = process.argv.slice(2);
const write = args.includes('--write');
const list = args.includes('--list');

const roots = discoverRoots();
if (list) {
  for (const r of roots) console.log(`payload root: ${relative(process.cwd(), r) || r}`);
  if (MIRRORS_AVAILABLE) {
    for (const m of discoverRouterMirrors()) console.log(`router mirror: ${relative(process.cwd(), m.mirror)}`);
    for (const m of discoverScriptMirrors()) console.log(`script mirror: ${relative(process.cwd(), m.mirror)}`);
  }
  process.exit(0);
}

let drift = 0;
const repairs = [];
for (const root of roots) {
  for (const [rel, canonical] of PAYLOAD_MAP) {
    const mirror = join(root, ...rel.split('/'));
    if (!existsSync(canonical)) { console.error(`SYNC-BROKEN: canonical missing: ${canonical}`); drift++; continue; }
    if (same(mirror, canonical)) continue;
    drift++;
    if (write) {
      mkdirSync(dirname(mirror), { recursive: true });
      copyFileSync(canonical, mirror);
      repairs.push(`${relative(process.cwd(), mirror) || mirror}`);
    } else {
      console.error(`DRIFT: ${relative(process.cwd(), mirror) || mirror} (canonical: ${relative(process.cwd(), canonical)})`);
    }
  }
}
if (MIRRORS_AVAILABLE) {
  for (const { mirror, canonical } of [...discoverRouterMirrors(), ...discoverScriptMirrors(), ...discoverAdapterMirrors()]) {
    if (same(mirror, canonical)) continue;
    drift++;
    if (write) { copyFileSync(canonical, mirror); repairs.push(relative(process.cwd(), mirror) || mirror); }
    else console.error(`DRIFT: ${relative(process.cwd(), mirror) || mirror} (canonical: ${relative(process.cwd(), canonical)})`);
  }
}

if (write) {
  if (drift === 0) console.log('sync: zero drift found; nothing to write.');
  else console.log(`sync: repaired ${repairs.length} file(s):\n  ${repairs.join('\n  ')}`);
  process.exit(drift === 0 || repairs.length === drift ? 0 : 1);
}
if (drift > 0) console.error(`sync: ${drift} drifted/missing file(s) — run: node scripts/sync-payloads.mjs --write`);
process.exit(drift === 0 ? 0 : 1);
