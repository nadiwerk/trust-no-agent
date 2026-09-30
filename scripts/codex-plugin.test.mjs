#!/usr/bin/env node
/**
 * Fail-first test for the Codex plugin payload (`.agents/plugins/marketplace.json`
 * + `plugin/plugin.json`). Same job as plugin.test.mjs, for the second
 * marketplace: guard the payload so it cannot drift from the canonical tree, and
 * so the shape Codex's CLI actually accepts cannot silently regress.
 *
 * Ground truth for the shaps below came from a real installed marketplace on
 * this machine (2026-09-30), not from prose:
 *   `~/.cache/codex-runtimes/.../openai-primary-runtime/.agents/plugins/marketplace.json`
 *   `~/.codex/plugins/cache/sisyphuslabs/.agents/plugins/marketplace.json`
 *   `~/.codex/plugins/cache/sisyphuslabs/omo/4.19.4/.codex-plugin/plugin.json`
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
  check('C5 it points hooks at the Codex variant, not the Claude one',
    typeof m.hooks === 'string' && /codex\.hooks\.json$/.test(m.hooks) && m.hooks.startsWith('./'),
    JSON.stringify(m.hooks));
  check('C6 it carries author identity', typeof m.author?.name === 'string' && m.author.name.length > 0);
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
  check('E1 the payload ships every canonical skill, flat', canon.length === 11 && shipped.length === canon.length,
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
