#!/usr/bin/env node
/**
 * Fail-first test for the Codex plugin payload (`.agents/plugins/marketplace.json`
 * + `plugin/plugin.json`). Same job as plugin.test.mjs, for the second
 * marketplace: guard the payload so it cannot drift from the canonical tree, and
 * so the shape Codex's CLI actually accepts cannot silently regress.
 *
 * Ground truth for the shaps below came from a real installed marketplace on
 * this machine (2026-09-30), not from prose:
 *   `~/.cache/codex-runtimes/<runtime-id>/.agents/plugins/marketplace.json`
 *   `~/.codex/plugins/cache/<marketplace-id>/.agents/plugins/marketplace.json`
 *   `~/.codex/plugins/cache/<marketplace-id>/<plugin>/<version>/.codex-plugin/plugin.json`
 *   its hooks/*.json (which use `${PLUGIN_ROOT}` and emit
 *   `hookSpecificOutput.additionalContext`, the same contract gate-hook.mjs
 *   already emits).
 *
 * Run: node scripts/codex-plugin.test.mjs   (exit 0 = all expectations hold)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const MARKETPLACE = join(ROOT, '.agents', 'plugins', 'marketplace.json');
const MANIFEST = join(ROOT, 'plugin', 'plugin.json');
const HOOKS = join(ROOT, 'plugin', 'hooks', 'codex.hooks.json');

// ---- A. The two files Codex reads exist at the paths it looks in ----
{
  check('A1 .agents/plugins/marketplace.json exists (Codex repo marketplace path)', existsSync(MARKETPLACE));
  check('A2 plugin/plugin.json exists (portable manifest at the plugin root)', existsSync(MANIFEST));
  check('A3 plugin/hooks/codex.hooks.json exists (Codex uses ${PLUGIN_ROOT})', existsSync(HOOKS));
}

// ---- B. The marketplace is the shape Codex accepts ----
{
  const m = existsSync(MARKETPLACE) ? JSON.parse(readFileSync(MARKETPLACE, 'utf8')) : {};
  check('B1 the marketplace declares a name', typeof m.name === 'string' && m.name.length > 0);
  check('B2 it lists at least one plugin', Array.isArray(m.plugins) && m.plugins.length > 0);
  const entry = (m.plugins ?? [])[0] ?? {};
  check('B3 the first entry names the plugin', entry.name === 'trust-no-agent', JSON.stringify(entry.name));
  check('B4 its source is a relative local path starting with ./',
    entry.source?.source === 'local' && String(entry.source?.path ?? '').startsWith('./'),
    JSON.stringify(entry.source));
  check('B5 it declares the install policy Codex expects',
    typeof entry.policy?.installation === 'string' && typeof entry.policy?.authentication === 'string',
    JSON.stringify(entry.policy));
  check('B6 it declares a category', typeof entry.category === 'string' && entry.category.length > 0);
  check('B7 the declared source path really holds the portable manifest',
    existsSync(join(ROOT, String(entry.source?.path ?? '').replace('./', ''), 'plugin.json')),
    String(entry.source?.path));
}

// ---- C. The portable manifest carries what Codex requires ----
{
  const m = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  check('C1 it uses the Agent Plugins schema', /agent-plugins\.org\/schemas/.test(m.$schema ?? ''), m.$schema);
  check('C2 it declares name/version/description',
    m.name === 'trust-no-agent' && typeof m.version === 'string' && typeof m.description === 'string',
    JSON.stringify({ n: m.name, v: m.version }));
  check('C3 version matches the Claude Code marketplace writer',
    m.version === JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[0].version,
    `${m.version} vs ${JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[0].version}`);
  check('C4 it declares skills (Codex needs the field when skills are packaged)',
    m.skills === './skills/', JSON.stringify(m.skills));
  check('C6 it carries author identity', typeof m.author?.name === 'string' && m.author.name.length > 0);
}

// ---- F. The Codex-native manifest carries hooks in the shape Codex LOADS ----
// Origin: 2026-10-24 live finding. The portable manifest declared
// `"hooks": "./hooks/codex.hooks.json"` (a string). Codex's Agent Plugins loader
// does not know that field in this schema and DISCARDS it with a warning that
// never reaches a normal session:
//   WARN agent_plugin_manifest: ignoring unknown Agent Plugins manifest field
//        path=.../plugin.json field="hooks"   (and field="skills")
// So every TNA hook was unregistered, the TUI /hooks list showed none of them,
// and the veto was dead while the manifest, the trust config, and the docs all
// looked correct. The previous C5 pinned exactly that dead shape — a test
// certifying the bug. Ground truth for the working shape is a Codex-native
// plugin on this machine (omo 4.19.4, whose hooks do run): its own
// `<plugin>/.codex-plugin/plugin.json` with `"hooks": [ "./hooks/x.json", ... ]`
// — an ARRAY of hook-file paths, one file per hook entry.
{
  const CODEX_MANIFEST = join(ROOT, 'plugin', '.codex-plugin', 'plugin.json');
  check('F1 plugin/.codex-plugin/plugin.json exists (the manifest path Codex loads)',
    existsSync(CODEX_MANIFEST));
  if (existsSync(CODEX_MANIFEST)) {
    let cm = {};
    try { cm = JSON.parse(readFileSync(CODEX_MANIFEST, 'utf8')); } catch { /* reported below */ }
    check('F2 it names the plugin and carries a version',
      cm.name === 'trust-no-agent' && typeof cm.version === 'string', JSON.stringify({ n: cm.name, v: cm.version }));
    check('F3 version matches the portable manifest (one release, two manifests)',
      cm.version === JSON.parse(readFileSync(MANIFEST, 'utf8')).version,
      `${cm.version} vs ${JSON.parse(readFileSync(MANIFEST, 'utf8')).version}`);
    check('F4 hooks is an ARRAY of paths — the shape Codex loads (a string is silently dropped)',
      Array.isArray(cm.hooks) && cm.hooks.length > 0,
      `typeof=${Array.isArray(cm.hooks) ? 'array' : typeof cm.hooks} value=${JSON.stringify(cm.hooks)}`);
    const hookPaths = Array.isArray(cm.hooks) ? cm.hooks : [];
    const resolved = hookPaths.map((p) => join(ROOT, 'plugin', String(p).replace(/^\.\//, '')));
    check('F5 every declared hook file exists',
      hookPaths.length > 0 && resolved.every((p) => existsSync(p)),
      JSON.stringify(hookPaths.filter((p, i) => !existsSync(resolved[i]))));
    // Each declared file must itself be a hook document Codex can read, and the
    // four events the framework depends on must be wired somewhere in the set.
    const events = new Set();
    let allParse = hookPaths.length > 0;
    const commands = [];
    for (const p of resolved) {
      if (!existsSync(p)) { allParse = false; continue; }
      let doc = {};
      try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { allParse = false; continue; }
      if (!doc || typeof doc.hooks !== 'object' || doc.hooks === null) { allParse = false; continue; }
      for (const [ev, entries] of Object.entries(doc.hooks)) {
        events.add(ev);
        for (const e of Array.isArray(entries) ? entries : [])
          for (const h of e.hooks ?? []) commands.push(String(h.command ?? ''));
      }
    }
    check('F6 every declared hook file is a { hooks: { Event: [...] } } document', allParse, JSON.stringify([...events]));
    check('F7 the set wires SessionStart, PostCompact, UserPromptSubmit and PreToolUse',
      ['SessionStart', 'PostCompact', 'UserPromptSubmit', 'PreToolUse'].every((e) => events.has(e)),
      JSON.stringify([...events]));
    check('F8 every hook command resolves through ${PLUGIN_ROOT}',
      commands.length >= 4 && commands.every((c) => c.includes('${PLUGIN_ROOT}')), JSON.stringify(commands));
    check('F9 no hook command escapes the plugin root',
      commands.every((c) => !/[A-Za-z]:\\|\/Users\/|\.\.\//.test(c)), JSON.stringify(commands));
    check('F10 it declares the skills directory Codex reads',
      typeof cm.skills === 'string' && cm.skills.length > 0, JSON.stringify(cm.skills));
  }
  // F11 is the load-bearing one, measured on codex 0.163.0 (2026-10-24). Codex
  // resolves the ROOT plugin.json first when it is a valid Agent Plugins
  // manifest, and an unknown field there is discarded rather than falling
  // through — so a `hooks` key on the root manifest SHADOWS the Codex-native
  // one and no hook loads at all. Matrix, each run a real codex exec, counting
  // TNA's SessionStart hook (omo contributes 5; 6 means TNA loaded):
  //   root($schema + hooks string) + .codex-plugin   -> 5  (shadowed)
  //   root($schema, no hooks)      + .codex-plugin   -> 6  (loaded)
  //   root(no $schema, hooks array), no .codex-plugin -> 5  (ignored)
  //   root($schema + hooks string) alone             -> 5  (discarded field)
  // The fix is therefore two-part: the Codex-native manifest carries the
  // hooks, and the portable manifest must NOT carry the key.
  {
    const portable = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
    check('F11 the portable manifest declares NO `hooks` key (it shadows the Codex-native one)',
      !('hooks' in portable),
      `hooks=${JSON.stringify(portable.hooks)} — Codex reads the root manifest first and discards the unknown field, so .codex-plugin/plugin.json never loads`);
  }
}

// ---- D. The Codex hook variant uses the variable Codex substitutes ----
{
  const raw = existsSync(HOOKS) ? readFileSync(HOOKS, 'utf8') : '';
  check('D1 the Codex hooks file uses ${PLUGIN_ROOT}', raw.includes('${PLUGIN_ROOT}'), raw.slice(0, 120));
  check('D2 it does NOT use the Claude-only variable', !raw.includes('${CLAUDE_PLUGIN_ROOT}'), raw.slice(0, 160));
  const j = raw ? JSON.parse(raw) : {};
  check('D3 it wires SessionStart and UserPromptSubmit',
    Boolean(j.hooks?.SessionStart) && Boolean(j.hooks?.UserPromptSubmit),
    JSON.stringify(Object.keys(j.hooks ?? {})));
  // Walk to the actual command strings: the earlier version matched the
  // serialized JSON, so escaped quotes around ${PLUGIN_ROOT} made a correct
  // file fail. Assert on the VALUES, not on the text of their container.
  const commands = Object.values(j.hooks ?? {})
    .flat()
    .flatMap((ev) => ev.hooks ?? [])
    .map((h) => String(h.command ?? ''));
  check('D4 every command resolves through ${PLUGIN_ROOT}',
    commands.length >= 2 && commands.every((c) => c.includes('${PLUGIN_ROOT}')),
    JSON.stringify(commands));
  check('D5 no command escapes the plugin root (absolute drive or home path)',
    commands.every((c) => !/[A-Za-z]:\\|\/Users\/|\.\.\//.test(c)),
    JSON.stringify(commands));
}

// ---- E. The skills it ships are the canonical ones (no second copy to drift) ----
{
  const canonDir = join(ROOT, 'skills');
  const canon = [];
  for (const cat of readdirSync(canonDir)) {
    const dir = join(canonDir, cat);
    try { for (const n of readdirSync(dir)) if (existsSync(join(dir, n, 'SKILL.md'))) canon.push(n); } catch { /* file, skip */ }
  }
  const shipped = readdirSync(join(ROOT, 'plugin', 'skills')).filter((n) =>
    existsSync(join(ROOT, 'plugin', 'skills', n, 'SKILL.md')));
  check('E1 the payload ships every canonical skill, flat', canon.length === 12 && shipped.length === canon.length,
    `canon=${canon.length} shipped=${shipped.length}`);
  const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const mismatched = canon.filter(
    (n) => norm(join(ROOT, 'plugin', 'skills', n, 'SKILL.md')) !== norm(join(canonDir, catOf(canonDir, n), n, 'SKILL.md')),
  );
  check('E2 the payload is the SAME copy the Claude marketplace ships (one source, two manifests)',
    mismatched.length === 0,
    'differing: ' + JSON.stringify(mismatched));
}

/** Map a skill name to its category directory (repo layout: skills/<cat>/<name>). */
function catOf(canonDir, name) {
  for (const cat of readdirSync(canonDir)) {
    if (existsSync(join(canonDir, cat, name, 'SKILL.md'))) return cat;
  }
  return '';
}

console.log(failures ? `\nFAIL: ${failures} expectation(s) broke.` : '\nAll codex-plugin expectations hold.');
process.exit(failures ? 1 : 0);
