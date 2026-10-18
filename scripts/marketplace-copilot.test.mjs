#!/usr/bin/env node
/**
 * Fail-first guard for the Cursor MARKETPLACE listing and the GitHub Copilot
 * plugin payload. RED first (2026-10-18): neither existed.
 *
 * Cursor marketplace: a plugin is marketplace-listable when the repo ships a
 * marketplace manifest (the .cursor-plugin/plugin.json is the PLUGIN manifest;
 * the marketplace needs a listing entry, mirroring how .claude-plugin/
 * marketplace.json lists the Claude plugin).
 *
 * GitHub Copilot: the repo ships a copilot/ payload with the repo-level
 * AGENTS.md (Copilot coding agent reads it natively) plus the 12 skills via
 * the Agent Skills standard (.agents/skills), and a marketplace listing
 * (mirrors the claude/codex pattern).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PLUGIN = join(ROOT, 'plugin');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Cursor marketplace listing ----
{
  const mp = join(ROOT, '.cursor-plugin', 'marketplace.json');
  check('A1 .cursor-plugin/marketplace.json exists', existsSync(mp));
  if (existsSync(mp)) {
    let m = null;
    try { m = JSON.parse(readFileSync(mp, 'utf8')); } catch (e) { check('A2 parses as JSON', false, e.message); }
    if (m) {
      check('A2 parses as JSON', true);
      const entry = (m.plugins ?? []).find((p) => p.name === 'trust-no-agent');
      check('A3 lists trust-no-agent', !!entry);
      check('A4 the listing points at the plugin payload', entry && String(entry.source ?? '').startsWith('./'), JSON.stringify(entry?.source ?? null));
      check('A5 the listed source exists on disk', entry && existsSync(join(ROOT, entry.source)));
    }
  }
}

// ---- B. GitHub Copilot plugin payload ----
{
  const cp = join(PLUGIN, 'copilot');
  const manifest = join(cp, 'plugin.json');
  check('B1 plugin/copilot/ payload exists', existsSync(cp));
  check('B2 copilot/plugin.json exists', existsSync(manifest));
  if (existsSync(manifest)) {
    let m = null;
    try { m = JSON.parse(readFileSync(manifest, 'utf8')); } catch (e) { check('B3 manifest parses', false, e.message); }
    if (m) {
      check('B3 manifest parses', true);
      check('B4 declares the trust-no-agent name', m.name === 'trust-no-agent');
      check('B5 declares a version matching the release', typeof m.version === 'string' && /^\d+\.\d+\.\d+$/.test(m.version));
    }
    check('B6 payload carries AGENTS.md (Copilot reads it natively)', existsSync(join(cp, 'AGENTS.md')));
    const skillsDir = join(cp, '.agents', 'skills');
    check('B7 payload ships skills (Agent Skills standard path)', existsSync(skillsDir));
    if (existsSync(skillsDir)) {
      const files = readdirSync(skillsDir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
      check('B7a the skills payload is non-trivial', files.length >= 20, `${files.length} files`);
      const receiptsOk = existsSync(join(skillsDir, 'receipts', 'SKILL.md'));
      check('B7b receipts skill present in the copilot payload', receiptsOk);
    }
    check('B8 payload carries veto-hooks (the adapters, byte-synced)', existsSync(join(cp, 'veto-hooks', 'omp', 'tna-veto.ts')));
  }
  const mp = join(ROOT, '.agents', 'plugins', 'copilot-marketplace.json');
  check('B9 copilot marketplace manifest exists', existsSync(mp));
  if (existsSync(mp)) {
    let m = null;
    try { m = JSON.parse(readFileSync(mp, 'utf8')); } catch (e) { check('B10 copilot marketplace parses', false, e.message); }
    if (m) {
      const entry = (m.plugins ?? []).find((p) => p.name === 'trust-no-agent');
      check('B10 copilot marketplace lists trust-no-agent', !!entry);
    }
  }
  // ---- B11+. The official Copilot CLI marketplace manifest (.github/plugin/) ----
  // `copilot plugin marketplace add nadiwerk/trust-no-agent` looks for
  // marketplace.json in .github/plugin/ first (docs: cli-plugin-reference).
  const ghMp = join(ROOT, '.github', 'plugin', 'marketplace.json');
  check('B11 .github/plugin/marketplace.json exists (the marketplace add target)', existsSync(ghMp));
  if (existsSync(ghMp)) {
    let g = null;
    try { g = JSON.parse(readFileSync(ghMp, 'utf8')); } catch (e) { check('B12 the GitHub marketplace manifest parses', false, e.message); }
    if (g) {
      check('B12 the GitHub marketplace manifest parses', true);
      check('B13 marketplace name is trust-no-agent', g.name === 'trust-no-agent');
      const entry = (g.plugins ?? []).find((p) => p.name === 'trust-no-agent');
      check('B14 lists the trust-no-agent plugin', !!entry);
      check('B15 the plugin source resolves on disk', entry && existsSync(join(ROOT, entry.source)), JSON.stringify(entry?.source ?? null));
      const listed = entry?.version;
      const pluginManifest = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {};
      check('B16 the listed version matches the payload manifest version',
        listed === pluginManifest.version, `listed=${listed} payload=${pluginManifest.version}`);
    }
  }
}

// ---- C. The Cursor plugin manifest carries a version matching the release ----
{
  const m = JSON.parse(readFileSync(join(PLUGIN, '.cursor-plugin', 'plugin.json'), 'utf8'));
  check('C1 the Cursor plugin manifest declares a version', typeof m.version === 'string', m.version ?? 'missing');
}

console.log(failures === 0 ? '\nAll marketplace/copilot expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
