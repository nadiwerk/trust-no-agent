#!/usr/bin/env node
/**
 * Fail-first test for scripts/onboarding.mjs — the onboarding planner and
 * stamp seams (onboarding tickets 01/02; spec AC1/AC4/AC5/AC8/AC18).
 * Zero dependencies. Run: node scripts/onboarding.test.mjs
 * Exit 0 = all expectations hold. Exit 1 = onboarding seam drift.
 *
 * Seams: scanSkillDirs (explicit roots -> discovered skills),
 * suggestTriggers (skill text -> keyword candidates), planOnboarding
 * (discovered + canonical + existing -> proposals/skipped/noted),
 * serializeStamp/parseStamp (the consent record). Fixtures are temp
 * directories and hand-written literals (independent source of truth).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanSkillDirs, suggestTriggers, planOnboarding, serializeStamp, parseStamp, readRouterVersion, registrationStatus, planDevinConfig } from './onboarding.mjs';
import { parseOverlayFrontmatter } from './overlay-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};
const fixtureSkill = (dir, name = 'team-playbook', text = '# Skill: team-playbook\nhow we ship together') => {
  const d = join(dir, '.claude', 'skills', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), text);
  return d;
};
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const put = (root, name, text) => {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), text);
  return d;
};

// ---- A. Discovery over explicit roots (spec AC4) ----
{
  const proj = tmp('onboard-proj-');
  const home = tmp('onboard-home-');
  put(proj, 'team-playbook', '# Skill: team-playbook\nhow we ship');
  put(home, 'error-forensics', '# Skill: error-forensics\nread the stack');
  const found = scanSkillDirs([proj, home]);
  check('A1 discovery finds skills across project and personal roots, named',
    found.length === 2 && found.some((s) => s.name === 'team-playbook') && found.some((s) => s.name === 'error-forensics'),
    JSON.stringify(found.map((s) => s.name)));
  mkdirSync(join(proj, 'no-skill-file'), { recursive: true });
  const found2 = scanSkillDirs([proj]);
  check('A2 a directory without SKILL.md is not discovered',
    found2.length === 1 && found2[0].name === 'team-playbook', JSON.stringify(found2.map((s) => s.name)));
  rmSync(proj, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

// ---- B. Trigger suggestions from the skill's own content (spec AC5) ----
{
  const trig = suggestTriggers('# Skill: decision-patterns\n\nTyped decision primitives.');
  check('B1 a title yields at least one keyword candidate',
    Array.isArray(trig) && trig.length >= 1 && trig.every((t) => /^[a-z0-9][a-z0-9 _-]*$/.test(t)),
    JSON.stringify(trig));
  const renamed = planOnboarding({ discovered: [{ name: 'My Skill', text: '# Skill: my skill' }], canonicalNames: new Set() });
  check('B2 a non-identifier directory name is normalized for the overlay registry',
    renamed.proposals[0].name === 'my-skill', JSON.stringify(renamed.proposals[0]));
}

// ---- C. The plan: proposals, skips, notes (spec AC5/AC8) ----
{
  const canonical = new Set(['root-cause', 'receipts']);
  const plan = planOnboarding({
    discovered: [
      { name: 'error-forensics', text: '# Skill: error-forensics\nstack traces' },
      { name: 'root-cause', text: '# Skill: root-cause\ncanonical' },
      { name: 'already-there', text: '# Skill: already-there\nregistered' },
    ],
    canonicalNames: canonical,
    existingOverlays: new Set(['already-there']),
  });
  check('C1 a canonical-name skill is skipped with a note, never proposed',
    plan.skipped.some((s) => s.name === 'root-cause') && !plan.proposals.some((p) => p.name === 'root-cause'),
    JSON.stringify(plan));
  check('C2 an already-registered skill is noted, not re-proposed',
    plan.noted.some((s) => s.name === 'already-there') && !plan.proposals.some((p) => p.name === 'already-there'),
    JSON.stringify(plan));
  check('C3 a fresh skill becomes a proposal with triggers',
    plan.proposals.length === 1 && plan.proposals[0].name === 'error-forensics' && plan.proposals[0].triggers.length >= 1,
    JSON.stringify(plan.proposals));
  // Round-trip: the proposed frontmatter parses clean through the registry seam.
  const fm = parseOverlayFrontmatter([
    '---',
    `name: ${plan.proposals[0].name}`,
    'extends: root-cause/Phase-1',
    'role: insert-after',
    `triggers: ${plan.proposals[0].triggers.join(', ')}`,
    '---',
    'body',
  ].join('\n'));
  check('C4 the proposed overlay frontmatter parses clean through the registry seam',
    fm.errors.length === 0, JSON.stringify(fm.errors));
}

// ---- D. The consent stamp (spec AC1/AC18) ----
{
  const stamp = serializeStamp({
    components: { floor: true, hooks: true, overlays: true, evidenceGate: false },
    harness: 'claude',
    routerVersion: '0.1.28',
    did: { overlays: ['error-forensics'], hooksPathSet: true },
  });
  const back = parseStamp(stamp);
  check('D1 a stamp round-trips with every component recorded',
    back && back.components.floor === true && back.components.evidenceGate === false
    && back.components.hooks === true && back.components.overlays === true
    && back.consentedAt && back.routerVersion === '0.1.28'
    && back.did.overlays[0] === 'error-forensics', JSON.stringify(back));
  check('D2 a malformed stamp parses as null (no consent, never partial)',
    parseStamp('not json') === null && parseStamp('{"components":{}}') === null
    && parseStamp('') === null, JSON.stringify([parseStamp('not json'), parseStamp('{"components":{}}')]));
  try {
    execFileSync('git', ['check-ignore', '.trust/onboarding.json'], { cwd: join(HERE, '..'), encoding: 'utf8' });
    check('D3 the stamp path is gitignored (git check-ignore confirms)', true);
  } catch {
    check('D3 the stamp path is gitignored (git check-ignore confirms)', false, 'not ignored');
  }
}

// ---- E. The CLI consent flow (spec AC1/AC2/AC6/AC11/AC16/AC17/AC19) ----
// Live derivation with spawned children against temp cwds: the briefing,
// the per-component consent (piped answers), the stamp, the receipt, and
// the human-only guard. Piped stdin drives the interactive path; --yes
// drives the scripted path; empty input aborts (fail-closed: nothing
// lands).
{
  const { spawnSync } = await import('node:child_process');
  const ONBOARD = join(HERE, 'onboarding.mjs');
  const runCli = (input, extraArgs = []) => {
    const dir = tmp('onboard-cli-');
    const r = spawnSync(process.execPath, [ONBOARD, ...extraArgs], { cwd: dir, input, encoding: 'utf8', timeout: 30000 });
    const stamp = join(dir, '.trust', 'onboarding.json');
    const stampText = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
    rmSync(dir, { recursive: true, force: true });
    return { code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? ''), stampText };
  };

  const yes = runCli('', ['--yes']);
  check('E1 a --yes run writes a valid stamp with all components consented',
    yes.code === 0 && parseStamp(yes.stampText) && parseStamp(yes.stampText).components.floor === true
    && parseStamp(yes.stampText).components.evidenceGate === true && parseStamp(yes.stampText).consentedAt,
    `code=${yes.code} stamp=${(yes.stampText || '').slice(0, 120)}`);
  check('E2 the output carries the what-changes briefing before consent',
    /floor/i.test(yes.out) && /veto/i.test(yes.out) && /receipt/i.test(yes.out) && /expect-fail/i.test(yes.out)
    && /root-cause/i.test(yes.out), yes.out.slice(0, 300));
  check('E3 the output carries the four receipt blocks, named',
    /Consented/i.test(yes.out) && /Mapped/i.test(yes.out) && /Pending/i.test(yes.out) && /Next/i.test(yes.out),
    yes.out.slice(-300));

  const picked = runCli('n\ny\nn\ny\n');
  check('E4 piped answers record exactly the chosen components in the stamp',
    picked.code === 0 && parseStamp(picked.stampText)
    && parseStamp(picked.stampText).components.floor === false
    && parseStamp(picked.stampText).components.hooks === true
    && parseStamp(picked.stampText).components.overlays === false
    && parseStamp(picked.stampText).components.evidenceGate === true,
    `code=${picked.code} stamp=${(picked.stampText || '').slice(0, 200)}`);

  const aborted = runCli('');
  check('E5 aborted input (EOF) writes no stamp (fail-closed)',
    aborted.code !== 0 && aborted.stampText === null, `code=${aborted.code} stamp=${aborted.stampText}`);

  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./scripts/onboarding.mjs').then(() => process.stdout.write('IMPORTED-OK'))"], { cwd: join(HERE, '..'), encoding: 'utf8', timeout: 30000 });
  check('E6 importing the module does not run the flow (human-CLI-only)',
    /IMPORTED-OK/.test(String(imported.stdout ?? '')) && !/briefing|consent/i.test(String(imported.stdout ?? '')),
    String(imported.stdout ?? '').slice(0, 120));

  // The external-product discipline extends to shipped text: the CLI's
  // own output strings name no external products (the names live here,
  // in the enforcer).
  const src = readFileSync(ONBOARD, 'utf8');
  check('E7 the onboarding module names no external product in its strings',
    !/typesafe/i.test(src) && !/\bjev\b/i.test(src), 'external product name found in onboarding.mjs');

  // ---- E8. Bare --refresh on a stamped tree routes to the install path ----
  // Origin 2026-11-02 (measured): the "refresh on a stamped tree" branch lived
  // ONLY inside the --from-chat handler, so a bare `--refresh` — the exact
  // command the doctor's stale-skills warning tells adopters to run — fell
  // through to the interactive consent flow and aborted fail-closed on EOF.
  // The repair the doctor names was a dead end. Same-dir runner: seed with
  // --yes, then refresh the SAME tree, so the assertions read the refresh's
  // own receipt and stamp.
  {
    const dir = tmp('onboard-refresh-');
    const run = (extraArgs = []) => {
      const r = spawnSync(process.execPath, [ONBOARD, ...extraArgs], { cwd: dir, input: '', encoding: 'utf8', timeout: 60000 });
      return { code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') };
    };
    const stampPath = join(dir, '.trust', 'onboarding.json');
    const markerPath = join(dir, '.trust', 'tna-version');

    const seed = run(['--yes']);
    check('E8-pre the seed install writes a stamp to refresh against',
      seed.code === 0 && existsSync(stampPath), `code=${seed.code}`);

    // Age the stamp deliberately: the refresh must LIFT the version, not
    // inherit it — a refresh that leaves the stamp at the old version lies
    // about what landed (measured 2026-11-02: the real stamp sat at 0.1.53
    // through three releases).
    const aged = JSON.parse(readFileSync(stampPath, 'utf8'));
    aged.routerVersion = '0.0.9';
    writeFileSync(stampPath, JSON.stringify(aged, null, 1));

    const bare = run(['--refresh']);
    check('E8a a bare --refresh on a stamped tree takes the install path (no consent prompt)',
      bare.code === 0 && /Refreshed:/.test(bare.out) && !/Enable the session floor/.test(bare.out),
      `code=${bare.code} out=${bare.out.slice(-200)}`);

    const refreshedStamp = parseStamp(readFileSync(stampPath, 'utf8'));
    check('E8c a successful refresh stamps the current routerVersion',
      refreshedStamp && refreshedStamp.routerVersion === readRouterVersion(),
      `stamp version=${refreshedStamp?.routerVersion}`);

    // E8d: a refresh writes .trust/tna-version — doctor C6 reads it, and
    // nothing in the CLI ever wrote it (measured: a successful refresh left
    // the marker stale and the doctor warned "stale" forever). Aged to 0.0.9
    // alongside the stamp: the refresh must write the CURRENT version.
    const markerText = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : null;
    check('E8d an install/refresh writes .trust/tna-version matching the router version',
      markerText !== null && /^\d+\.\d+\.\d+$/.test(markerText) && markerText === readRouterVersion(),
      `marker=${markerText}`);

    // E8b: a bare --refresh with NO stamp refuses with a named next step —
    // never a consent prompt, never a silent success.
    const noStamp = tmp('onboard-nostamp-');
    mkdirSync(noStamp, { recursive: true });
    const r2 = spawnSync(process.execPath, [ONBOARD, '--refresh'], { cwd: noStamp, input: '', encoding: 'utf8', timeout: 60000 });
    const both = String(r2.stdout ?? '') + String(r2.stderr ?? '');
    check('E8b a bare --refresh without a stamp refuses with a named next step, never a consent prompt',
      r2.status === 1 && /No consent stamp/.test(both) && !/Enable the session floor/.test(both),
      `code=${r2.status} out=${both.slice(-200)}`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(noStamp, { recursive: true, force: true });
  }
}

// ---- K. Explicit-only overlays: extends/role optional (onboarding 04) ----
// The onboarding spec's decision: anchors are left empty by default
// (explicit-only); attaching to a phase is the adopter's later edit. The
// registry therefore requires only `name`; `extends` and `role` are
// validated WHEN PRESENT, never assumed.
{
  const explicitOnly = parseOverlayFrontmatter(['---', 'name: explicit-only', '---', 'body'].join('\n'));
  check('K1 an overlay with name only parses clean (explicit-only, no anchor)',
    explicitOnly.errors.length === 0 && explicitOnly.entry.extends === '' && explicitOnly.entry.role === '',
    JSON.stringify(explicitOnly));
  const roleNoAnchor = parseOverlayFrontmatter(['---', 'name: role-only', 'role: wrap', '---', 'b'].join('\n'));
  check('K2 role without extends is accepted when legal',
    roleNoAnchor.errors.length === 0, JSON.stringify(roleNoAnchor.errors));
  const badRoleNoAnchor = parseOverlayFrontmatter(['---', 'name: bad', 'role: replace', '---', 'b'].join('\n'));
  check('K3 an illegal role is still rejected without an anchor',
    badRoleNoAnchor.errors.some((e) => /replace/.test(e)), JSON.stringify(badRoleNoAnchor.errors));
}

// ---- F. The mapping phase: discover, confirm, write (spec AC6/AC7/AC9) ----
// Spawned children in temp cwds with fixture skills and a redirected HOME
// (so the real personal skill dirs never leak into the test). The written
// overlays are verified through the registry seam, and the composed floor
// carries them marked user:.
{
  const { spawnSync } = await import('node:child_process');
  const ONBOARD = join(HERE, 'onboarding.mjs');
  const fixture = () => {
    const dir = tmp('onboard-map-');
    const home = tmp('onboard-home-');
    const put = (root, name, text) => {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'SKILL.md'), text);
    };
    put(join(dir, '.claude', 'skills'), 'team-playbook', '# Skill: team-playbook\nhow we ship together');
    put(join(dir, '.claude', 'skills'), 'root-cause', '# Skill: root-cause\ncanonical collision');
    put(join(home, '.claude', 'skills'), 'error-forensics', '# Skill: error-forensics\nread the stack trace');
    return { dir, home };
  };
  const runIn = (dir, home, input, extraArgs = []) => {
    const r = spawnSync(process.execPath, [ONBOARD, ...extraArgs], {
      cwd: dir, input, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: home, HOME: home },
    });
    return { code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? ''), dir };
  };
  const overlaysOf = (dir) => {
    const base = join(dir, '.trust', 'skills-overlay');
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  };

  {
    const { dir, home } = fixture();
    const r = runIn(dir, home, '', ['--yes']);
    check('F1 a --yes run writes the confirmed overlays and skips the canonical collision',
      r.code === 0 && overlaysOf(dir).join(',') === 'error-forensics,team-playbook'
      && /skipped/.test(r.out) && /root-cause/.test(r.out), `code=${r.code} overlays=${overlaysOf(dir).join(',')}`);
    const stampText = existsSync(join(dir, '.trust', 'onboarding.json')) ? readFileSync(join(dir, '.trust', 'onboarding.json'), 'utf8') : null;
    check('F2 the stamp records what was written (the --undo feed)',
      parseStamp(stampText) && parseStamp(stampText).did.overlays.sort().join(',') === 'error-forensics,team-playbook',
      JSON.stringify(parseStamp(stampText)?.did));
    // The written overlay parses clean through the registry seam.
    const fm = parseOverlayFrontmatter(readFileSync(join(dir, '.trust', 'skills-overlay', 'team-playbook', 'SKILL.md'), 'utf8'));
    check('F3 the written overlay frontmatter parses clean through the registry seam',
      fm.errors.length === 0 && fm.entry.name === 'team-playbook' && fm.entry.triggers.length >= 1,
      JSON.stringify(fm));
    // --map-only with one NEW skill since the stamp: exactly that one lands.
    const d2 = join(dir, '.claude', 'skills', 'new-skill');
    mkdirSync(d2, { recursive: true });
    writeFileSync(join(d2, 'SKILL.md'), '# Skill: new-skill\nfreshly installed');
    const m = runIn(dir, home, '', ['--map-only']);
    check('F4 --map-only adds exactly the new skill and never re-asks consent',
      m.code === 0 && overlaysOf(dir).join(',') === 'error-forensics,new-skill,team-playbook'
      && !/Enable /.test(m.out), `code=${m.code} overlays=${overlaysOf(dir).join(',')}`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
  {
    // --map-only without a stamp: named failure, exit non-zero.
    const dir = tmp('onboard-nostamp-');
    const r = runIn(dir, tmp('onboard-home2-'), '', ['--map-only']);
    check('F5 --map-only without a stamp fails with the named next step',
      r.code !== 0 && /run node scripts\/onboarding\.mjs first/i.test(r.out + r.err), `code=${r.code} out=${r.out.slice(0, 120)}`);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- G. --undo reversal (spec AC10) ----
// Before/after tree hashes: the fixture skills must survive the onboard +
// undo cycle byte-identical; the stamp and onboarding-created overlays must
// be gone.
{
  const { spawnSync } = await import('node:child_process');
  const ONBOARD = join(HERE, 'onboarding.mjs');
  const hashTree = (dir) => {
    const out = [];
    const walk = (d, rel) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (e.name !== '.trust') walk(p, r); }
        else out.push(`${r}:${readFileSync(p).length}`);
      }
    };
    walk(dir, '');
    return out.sort().join('|');
  };
  {
    const dir = tmp('onboard-undo-');
    const home = tmp('onboard-undo-home-');
    const d2 = join(dir, '.claude', 'skills', 'team-playbook');
    mkdirSync(d2, { recursive: true });
    writeFileSync(join(d2, 'SKILL.md'), '# Skill: team-playbook\nhow we ship together');
    const before = hashTree(dir);
    const run = (extraArgs) => spawnSync(process.execPath, [ONBOARD, ...extraArgs], {
      cwd: dir, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: home, HOME: home },
    });
    const on = run(['--yes']);
    const stampExists = existsSync(join(dir, '.trust', 'onboarding.json'));
    const off = run(['--undo']);
    const after = hashTree(dir);
    check('G1 --undo removes the stamp and the onboarding-created overlays, leaving pre-existing files untouched',
      on.status === 0 && stampExists && off.status === 0
      && !existsSync(join(dir, '.trust', 'onboarding.json'))
      && !existsSync(join(dir, '.trust', 'skills-overlay'))
      && before === after, `on=${on.status} off=${off.status} before==after: ${before === after}`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
  {
    const dir = tmp('onboard-undo-');
    const home = tmp('onboard-undo-home-');
    // G3 — tampered stamp: an overlay name that escapes .trust must be skipped,
    // never deleted (security: rmSync with a traversal name deletes arbitrary
    // directories). The canary directory OUTSIDE .trust must survive.
    const stampDir = join(dir, '.trust', 'skills-overlay');
    mkdirSync(join(stampDir, 'real-overlay'), { recursive: true });
    writeFileSync(join(stampDir, 'real-overlay', 'SKILL.md'), '# real overlay');
    const canary = join(dir, 'canary-do-not-delete');
    mkdirSync(canary, { recursive: true });
    writeFileSync(join(canary, 'precious.txt'), 'survive');
    const tampered = {
      components: { floor: true, hooks: true, overlays: true, evidenceGate: true },
      mapSkills: [],
      did: { overlays: ['../../canary-do-not-delete', 'real-overlay'], hooksPathSet: false, tnaVersion: 'test' },
    };
    writeFileSync(join(dir, '.trust', 'onboarding.json'), JSON.stringify(tampered));
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [ONBOARD, '--undo'], {
      cwd: dir, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: home, HOME: home },
    });
    check('G3 --undo with a tampered stamp skips the traversal name and deletes only whitelisted overlays',
      r.status === 0
      && existsSync(canary)
      && existsSync(join(canary, 'precious.txt'))
      && !existsSync(join(stampDir, 'real-overlay'))
      && /suspicious overlay name/i.test(String(r.stdout ?? '')),
      `code=${r.status} canary=${existsSync(canary)} realGone=${!existsSync(join(stampDir, 'real-overlay'))} out=${String(r.stdout ?? '').slice(0, 120)}`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

// ---- H. V1 extras (spec AC14/AC20) ----
// The Codex hook-trust warning (detected via the personal config dir), the
// per-harness briefing (pure seam, both directions), the exit+update
// section, and the rehearsal as the last step.
{
  const { spawnSync } = await import('node:child_process');
  const ONBOARD = join(HERE, 'onboarding.mjs');
  const { harnessBriefing } = await import('./onboarding.mjs');

  const row = harnessBriefing({ harness: 'OMO', compatText: '| Harness |\n|---|\n| **OMO** (oh-my-openagent) | Native, lazy + re-injected |' });
  check('H1 the per-harness briefing extracts the adopter row from the table',
    /OMO/.test(row) && /Native, lazy/.test(row), row.slice(0, 160));
  const degrade = harnessBriefing({ harness: 'OMO', compatText: null });
  check('H2 the per-harness briefing degrades to a named note when the table is absent',
    /not in this install/.test(degrade) && /compatibility\.md/.test(degrade), degrade.slice(0, 160));
  const noRow = harnessBriefing({ harness: 'zzz-harness', compatText: '| Harness |\n|---|\n| **OMO** | x |' });
  check('H3 an unknown harness gets the named no-row note', /no row found/.test(noRow), noRow.slice(0, 160));

  const dir = tmp('onboard-extras-');
  const home = tmp('onboard-extras-home-');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), '# codex config');
  const r = spawnSync(process.execPath, [ONBOARD, '--yes'], {
    cwd: dir, input: '', encoding: 'utf8', timeout: 60000,
    env: { ...process.env, USERPROFILE: home, HOME: home },
  });
  const out = String(r.stdout ?? '');
  check('H4 on a Codex tree the output names the one-time hook-trust step',
    /hook.?trust|trusted_hash|trust them/i.test(out), out.split('\n').filter((l) => /trust/i.test(l)).join(' | ').slice(0, 200));
  check('H5 the exit + update section appears, named',
    /Leaving and updating/.test(out) && /--undo/.test(out) && /tna-version/.test(out), '');
  check('H6 the rehearsal is printed as the last step',
    /First-task rehearsal/.test(out) && /recite/i.test(out)
    && out.indexOf('First-task rehearsal') > out.lastIndexOf('Receipt'), `rehearsal@${out.indexOf('First-task rehearsal')} receipt@${out.lastIndexOf('Receipt')}`);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

// ---- G. The --from-chat flag (spec AC1/AC2/AC3/AC6/AC7/AC13) ----
// Spawned children with the answers JSON piped via the new flag: the CLI
// stays the sole writer; the chat session only forwards the human's
// answers. Fail-closed: an empty or malformed answers JSON writes nothing.
{
  const { spawnSync } = await import('node:child_process');
  const ONBOARD = join(HERE, 'onboarding.mjs');
  const fixtureSkill = (dir, name = 'team-playbook', text = '# Skill: team-playbook\nhow we ship together') => {
    const d = join(dir, '.claude', 'skills', name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SKILL.md'), text);
    return d;
  };
  const answers = JSON.stringify({
    components: { floor: true, hooks: true, overlays: true, evidenceGate: false },
    mapSkills: ['team-playbook'],
  });
  const runChat = (dir, answersJson) => {
    const r = spawnSync(process.execPath, [ONBOARD, '--from-chat', answersJson], {
      cwd: dir, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dir, HOME: dir },
    });
    const stampPath = join(dir, '.trust', 'onboarding.json');
    return {
      code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? ''),
      stamp: existsSync(stampPath) ? parseStamp(readFileSync(stampPath, 'utf8')) : null,
      overlays: (() => { const b = join(dir, '.trust', 'skills-overlay'); return existsSync(b) ? readdirSync(b, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []; })(),
    };
  };

  {
    const dir = tmp('from-chat-');
    fixtureSkill(dir);
    const r = runChat(dir, answers);
    check('G1 --from-chat writes a stamp whose components match the forwarded answers',
      r.code === 0 && r.stamp && r.stamp.components.floor === true && r.stamp.components.evidenceGate === false
      && r.stamp.components.hooks === true && r.stamp.consentedAt,
      `code=${r.code} stamp=${JSON.stringify(r.stamp)?.slice(0, 200)}`);
    check('G2 the confirmed overlay is written and parses clean through the registry seam',
      r.overlays.join(',') === 'team-playbook', JSON.stringify(r.overlays));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = tmp('from-chat-empty-');
    fixtureSkill(dir);
    const empty = runChat(dir, '');
    const malformed = runChat(dir, 'not json');
    check('G3 an empty or malformed answers JSON writes nothing and exits non-zero',
      empty.code !== 0 && empty.stamp === null && empty.overlays.length === 0
      && malformed.code !== 0 && malformed.stamp === null,
      `empty=${empty.code}/${empty.stamp} malformed=${malformed.code}/${malformed.stamp}`);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = tmp('from-chat-stamped-');
    fixtureSkill(dir);
    // Stamp first (all consent), then --from-chat on the stamped tree:
    // mapping-only — the new skill lands, consent is not re-asked.
    const first = runChat(dir, JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] }));
    const d2 = join(dir, '.claude', 'skills', 'new-skill');
    mkdirSync(d2, { recursive: true });
    writeFileSync(join(d2, 'SKILL.md'), '# Skill: new-skill\nfreshly installed');
    const r = runChat(dir, JSON.stringify({ components: { floor: false, hooks: false, overlays: true, evidenceGate: false }, mapSkills: ['new-skill'] }));
    check('G4 --from-chat on a stamped tree routes to mapping-only (new skill lands, no re-consent)',
      first.code === 0 && r.code === 0 && r.overlays.join(',') === 'new-skill' && !/Enable /.test(r.out),
      `code=${r.code} overlays=${r.overlays.join(',')}`);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = tmp('from-chat-declined-');
    fixtureSkill(dir);
    // Overlays declined even though mapping answers still name a skill: the
    // declined component ignores its section's answers.
    const r = runChat(dir, JSON.stringify({ components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: ['team-playbook'] }));
    check('G5 a declined overlays component ignores its section answers (nothing written)',
      r.code === 0 && r.overlays.length === 0, `code=${r.code} overlays=${JSON.stringify(r.overlays)}`);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = tmp('from-chat-consistent-');
    fixtureSkill(dir);
    const allYes = JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] });
    const viaChat = runChat(dir, allYes);
    const dir2 = tmp('from-chat-consistent2-');
    fixtureSkill(dir2);
    const r2 = spawnSync(process.execPath, [ONBOARD, '--yes'], {
      cwd: dir2, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dir2, HOME: dir2 },
    });
    const s1 = parseStamp(readFileSync(join(dir, '.trust', 'onboarding.json'), 'utf8'));
    const s2 = parseStamp(readFileSync(join(dir2, '.trust', 'onboarding.json'), 'utf8'));
    check('G6 --from-chat with all-consent answers produces the same component booleans --yes produces',
      JSON.stringify(s1.components) === JSON.stringify(s2.components),
      `chat=${JSON.stringify(s1.components)} yes=${JSON.stringify(s2.components)}`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
}

// ---- H. Doctor final proof after --from-chat (spec AC9 end-to-end) ----
// The command's last step: the doctor's own output is the receipt's
// evidence. Live spawn: onboard a temp tree via --from-chat, then spawn the
// doctor there — the grandfather/onboarding warnings must be resolved by
// the stamp (no new doctor code; the existing wiring is the mechanism).
{
  const dir = tmp('from-chat-doctor-');
  const mk = (d) => {
    const skillDir = join(d, '.claude', 'skills', 'team-playbook');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Skill: team-playbook\nhow we ship together');
  };
  mk(dir);
  const { spawnSync } = await import('node:child_process');
  const ONBOARD2 = join(HERE, 'onboarding.mjs');
  const DOCTOR = join(HERE, 'doctor.mjs');
  const r = spawnSync(process.execPath, [ONBOARD2, '--from-chat',
    JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: ['team-playbook'] })], {
    cwd: dir, input: '', encoding: 'utf8', timeout: 60000,
    env: { ...process.env, USERPROFILE: dir, HOME: dir },
  });
  const d = spawnSync(process.execPath, [DOCTOR], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, USERPROFILE: dir, HOME: dir },
  });
  const out = String(d.stdout ?? '');
  check('H1 the doctor after --from-chat onboarding no longer warns about the consent stamp',
    r.status === 0 && !/no consent stamp/.test(out), `on=${r.status} doctorOut=${out.split('\n').filter((l) => /consent|stamp/.test(l)).join(' | ').slice(0, 200)}`);
  check('H2 the doctor shows the overlay tier active with the mapped skill',
    /1 overlay\(s\) validated/.test(out), out.split('\n').filter((l) => /overlay/.test(l)).join(' | ').slice(0, 160));
  rmSync(dir, { recursive: true, force: true });
}

// ---- I. hooks consent wires core.hooksPath (setup-tna unification) ----
// Master: /setup-tna alone must complete a first install. The missing loop:
// consent hooks=true did NOT wire core.hooksPath (the receipt said "your
// git config step") — so the doctor still failed on hooks right after a
// smooth onboarding. Consent-real means the component actually turns ON.
{
  const { spawnSync } = await import('node:child_process');
  const ONBOARD2 = join(HERE, 'onboarding.mjs');
  const mkRepo = (p) => {
    const dir = tmp(p);
    fixtureSkill(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
  };
  const hooksPathOf = (dir) => {
    try { return execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' }).trim(); } catch { return ''; }
  };
  const runIn = (dir, answersJson) => spawnSync(process.execPath, [ONBOARD2, '--from-chat', answersJson], {
    cwd: dir, input: '', encoding: 'utf8', timeout: 60000,
    env: { ...process.env, USERPROFILE: dir, HOME: dir },
  });

  {
    const dir = mkRepo('onboard-wire-');
    // gitignored seed (an adopter's fresh clone carries the framework's
    // .gitignore) + hooks tracked copies — /setup-tna alone must finish
    // these or the doctor still fails after onboarding.
    writeFileSync(join(dir, '.gitignore'), '.trust/\n');
    mkdirSync(join(dir, 'scripts', 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'hooks', 'pre-commit'), '#!/usr/bin/env bash\n');
    writeFileSync(join(dir, 'scripts', 'hooks', 'commit-msg'), '#!/usr/bin/env bash\n');
    const r = runIn(dir, JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] }));
    check('I1 hooks consent=true wires core.hooksPath (the component turns ON mechanically)',
      r.status === 0 && hooksPathOf(dir) === 'scripts/hooks', `status=${r.status} hooksPath=${hooksPathOf(dir)}`);
    const stamp = parseStamp(readFileSync(join(dir, '.trust', 'onboarding.json'), 'utf8'));
    check('I2 the stamp records hooksPathSet=true (the --undo feed)',
      stamp && stamp.did.hooksPathSet === true, JSON.stringify(stamp?.did));
    // The unified /setup-tna promise: after onboarding, the doctor's hook
    // and gitignore checks PASS on a properly-cloned adopter repo.
    const doc = spawnSync(process.execPath, [ONBOARD2.replace('onboarding.mjs', 'doctor.mjs')], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    const docOut = String(doc.stdout ?? '');
    check('I3 after /setup-tna the doctor passes the hooks and gitignore checks (one door, zero follow-ups)',
      !/hooksPath not set/.test(docOut) && !/NOT gitignored/.test(docOut), docOut.split('\n').filter((l) => /FAIL|hooks|gitignored/.test(l)).join(' | ').slice(0, 300));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    // J-series (veto-plugin-onboarding spec AC1-AC3): the veto plugin copy.
    // The CLI copies .opencode/plugins/tna-gate/ into the project when hooks
    // are consented AND the harness is OpenCode (project-local .opencode dir
    // is the detection signal), records did.vetoPluginCopied, never clobbers
    // a pre-existing copy, and --undo removes exactly what it created.
    const dir = mkRepo('onboard-veto-');
    writeFileSync(join(dir, '.gitignore'), '.trust/\n');
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    // Seed the SOURCE plugin inside the repo checkout the CLI runs from
    // (the CLI copies from its own checkout's .opencode/plugins/tna-gate).
    const srcPlugin = join(HERE, '..', '.opencode', 'plugins', 'tna-gate');
    const hadSrc = existsSync(srcPlugin);
    if (!hadSrc) { mkdirSync(srcPlugin, { recursive: true }); writeFileSync(join(srcPlugin, 'index.js'), '// fixture plugin'); }
    const r = runIn(dir, JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] }));
    const dest = join(dir, '.opencode', 'plugins', 'tna-gate');
    check('J1 hooks consent on an OpenCode tree copies the veto plugin into the project',
      r.status === 0 && existsSync(join(dest, 'index.js')), `status=${r.status} destExists=${existsSync(dest)}`);
    const stamp = parseStamp(readFileSync(join(dir, '.trust', 'onboarding.json'), 'utf8'));
    check('J2 the stamp records did.vetoPluginCopied=true exactly when the copy happened',
      stamp && stamp.did && stamp.did.vetoPluginCopied === true, JSON.stringify(stamp?.did));
    const undo = spawnSync(process.execPath, [ONBOARD2, '--undo'], {
      cwd: dir, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dir, HOME: dir },
    });
    check('J3 --undo removes the copied veto plugin directory and reports it',
      undo.status === 0 && !existsSync(dest) && /veto plugin/i.test(String(undo.stdout ?? '')),
      `code=${undo.status} destGone=${!existsSync(dest)} out=${String(undo.stdout ?? '').slice(0, 120)}`);
    // AC3: pre-existing copy is never clobbered.
    const dir2 = mkRepo('onboard-veto-pre-');
    writeFileSync(join(dir2, '.gitignore'), '.trust/\n');
    mkdirSync(join(dir2, '.opencode', 'plugins', 'tna-gate'), { recursive: true });
    writeFileSync(join(dir2, '.opencode', 'plugins', 'tna-gate', 'index.js'), '// USER CUSTOMIZATION - must survive');
    const r2 = runIn(dir2, JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] }));
    const stamp2 = parseStamp(readFileSync(join(dir2, '.trust', 'onboarding.json'), 'utf8'));
    check('J4 a pre-existing veto plugin directory is left untouched (no clobber, not recorded as copied)',
      r2.status === 0
      && readFileSync(join(dir2, '.opencode', 'plugins', 'tna-gate', 'index.js'), 'utf8') === '// USER CUSTOMIZATION - must survive'
      && stamp2 && stamp2.did && stamp2.did.vetoPluginCopied === false,
      `status=${r2.status} stamp=${JSON.stringify(stamp2?.did)}`);
    if (!hadSrc) rmSync(srcPlugin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
  {
    // L-series (veto-hooks-omp-pi spec AC5): veto hook copy for omp and pi.
    // omp: home-level ~/.omp/agent/hooks/pre/tna-veto.ts; pi: project .pi/extensions/
    const { spawnSync } = await import('node:child_process');
    const ONB = join(HERE, 'onboarding.mjs');
    // RELEASE-INTEGRITY (origin: omp user bug report 2026-10-17 - the v0.1.35
    // release shipped the copy CODE but not the adapters, which lived under
    // gitignored .trust/ and were never committed; onboarding failed open with
    // "source not found - skipping"). The adapters are RELEASE PAYLOAD: they
    // must be tracked in git AND present as veto-hooks/ siblings of EVERY
    // onboarding.mjs (repo root + all skill payloads), byte-identical. The old
    // test seeded a synthetic fixture when the source was missing - that crutch
    // let the release ship empty. The test now reads the real shipped files.
    const adapters = ['omp', 'pi'];
    const payloadRoots = [
      join(HERE, '..'),
      join(HERE, '..', 'skills', 'meta', 'setup-tna'),
      join(HERE, '..', 'plugin', 'skills', 'setup-tna'),
      join(HERE, '..', 'plugin', '.agents', 'skills', 'setup-tna'),
      join(HERE, '..', 'plugin', '.claude', 'skills', 'setup-tna'),
      join(HERE, '..', 'plugin', '.opencode', 'skills', 'setup-tna'),
    ];
    const rel = { omp: join('veto-hooks', 'omp', 'tna-veto.ts'), pi: join('veto-hooks', 'pi', 'tna-veto.ts') };
    const ompSource = join(HERE, '..', rel.omp);
    const piSource = join(HERE, '..', rel.pi);
    let tracked = '';
    try { tracked = spawnSync('git', ['ls-files', 'veto-hooks'], { cwd: join(HERE, '..'), encoding: 'utf8' }).stdout; } catch { /* not a repo */ }
    check('L0a the omp veto adapter is TRACKED in git (release payload, not a gitignored artifact)',
      tracked.split('\n').map((s) => s.trim()).includes(rel.omp.split('\\').join('/')), `tracked=[${tracked.trim().split('\n').join(', ')}]`);
    check('L0b the pi veto adapter is TRACKED in git (release payload, not a gitignored artifact)',
      tracked.split('\n').map((s) => s.trim()).includes(rel.pi.split('\\').join('/')), `tracked=[${tracked.trim().split('\n').join(', ')}]`);
    for (const a of adapters) {
      const canonical = readFileSync(join(HERE, '..', rel[a]), 'utf8');
      for (const root of payloadRoots.slice(1)) {
        const p = join(root, rel[a]);
        check(`L0c veto-hooks/${a} byte-identical in payload ${basename(root)}`,
          existsSync(p) && readFileSync(p, 'utf8') === canonical, p);
      }
    }
    const srcOmp = ompSource;
    const srcPi = piSource;

    // L1: omp tree (.omp dir present, no .opencode) + hooks consent -> ~/.omp hook copied
    const dirOmp = mkRepo('onboard-veto-omp-');
    writeFileSync(join(dirOmp, '.gitignore'), '.trust/\n');
    mkdirSync(join(dirOmp, '.omp'), { recursive: true });
    const runOmp = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] })], {
      cwd: dirOmp, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirOmp, HOME: dirOmp },
    });
    const ompDest = join(dirOmp, '.omp', 'agent', 'hooks', 'pre', 'tna-veto.ts');
    check('L1 omp hooks consent copies the veto hook into ~/.omp/agent/hooks/pre/',
      runOmp.status === 0 && existsSync(ompDest), `status=${runOmp.status} dest=${existsSync(ompDest)}`);
    // L1b (origin: omp user bug report 2026-10-18): the copied adapter must be
    // RUNTIME-correct, not merely present - the shipped file referenced
    // readFileSync with NO import, so the handler threw ReferenceError inside
    // readEvidence, the catch swallowed it, and the veto blocked FOREVER even
    // with fresh test evidence (state always read "(missing)"). The shipped
    // adapter must self-contain its imports: every identifier it calls must be
    // imported or defined in the file itself.
    {
      const src = readFileSync(ompDest, 'utf8');
      const calledButUndefined = ['readFileSync', 'writeFileSync', 'existsSync', 'mkdirSync']
        .filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(src))
        .filter((name) => !new RegExp(`import[\\s\\S]*?\\b${name}\\b`).test(src));
      check('L1b the shipped omp adapter is runtime-correct (no unresolved fs identifiers)',
        calledButUndefined.length === 0, `unresolved: ${calledButUndefined.join(', ') || 'none'}`);
    }
    const stampOmp = parseStamp(readFileSync(join(dirOmp, '.trust', 'onboarding.json'), 'utf8'));
    check('L2 the omp stamp records did.vetoHookCopiedOmp=true',
      stampOmp && stampOmp.did && stampOmp.did.vetoHookCopiedOmp === true, JSON.stringify(stampOmp?.did));
    const undoOmp = spawnSync(process.execPath, [ONB, '--undo'], {
      cwd: dirOmp, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirOmp, HOME: dirOmp },
    });
    check('L3 omp --undo removes the copied veto hook',
      undoOmp.status === 0 && !existsSync(ompDest), `code=${undoOmp.status} gone=${!existsSync(ompDest)}`);
    rmSync(dirOmp, { recursive: true, force: true });

    // L4: pi tree (.pi dir present) + hooks consent -> .pi/extensions/tna-veto.ts copied
    const dirPi = mkRepo('onboard-veto-pi-');
    writeFileSync(join(dirPi, '.gitignore'), '.trust/\n');
    mkdirSync(join(dirPi, '.pi'), { recursive: true });
    const runPi = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] })], {
      cwd: dirPi, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirPi, HOME: dirPi },
    });
    const piDest = join(dirPi, '.pi', 'extensions', 'tna-veto.ts');
    check('L4 pi hooks consent copies the veto hook into .pi/extensions/',
      runPi.status === 0 && existsSync(piDest), `status=${runPi.status} dest=${existsSync(piDest)}`);
    // L4b: same runtime-correctness pin as L1b, for the pi adapter.
    {
      const src = readFileSync(piDest, 'utf8');
      const calledButUndefined = ['readFileSync', 'writeFileSync', 'existsSync', 'mkdirSync']
        .filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(src))
        .filter((name) => !new RegExp(`import[\\s\\S]*?\\b${name}\\b`).test(src));
      check('L4b the shipped pi adapter is runtime-correct (no unresolved fs identifiers)',
        calledButUndefined.length === 0, `unresolved: ${calledButUndefined.join(', ') || 'none'}`);
    }
    const stampPi = parseStamp(readFileSync(join(dirPi, '.trust', 'onboarding.json'), 'utf8'));
    check('L5 the pi stamp records did.vetoHookCopiedPi=true',
      stampPi && stampPi.did && stampPi.did.vetoHookCopiedPi === true, JSON.stringify(stampPi?.did));
    // L6: pre-existing pi veto hook is never clobbered
    const dirPi2 = mkRepo('onboard-veto-pi-pre-');
    writeFileSync(join(dirPi2, '.gitignore'), '.trust/\n');
    mkdirSync(join(dirPi2, '.pi', 'extensions'), { recursive: true });
    writeFileSync(join(dirPi2, '.pi', 'extensions', 'tna-veto.ts'), '// USER VERSION');
    const runPi2 = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] })], {
      cwd: dirPi2, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirPi2, HOME: dirPi2 },
    });
    const stampPi2 = parseStamp(readFileSync(join(dirPi2, '.trust', 'onboarding.json'), 'utf8'));
    check('L6 a pre-existing pi veto hook is left untouched (no clobber)',
      runPi2.status === 0
      && readFileSync(join(dirPi2, '.pi', 'extensions', 'tna-veto.ts'), 'utf8') === '// USER VERSION'
      && stampPi2 && stampPi2.did && stampPi2.did.vetoHookCopiedPi === false,
      `status=${runPi2.status} stamp=${JSON.stringify(stampPi2?.did)}`);
    // M-series (workflow-choice spec AC2): the stamp records workflowChoice
    const dirM = mkRepo('onboard-wf-');
    writeFileSync(join(dirM, '.gitignore'), '.trust/\n');
    mkdirSync(join(dirM, '.opencode'), { recursive: true });
    const runM = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, workflowChoice: 'bring-your-own', mapSkills: [] })], {
      cwd: dirM, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirM, HOME: dirM },
    });
    const stampM = parseStamp(readFileSync(join(dirM, '.trust', 'onboarding.json'), 'utf8'));
    check('M1 the stamp records workflowChoice=bring-your-own when consented',
      runM.status === 0 && stampM && stampM.workflowChoice === 'bring-your-own', 'status=' + runM.status + ' wf=' + (stampM && stampM.workflowChoice));
    const dirM2 = mkRepo('onboard-wf-miss-');
    writeFileSync(join(dirM2, '.gitignore'), '.trust/\n');
    mkdirSync(join(dirM2, '.opencode'), { recursive: true });
    const runM2 = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] })], {
      cwd: dirM2, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirM2, HOME: dirM2 },
    });
    const stampM2 = parseStamp(readFileSync(join(dirM2, '.trust', 'onboarding.json'), 'utf8'));
    check('M2 missing workflowChoice -> stamp omits it (fail-closed)',
      runM2.status === 0 && stampM2 && stampM2.workflowChoice === undefined, 'wf=' + JSON.stringify(stampM2 && stampM2.workflowChoice));
    // M3/M4: the other two vocabulary values — the contract promises three
    // (tna-chain / bring-your-own / both); only prove-all-three makes the
    // promise a fact rather than a hope (a validation bug rejecting "both"
    // would pass M1/M2 green).
    const dirM3 = mkRepo('onboard-wf-chain-');
    writeFileSync(join(dirM3, '.gitignore'), '.trust/\n');
    mkdirSync(join(dirM3, '.opencode'), { recursive: true });
    const runM3 = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, workflowChoice: 'tna-chain', mapSkills: [] })], {
      cwd: dirM3, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirM3, HOME: dirM3 },
    });
    const stampM3 = parseStamp(readFileSync(join(dirM3, '.trust', 'onboarding.json'), 'utf8'));
    check('M3 the stamp records workflowChoice=tna-chain when consented',
      runM3.status === 0 && stampM3 && stampM3.workflowChoice === 'tna-chain', 'status=' + runM3.status + ' wf=' + (stampM3 && stampM3.workflowChoice));
    // M3b: a mapping-only re-run on a stamped tree NEVER re-asks consent - the
    // forwarded workflowChoice is ignored and the recorded one persists
    // (the rewrite must carry it through, never drop it).
    const runM3b = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, workflowChoice: 'tna-chain', mapSkills: [] })], {
      cwd: dirM, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirM, HOME: dirM },
    });
    const stampM3b = parseStamp(readFileSync(join(dirM, '.trust', 'onboarding.json'), 'utf8'));
    check('M3b a mapping-only re-run preserves the recorded workflowChoice (never re-asks)',
      runM3b.status === 0 && stampM3b && stampM3b.workflowChoice === 'bring-your-own', 'status=' + runM3b.status + ' wf=' + (stampM3b && stampM3b.workflowChoice));
    const dirM4 = mkRepo('onboard-wf-both-');
    writeFileSync(join(dirM4, '.gitignore'), '.trust/\n');
    mkdirSync(join(dirM4, '.opencode'), { recursive: true });
    const runM4 = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, workflowChoice: 'both', mapSkills: [] })], {
      cwd: dirM4, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dirM4, HOME: dirM4 },
    });
    const stampM4 = parseStamp(readFileSync(join(dirM4, '.trust', 'onboarding.json'), 'utf8'));
    check('M4 the stamp records workflowChoice=both when consented',
      runM4.status === 0 && stampM4 && stampM4.workflowChoice === 'both', 'status=' + runM4.status + ' wf=' + (stampM4 && stampM4.workflowChoice));
    rmSync(dirM, { recursive: true, force: true });
    rmSync(dirM2, { recursive: true, force: true });
    rmSync(dirM3, { recursive: true, force: true });
    rmSync(dirM4, { recursive: true, force: true });
    rmSync(dirPi2, { recursive: true, force: true });
  }
  {
    // K-series (consent-boundary spec AC1-AC4): consent is fail-closed.
    // Empty Enter re-asks; 3 invalid answers abort with nothing written;
    // mapSkills is type-validated; the receipt+stamp record the consent source.
    const { spawnSync } = await import('node:child_process');
    const ONB = join(HERE, 'onboarding.mjs');
    // K1/K2: interactive path — pipe only empty lines: with the re-ask cap
    // (3) and four components, the run must abort WITHOUT a stamp, naming
    // the refusal. (Old behavior: empty = yes, stamp written.)
    const dir = mkRepo('onboard-consent-empty-');
    writeFileSync(join(dir, '.gitignore'), '.trust/\n');
    const r = spawnSync(process.execPath, [ONB], {
      cwd: dir, input: '\n\n\n\n\n\n\n\n\n\n\n\n', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dir, HOME: dir },
    });
    check('K1 empty-Enter consent is re-asked, never granted (no stamp after 12 blank lines)',
      !existsSync(join(dir, '.trust', 'onboarding.json')), `code=${r.status} stamp=${existsSync(join(dir, '.trust', 'onboarding.json'))}`);
    check('K2 the run names the fail-closed refusal', /consent/i.test(String(r.stdout ?? '') + String(r.stderr ?? '')), String(r.stdout ?? '').slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
    // K3: mapSkills non-array aborts before any write
    const dir3 = mkRepo('onboard-consent-ms-');
    writeFileSync(join(dir3, '.gitignore'), '.trust/\n');
    const r3 = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: 'not-an-array' })], {
      cwd: dir3, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dir3, HOME: dir3 },
    });
    check('K3 a non-array mapSkills aborts before any write (no stamp, no overlay dir)',
      r3.status !== 0 && !existsSync(join(dir3, '.trust', 'onboarding.json')),
      `code=${r3.status} stamp=${existsSync(join(dir3, '.trust', 'onboarding.json'))}`);
    rmSync(dir3, { recursive: true, force: true });
    // K4: non-string entries skipped with a named message; good entries land;
    // receipt carries the consent source line.
    const dir4 = mkRepo('onboard-consent-ms2-');
    writeFileSync(join(dir4, '.gitignore'), '.trust/\n');
    fixtureSkill(dir4);
    const r4 = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [42, 'team-playbook'] })], {
      cwd: dir4, input: '', encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dir4, HOME: dir4 },
    });
    const out4 = String(r4.stdout ?? '');
    check('K4 a non-string mapSkills entry is skipped with a named message; valid entries still land',
      out4.includes('42') && existsSync(join(dir4, '.trust', 'skills-overlay', 'team-playbook')), out4.slice(0, 200));
    check('K5 the receipt records the consent source (forwarded via --from-chat)',
      /consent source.{0,40}forwarded/i.test(out4), out4.slice(0, 300));
    rmSync(dir4, { recursive: true, force: true });
  }
  {
    // No .gitignore seed: onboarding APPENDS `.trust/` to the adopter's
    // .gitignore (never overwrites) — the one-door promise covers a repo
    // whose gitignore predates the framework.
    const dir = mkRepo('onboard-gi-');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    mkdirSync(join(dir, 'scripts', 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'hooks', 'pre-commit'), '#!/usr/bin/env bash\n');
    writeFileSync(join(dir, 'scripts', 'hooks', 'commit-msg'), '#!/usr/bin/env bash\n');
    runIn(dir, JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] }));
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    check('I5 onboarding appends .trust/ to an existing .gitignore without clobbering it',
      /node_modules\//.test(gi) && /\.trust\/?/.test(gi), JSON.stringify(gi));
    const doc = spawnSync(process.execPath, [ONBOARD2.replace('onboarding.mjs', 'doctor.mjs')], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    check('I6 the doctor passes the gitignored check after the append',
      !/NOT gitignored/.test(String(doc.stdout ?? '')), String(doc.stdout ?? '').split('\n').filter((l) => /gitignored/.test(l)).join(' | ').slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = mkRepo('onboard-nowire-');
    const r = runIn(dir, JSON.stringify({ components: { floor: true, hooks: false, overlays: true, evidenceGate: true }, mapSkills: [] }));
    check('I3 hooks consent=false does NOT wire hooksPath (declined is off, not broken)',
      r.status === 0 && hooksPathOf(dir) === '', `status=${r.status} hooksPath=${hooksPathOf(dir)}`);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = mkRepo('onboard-undo-wire-');
    runIn(dir, JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] }));
    spawnSync(process.execPath, [ONBOARD2, '--undo'], { cwd: dir, input: '', encoding: 'utf8', timeout: 60000 });
    check('I4 --undo unsets core.hooksPath after onboarding wired it',
      hooksPathOf(dir) === '', `hooksPath=${hooksPathOf(dir)}`);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- N. first-install parity, payload self-sufficiency, preflight + rollback ----
// Re-audit 2026-11: the terminal --yes path wrote only a stamp, the chat path
// installed the mechanical layers, and the distributed payload aborted after
// writing adapters. These probes pin the public CLI seam: terminal/chat/payload
// install the same declared layers, invalid input writes nothing, a mid-install
// failure rolls back operation-owned writes, and a retry after the obstruction
// is removed converges.
{
  const { spawnSync } = await import('node:child_process');
  const ONB = join(HERE, 'onboarding.mjs');
  const copyDir = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, entry.name);
      const dst = join(to, entry.name);
      if (entry.isDirectory()) copyDir(src, dst);
      else if (entry.isFile()) writeFileSync(dst, readFileSync(src));
    }
  };
  const listFiles = (root) => {
    if (!existsSync(root)) return [];
    const out = [];
    const walk = (dir, rel = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const next = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), next);
        else if (entry.isFile()) out.push(next);
      }
    };
    walk(root);
    return out.sort();
  };
  const devinFixture = (prefix) => {
    const dir = tmp(prefix);
    mkdirSync(join(dir, '.devin'), { recursive: true });
    const appData = join(dir, 'appdata');
    mkdirSync(join(appData, 'devin'), { recursive: true });
    writeFileSync(join(appData, 'devin', 'config.json'), '{}\n');
    const env = { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: appData };
    return { dir, appData, env };
  };
  const allConsent = JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] });
  const runOnboard = (script, dir, args, env, input = '') => spawnSync(process.execPath, [script, ...args], {
    cwd: dir, input, encoding: 'utf8', timeout: 60000, env,
  });

  {
    // Terminal/chat parity on the same harness shape. Compare only the layer
    // payload (never the stamp: consent provenance and map answers legitimately
    // differ). Before the fix the terminal tree had no ~/.tna and no skills at all.
    const term = devinFixture('onboard-n-term-');
    const chat = devinFixture('onboard-n-chat-');
    const interactive = devinFixture('onboard-n-interactive-');
    writeFileSync(join(chat.appData, 'devin', 'config.json'), JSON.stringify({
      theme: 'dark',
      hooks: { PreToolUse: [{ matcher: 'foreign', hooks: [{ type: 'command', command: 'node foreign.mjs', timeout: 7 }] }] },
    }, null, 2) + '\n');
    const rt = runOnboard(ONB, term.dir, ['--yes'], term.env);
    const rc = runOnboard(ONB, chat.dir, ['--from-chat', allConsent], chat.env);
    const ri = runOnboard(ONB, interactive.dir, [], interactive.env, 'y\ny\ny\ny\n');
    const termTna = listFiles(join(term.dir, '.tna'));
    const chatTna = listFiles(join(chat.dir, '.tna'));
    const interactiveTna = listFiles(join(interactive.dir, '.tna'));
    const termSkills = listFiles(join(term.dir, '.agents', 'skills'));
    const chatSkills = listFiles(join(chat.dir, '.agents', 'skills'));
    const interactiveSkills = listFiles(join(interactive.dir, '.agents', 'skills'));
    check('N1 terminal --yes installs the same adapter/runtime layer --from-chat installs',
      rt.status === 0 && rc.status === 0 && termTna.length > 0 && JSON.stringify(termTna) === JSON.stringify(chatTna),
      `term=${rt.status}/${termTna.length} chat=${rc.status}/${chatTna.length}`);
    check('N2 terminal --yes installs the same floor skills --from-chat installs',
      termSkills.length > 0 && JSON.stringify(termSkills) === JSON.stringify(chatSkills),
      `term=${termSkills.length} chat=${chatSkills.length}`);
    check('N17 interactive terminal consent installs the same adapter/runtime layer --from-chat installs',
      ri.status === 0 && interactiveTna.length > 0 && JSON.stringify(interactiveTna) === JSON.stringify(chatTna),
      `interactive=${ri.status}/${interactiveTna.length} chat=${chatTna.length} err=${String(ri.stderr ?? '').slice(0, 120)}`);
    check('N18 interactive terminal consent installs the same floor skills --from-chat installs',
      interactiveSkills.length > 0 && JSON.stringify(interactiveSkills) === JSON.stringify(chatSkills),
      `interactive=${interactiveSkills.length} chat=${chatSkills.length}`);
    const chatCfg = JSON.parse(readFileSync(join(chat.appData, 'devin', 'config.json'), 'utf8'));
    check('N22 install preserves unrelated devin settings and foreign hook entries',
      chatCfg.theme === 'dark' && /foreign\.mjs/.test(JSON.stringify(chatCfg.hooks?.PreToolUse ?? [])),
      JSON.stringify(chatCfg).slice(0, 240));
    rmSync(term.dir, { recursive: true, force: true });
    rmSync(chat.dir, { recursive: true, force: true });
    rmSync(interactive.dir, { recursive: true, force: true });
  }

  {
    // Invalid harness config is a preflight failure: nonzero, named, and not one
    // byte of the install may land. The gitignore and router files are canaries.
    const fx = devinFixture('onboard-n-invalid-');
    writeFileSync(join(fx.appData, 'devin', 'config.json'), '{ not json\n');
    writeFileSync(join(fx.dir, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(fx.dir, 'AGENTS.md'), 'OWNER ROUTER — DO NOT REWRITE\n');
    writeFileSync(join(fx.dir, 'WORKFLOW.md'), 'OWNER WORKFLOW — DO NOT REWRITE\n');
    const r = runOnboard(ONB, fx.dir, ['--from-chat', allConsent], fx.env);
    check('N3 invalid harness config exits nonzero before any install write',
      r.status !== 0 && !existsSync(join(fx.dir, '.trust', 'onboarding.json')),
      `status=${r.status} stamp=${existsSync(join(fx.dir, '.trust', 'onboarding.json'))} err=${String(r.stderr ?? '').slice(0, 120)}`);
    check('N4 invalid config leaves gitignore/router bytes and partial layer state untouched',
      readFileSync(join(fx.dir, '.gitignore'), 'utf8') === 'node_modules/\n'
      && readFileSync(join(fx.dir, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER — DO NOT REWRITE\n'
      && readFileSync(join(fx.dir, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW — DO NOT REWRITE\n'
      && !existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && !existsSync(join(fx.dir, '.agents', 'skills', 'expect-fail')),
      `gitignore=${JSON.stringify(readFileSync(join(fx.dir, '.gitignore'), 'utf8'))}`);
    check('N5 the refusal names the invalid config or preflight failure',
      /invalid|not valid json|preflight/i.test(String(r.stdout ?? '') + String(r.stderr ?? '')),
      (String(r.stdout ?? '') + String(r.stderr ?? '')).slice(0, 220));
    rmSync(fx.dir, { recursive: true, force: true });
  }

  {
    // A failure AFTER the first writes must roll back operation-owned state.
    // `.tna/plugin/scripts` as a regular file makes the second adapter copy fail
    // after the devin hook itself has already landed. The rollback must remove
    // that hook, restore .gitignore, and leave no stamp; removing the obstruction
    // and retrying must then converge to a complete install.
    const fx = devinFixture('onboard-n-rollback-');
    fixtureSkill(fx.dir);
    writeFileSync(join(fx.dir, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(fx.dir, 'AGENTS.md'), 'OWNER ROUTER — DO NOT REWRITE\n');
    writeFileSync(join(fx.dir, 'WORKFLOW.md'), 'OWNER WORKFLOW — DO NOT REWRITE\n');
    mkdirSync(join(fx.dir, '.tna', 'plugin'), { recursive: true });
    const blocker = join(fx.dir, '.tna', 'plugin', 'scripts');
    writeFileSync(blocker, 'I am a file where a directory must be created\n');
    const answers = JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: ['team-playbook'] });
    const first = runOnboard(ONB, fx.dir, ['--from-chat', answers], fx.env);
    check('N6 a mid-install write failure exits nonzero and names rollback',
      first.status !== 0 && /rollback|rolled back/i.test(String(first.stdout ?? '') + String(first.stderr ?? '')),
      `status=${first.status} out=${(String(first.stdout ?? '') + String(first.stderr ?? '')).slice(0, 220)}`);
    check('N7 rollback removes operation-owned partial writes and restores pre-existing bytes',
      !existsSync(join(fx.dir, '.trust', 'onboarding.json'))
      && !existsSync(join(fx.dir, '.trust', 'skills-overlay', 'team-playbook'))
      && !existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && readFileSync(join(fx.dir, '.gitignore'), 'utf8') === 'node_modules/\n'
      && readFileSync(join(fx.dir, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER — DO NOT REWRITE\n'
      && readFileSync(join(fx.dir, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW — DO NOT REWRITE\n',
      `stamp=${existsSync(join(fx.dir, '.trust', 'onboarding.json'))} hook=${existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))} gi=${JSON.stringify(readFileSync(join(fx.dir, '.gitignore'), 'utf8'))}`);
    rmSync(blocker, { force: true });
    const retry = runOnboard(ONB, fx.dir, ['--from-chat', answers], fx.env);
    check('N8 retry after the obstruction is removed converges to a complete install',
      retry.status === 0 && existsSync(join(fx.dir, '.trust', 'onboarding.json'))
      && existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && existsSync(join(fx.dir, '.tna', 'plugin', 'scripts', 'gate-hook.mjs'))
      && existsSync(join(fx.dir, '.agents', 'skills', 'expect-fail', 'SKILL.md')),
      `status=${retry.status} err=${String(retry.stderr ?? '').slice(0, 160)}`);
    check('N9 successful install and retry never rewrite router/workflow bytes',
      readFileSync(join(fx.dir, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER — DO NOT REWRITE\n'
      && readFileSync(join(fx.dir, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW — DO NOT REWRITE\n');
    rmSync(fx.dir, { recursive: true, force: true });
  }

  {
    // The distributed payload is the install surface a chat user actually gets:
    // copy ONLY skills/meta/setup-tna into a temp home and run its onboarding.
    // It must carry the skills source it installs; depending on the repo checkout
    // beside it is exactly the broken assumption the re-audit measured.
    const payloadHome = tmp('onboard-n-payload-home-');
    const payload = join(payloadHome, 'setup-tna');
    copyDir(join(HERE, '..', 'skills', 'meta', 'setup-tna'), payload);
    const fx = devinFixture('onboard-n-payload-project-');
    writeFileSync(join(fx.dir, 'AGENTS.md'), 'OWNER ROUTER — DO NOT REWRITE\n');
    writeFileSync(join(fx.dir, 'WORKFLOW.md'), 'OWNER WORKFLOW — DO NOT REWRITE\n');
    const script = join(payload, 'scripts', 'onboarding.mjs');
    const r = runOnboard(script, fx.dir, ['--from-chat', allConsent], fx.env);
    check('N10 the distributed payload first-install exits zero without a repo checkout beside it',
      r.status === 0, `status=${r.status} err=${String(r.stderr ?? '').slice(0, 240)}`);
    check('N11 the distributed payload installs adapters, runtime, and floor skills',
      existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && existsSync(join(fx.dir, '.tna', 'plugin', 'scripts', 'gate-hook.mjs'))
      && existsSync(join(fx.dir, '.agents', 'skills', 'expect-fail', 'SKILL.md')),
      `hook=${existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))} runtime=${existsSync(join(fx.dir, '.tna', 'plugin', 'scripts', 'gate-hook.mjs'))} skill=${existsSync(join(fx.dir, '.agents', 'skills', 'expect-fail', 'SKILL.md'))}`);
    check('N12 the payload install never rewrites pre-existing router/workflow bytes',
      readFileSync(join(fx.dir, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER — DO NOT REWRITE\n'
      && readFileSync(join(fx.dir, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW — DO NOT REWRITE\n');
    const payloadHook = join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs');
    const hookRun = (target, payload) => spawnSync(process.execPath, [payloadHook, target], {
      input: JSON.stringify(payload), cwd: fx.dir, encoding: 'utf8', timeout: 30000,
      env: { ...fx.env, DEVIN_PROJECT_DIR: fx.dir },
    });
    const deny = hookRun('gate-hook', {
      hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: fx.dir,
    });
    check('N15 the payload-installed adapter denies a commit without fresh evidence',
      /"decision":"block"/.test(deny.stdout ?? ''), `status=${deny.status} out=${(deny.stdout ?? '').slice(0, 200)}`);
    hookRun('gate-hook', {
      hook_event_name: 'PostToolUse', tool_name: 'exec', tool_input: { command: 'npm test' },
      tool_response: { exitCode: 0, output: '3 passed' }, cwd: fx.dir,
    });
    const allow = hookRun('gate-hook', {
      hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: fx.dir,
    });
    check('N16 the same commit is allowed after recorded evidence (two-sided payload proof)',
      allow.status === 0
      && !/"decision":"block"/.test(allow.stdout ?? '')
      && /evaluated:\s*allow/.test(String(allow.stderr ?? '')),
      `status=${allow.status} out=${(allow.stdout ?? '').slice(0, 200)} err=${String(allow.stderr ?? '').slice(0, 200)}`);
    rmSync(fx.dir, { recursive: true, force: true });
    rmSync(payloadHome, { recursive: true, force: true });
  }

  {
    // An incomplete distributed payload is not a degraded install: missing
    // runtime/skill sources are preflight failures before the first write.
    const payloadHome = tmp('onboard-n-incomplete-payload-home-');
    const payload = join(payloadHome, 'setup-tna');
    copyDir(join(HERE, '..', 'skills', 'meta', 'setup-tna'), payload);
    rmSync(join(payload, 'skills'), { recursive: true, force: true });
    rmSync(join(payload, 'plugin', 'scripts', 'gate-hook.mjs'), { force: true });
    const fx = devinFixture('onboard-n-incomplete-payload-project-');
    writeFileSync(join(fx.dir, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(fx.dir, 'AGENTS.md'), 'OWNER ROUTER — DO NOT REWRITE\n');
    writeFileSync(join(fx.dir, 'WORKFLOW.md'), 'OWNER WORKFLOW — DO NOT REWRITE\n');
    const r = runOnboard(join(payload, 'scripts', 'onboarding.mjs'), fx.dir, ['--from-chat', allConsent], fx.env);
    const out = String(r.stdout ?? '') + String(r.stderr ?? '');
    check('N19 unavailable payload sources exit nonzero before any install write',
      r.status !== 0
      && !existsSync(join(fx.dir, '.trust', 'onboarding.json'))
      && !existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && !existsSync(join(fx.dir, '.agents', 'skills', 'expect-fail'))
      && readFileSync(join(fx.dir, '.gitignore'), 'utf8') === 'node_modules/\n',
      `status=${r.status} stamp=${existsSync(join(fx.dir, '.trust', 'onboarding.json'))} hook=${existsSync(join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))}`);
    check('N20 the refusal names the missing runtime and skills sources',
      /missing required adapter source/i.test(out) && /gate-hook\.mjs/.test(out) && /missing required skills source/i.test(out),
      out.slice(0, 320));
    check('N21 the incomplete payload never rewrites router/workflow bytes',
      readFileSync(join(fx.dir, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER — DO NOT REWRITE\n'
      && readFileSync(join(fx.dir, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW — DO NOT REWRITE\n');
    rmSync(fx.dir, { recursive: true, force: true });
    rmSync(payloadHome, { recursive: true, force: true });
  }

  {
    // The payload is harness-neutral: an opencode adopter must receive the
    // same self-contained project plugin the manual cp -r path documents.
    const payloadHome = tmp('onboard-n-payload-opencode-home-');
    const payload = join(payloadHome, 'setup-tna');
    copyDir(join(HERE, '..', 'skills', 'meta', 'setup-tna'), payload);
    const fx = tmp('onboard-n-payload-opencode-project-');
    mkdirSync(join(fx, '.opencode'), { recursive: true });
    writeFileSync(join(fx, 'AGENTS.md'), 'OWNER ROUTER — DO NOT REWRITE\n');
    writeFileSync(join(fx, 'WORKFLOW.md'), 'OWNER WORKFLOW — DO NOT REWRITE\n');
    const env = { ...process.env, USERPROFILE: fx, HOME: fx };
    const r = runOnboard(join(payload, 'scripts', 'onboarding.mjs'), fx, ['--from-chat', allConsent], env);
    const pluginDir = join(fx, '.opencode', 'plugins', 'tna-gate');
    const compressPath = join(pluginDir, 'output-trim', 'output-trim-compress.js');
    const probe = existsSync(compressPath)
      ? spawnSync(process.execPath, ['-e', `const x=require(${JSON.stringify(compressPath)});process.stdout.write(typeof x.compressForOpencode)`], { encoding: 'utf8', timeout: 30000 })
      : { status: -1, stdout: '', stderr: 'compressor missing' };
    check('N23 the distributed payload installs a self-contained opencode veto plugin',
      r.status === 0
      && existsSync(join(pluginDir, 'index.js'))
      && existsSync(compressPath)
      && probe.status === 0
      && probe.stdout === 'function',
      `install=${r.status} index=${existsSync(join(pluginDir, 'index.js'))} compressor=${existsSync(compressPath)} probe=${probe.status}/${String(probe.stdout ?? '')} err=${(String(r.stderr ?? '') + String(probe.stderr ?? '')).slice(0, 220)}`);
    check('N24 the payload opencode install never rewrites router/workflow bytes',
      readFileSync(join(fx, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER — DO NOT REWRITE\n'
      && readFileSync(join(fx, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW — DO NOT REWRITE\n');
    rmSync(fx, { recursive: true, force: true });
    rmSync(payloadHome, { recursive: true, force: true });
  }

  {
    // Refresh is an install surface too: it must use the same transaction. Delete
    // one installed adapter so refresh writes it, then make the later runtime copy
    // fail. The partial adapter write must be rolled back; after the obstruction
    // is removed, retrying refresh converges.
    const fx = devinFixture('onboard-n-refresh-rollback-');
    const first = runOnboard(ONB, fx.dir, ['--from-chat', allConsent], fx.env);
    const hookPath = join(fx.dir, '.tna', 'veto-hooks', 'devin', 'hook.mjs');
    const runtimeDir = join(fx.dir, '.tna', 'plugin', 'scripts');
    rmSync(hookPath, { force: true });
    rmSync(runtimeDir, { recursive: true, force: true });
    writeFileSync(runtimeDir, 'I am a file where a directory must be created\n');
    const failed = runOnboard(ONB, fx.dir, ['--refresh'], fx.env);
    check('N13 a failed refresh exits nonzero, names rollback, and removes its partial adapter write',
      first.status === 0 && failed.status !== 0
      && /rollback|rolled back/i.test(String(failed.stdout ?? '') + String(failed.stderr ?? ''))
      && !existsSync(hookPath),
      `first=${first.status} failed=${failed.status} hook=${existsSync(hookPath)} out=${(String(failed.stdout ?? '') + String(failed.stderr ?? '')).slice(0, 220)}`);
    rmSync(runtimeDir, { force: true });
    const retry = runOnboard(ONB, fx.dir, ['--refresh'], fx.env);
    check('N14 retrying refresh after the obstruction is removed converges',
      retry.status === 0 && existsSync(hookPath) && existsSync(join(runtimeDir, 'gate-hook.mjs')),
      `status=${retry.status} hook=${existsSync(hookPath)} runtime=${existsSync(join(runtimeDir, 'gate-hook.mjs'))}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

// ---- P. shared-install undo ownership (first-install trust-layer AC6/AC7/AC10) ----
{
  const { spawnSync } = await import('node:child_process');
  const ONB = join(HERE, 'onboarding.mjs');
  const allConsent = JSON.stringify({ components: { floor: true, hooks: true, overlays: true, evidenceGate: true }, mapSkills: [] });
  const isolatedEnv = (home) => {
    const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: join(home, 'appdata') };
    delete env.CLAUDE_PLUGIN_ROOT;
    return env;
  };
  const runOnboard = (dir, args, env, input = '') => spawnSync(process.execPath, [ONB, ...args], {
    cwd: dir, input, encoding: 'utf8', timeout: 60000, env,
  });
  const devinProject = (home, name) => {
    const appData = join(home, 'appdata');
    mkdirSync(join(appData, 'devin'), { recursive: true });
    const config = join(appData, 'devin', 'config.json');
    if (!existsSync(config)) writeFileSync(config, '{}\n');
    const dir = join(home, 'projects', name);
    mkdirSync(join(dir, '.devin'), { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), `OWNER ROUTER ${name} — DO NOT REWRITE\n`);
    writeFileSync(join(dir, 'WORKFLOW.md'), `OWNER WORKFLOW ${name} — DO NOT REWRITE\n`);
    return { dir, appData, config };
  };

  {
    const home = tmp('onboard-p-agy-home-');
    const dir = join(home, 'project');
    mkdirSync(join(dir, '.agents'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'hooks.json'), '{}\n');
    const config = join(home, '.gemini', 'config', 'hooks.json');
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({
      foreignSetting: { keep: 'yes' },
      'tna-veto': {
        PreToolUse: [{ matcher: 'foreign', hooks: [{ type: 'command', command: 'node foreign.mjs', timeout: 7 }] }],
        PostToolUse: [{ matcher: 'foreign', hooks: [{ type: 'command', command: 'node foreign.mjs', timeout: 7 }] }],
      },
    }, null, 2) + '\n');
    const env = isolatedEnv(home);
    const install = runOnboard(dir, ['--from-chat', allConsent], env);
    const cfgAfterInstall = JSON.parse(readFileSync(config, 'utf8'));
    const pre = cfgAfterInstall['tna-veto'].PreToolUse;
    const foreignEntry = pre.find((entry) => JSON.stringify(entry).includes('foreign.mjs'));
    const tnaEntry = pre.find((entry) => JSON.stringify(entry).includes('veto-hooks'));
    if (foreignEntry && tnaEntry && foreignEntry !== tnaEntry) {
      foreignEntry.hooks.push(...tnaEntry.hooks);
      cfgAfterInstall['tna-veto'].PreToolUse = [foreignEntry];
      writeFileSync(config, JSON.stringify(cfgAfterInstall, null, 2) + '\n');
    }
    const undo = runOnboard(dir, ['--undo'], env);
    const cfgAfterUndo = existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')) : null;
    const undoText = JSON.stringify(cfgAfterUndo);
    check('P1 a foreign hook inside the framework-named antigravity group survives install and undo',
      install.status === 0 && undo.status === 0
      && cfgAfterUndo && cfgAfterUndo.foreignSetting.keep === 'yes'
      && /foreign\.mjs/.test(JSON.stringify(cfgAfterUndo['tna-veto']?.PreToolUse ?? []))
      && /foreign\.mjs/.test(JSON.stringify(cfgAfterUndo['tna-veto']?.PostToolUse ?? []))
      && !/veto-hooks[\\/]antigravity/.test(undoText),
      `install=${install.status} undo=${undo.status} cfg=${undoText.slice(0, 320)} out=${String(undo.stdout ?? '').slice(0, 160)}`);
    rmSync(home, { recursive: true, force: true });
  }

  {
    const home = tmp('onboard-p-two-home-');
    const a = devinProject(home, 'alpha');
    const b = devinProject(home, 'beta');
    writeFileSync(a.config, JSON.stringify({
      theme: 'dark',
      hooks: { PreToolUse: [{ matcher: 'foreign', hooks: [{ type: 'command', command: 'node foreign.mjs', timeout: 7 }] }] },
    }, null, 2) + '\n');
    const env = isolatedEnv(home);
    const installA = runOnboard(a.dir, ['--from-chat', allConsent], env);
    const installB = runOnboard(b.dir, ['--from-chat', allConsent], env);
    const undoA = runOnboard(a.dir, ['--undo'], env);
    const hookPath = join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs');
    const runtimePath = join(home, '.tna', 'plugin', 'scripts', 'gate-hook.mjs');
    const cfg = JSON.parse(readFileSync(a.config, 'utf8'));
    const cfgText = JSON.stringify(cfg);
    const hookRun = (target, payload) => spawnSync(process.execPath, [hookPath, target], {
      input: JSON.stringify(payload), cwd: b.dir, encoding: 'utf8', timeout: 30000,
      env: { ...env, DEVIN_PROJECT_DIR: b.dir },
    });
    const deny = hookRun('gate-hook', {
      hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: b.dir,
    });
    hookRun('gate-hook', {
      hook_event_name: 'PostToolUse', tool_name: 'exec', tool_input: { command: 'npm test' },
      tool_response: { exitCode: 0, output: '3 passed' }, cwd: b.dir,
    });
    const allow = hookRun('gate-hook', {
      hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: 'git commit -m x' }, cwd: b.dir,
    });
    check('P2 undoing project A preserves project B runtime, registrations, and deny/allow behavior',
      installA.status === 0 && installB.status === 0 && undoA.status === 0
      && existsSync(hookPath) && existsSync(runtimePath)
      && existsSync(join(b.dir, '.trust', 'onboarding.json'))
      && !existsSync(join(a.dir, '.trust', 'onboarding.json'))
      && /veto-hooks[\\/]devin[\\/]hook\.mjs/.test(cfgText)
      && /"decision":"block"/.test(String(deny.stdout ?? ''))
      && !/"decision":"block"/.test(String(allow.stdout ?? ''))
      && allow.status === 0 && /evaluated:\s*allow/.test(String(allow.stderr ?? '')),
      `installs=${installA.status}/${installB.status} undo=${undoA.status} hook=${existsSync(hookPath)} deny=${String(deny.stdout ?? '').slice(0, 100)} allow=${String(allow.stdout ?? '').slice(0, 100)} allowErr=${String(allow.stderr ?? '').slice(0, 100)} cfg=${cfgText.slice(0, 180)}`);
    check('P3 undo preserves router/workflow bytes and unrelated devin configuration values',
      readFileSync(join(a.dir, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER alpha — DO NOT REWRITE\n'
      && readFileSync(join(a.dir, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW alpha — DO NOT REWRITE\n'
      && readFileSync(join(b.dir, 'AGENTS.md'), 'utf8') === 'OWNER ROUTER beta — DO NOT REWRITE\n'
      && readFileSync(join(b.dir, 'WORKFLOW.md'), 'utf8') === 'OWNER WORKFLOW beta — DO NOT REWRITE\n'
      && cfg.theme === 'dark' && /foreign\.mjs/.test(cfgText),
      `theme=${cfg.theme} cfg=${cfgText.slice(0, 220)}`);
    rmSync(home, { recursive: true, force: true });
  }

  {
    const home = tmp('onboard-p-final-home-');
    const a = devinProject(home, 'sole');
    const env = isolatedEnv(home);
    const install = runOnboard(a.dir, ['--from-chat', allConsent], env);
    const undo = runOnboard(a.dir, ['--undo'], env);
    check('P4 the final owner release removes unmodified shared runtime files',
      install.status === 0 && undo.status === 0
      && !existsSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && !existsSync(join(home, '.tna', 'plugin', 'scripts', 'gate-hook.mjs')),
      `install=${install.status} undo=${undo.status} hook=${existsSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))}`);
    rmSync(home, { recursive: true, force: true });
  }

  {
    const home = tmp('onboard-p-modified-home-');
    const a = devinProject(home, 'modified');
    const env = isolatedEnv(home);
    const install = runOnboard(a.dir, ['--from-chat', allConsent], env);
    const runtimePath = join(home, '.tna', 'plugin', 'scripts', 'gate-hook.mjs');
    writeFileSync(runtimePath, readFileSync(runtimePath, 'utf8') + '\n// user local change\n');
    const undo = runOnboard(a.dir, ['--undo'], env);
    const out = String(undo.stdout ?? '') + String(undo.stderr ?? '');
    check('P5 a user-modified shared runtime file is never silently removed by undo',
      install.status === 0 && existsSync(runtimePath)
      && readFileSync(runtimePath, 'utf8').endsWith('\n// user local change\n')
      && /user-modified|differs|left untouched/i.test(out),
      `install=${install.status} undo=${undo.status} exists=${existsSync(runtimePath)} out=${out.slice(0, 220)}`);
    rmSync(home, { recursive: true, force: true });
  }

  {
    const home = tmp('onboard-p-bad-owner-home-');
    const a = devinProject(home, 'bad-owner');
    const env = isolatedEnv(home);
    const install = runOnboard(a.dir, ['--from-chat', allConsent], env);
    const ownershipPath = join(home, '.tna', 'ownership.json');
    writeFileSync(ownershipPath, '{ not valid ownership json\n');
    const undo = runOnboard(a.dir, ['--undo'], env);
    const out = String(undo.stdout ?? '') + String(undo.stderr ?? '');
    check('P6 a malformed ownership record fails closed before shared-resource removal',
      install.status === 0 && undo.status !== 0
      && existsSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && existsSync(join(a.dir, '.trust', 'onboarding.json'))
      && /ownership/i.test(out),
      `install=${install.status} undo=${undo.status} hook=${existsSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))} stamp=${existsSync(join(a.dir, '.trust', 'onboarding.json'))} out=${out.slice(0, 220)}`);
    rmSync(home, { recursive: true, force: true });
  }

  {
    const home = tmp('onboard-p-omp-home-');
    const a = devinProject(home, 'omp-alpha');
    const b = devinProject(home, 'omp-beta');
    mkdirSync(join(a.dir, '.omp'), { recursive: true });
    mkdirSync(join(b.dir, '.omp'), { recursive: true });
    const env = isolatedEnv(home);
    const installA = runOnboard(a.dir, ['--from-chat', allConsent], env);
    const installB = runOnboard(b.dir, ['--from-chat', allConsent], env);
    const undoA = runOnboard(a.dir, ['--undo'], env);
    const shared = [
      join(home, '.omp', 'agent', 'hooks', 'pre', 'tna-veto.ts'),
      join(home, '.omp', 'agent', 'hooks', 'pre', 'tna-discipline.ts'),
      join(home, '.omp', 'agent', 'extensions', 'tna-receipts-gate.ts'),
    ];
    check('P8 undoing project A preserves project B shared omp adapters',
      installA.status === 0 && installB.status === 0 && undoA.status === 0
      && shared.every((path) => existsSync(path)),
      `installs=${installA.status}/${installB.status} undo=${undoA.status} exists=${shared.map((path) => existsSync(path)).join(',')}`);
    rmSync(home, { recursive: true, force: true });
  }

  {
    const home = tmp('onboard-p-dsh-home-');
    mkdirSync(join(home, '.dsh', 'profiles', 'acp'), { recursive: true });
    writeFileSync(join(home, '.dsh', 'profiles', 'acp', 'cordis.yml'), 'profile: acp\n');
    const a = devinProject(home, 'dsh-alpha');
    const b = devinProject(home, 'dsh-beta');
    const env = isolatedEnv(home);
    const installA = runOnboard(a.dir, ['--from-chat', allConsent], env);
    const installB = runOnboard(b.dir, ['--from-chat', allConsent], env);
    const undoA = runOnboard(a.dir, ['--undo'], env);
    const patch = join(home, '.dsh', 'profiles', 'acp', 'cordis.patch.yml');
    const patchAfterA = existsSync(patch) ? readFileSync(patch, 'utf8') : '';
    const plugins = [
      join(home, '.dsh', 'profiles', 'acp', 'plugins', 'tna-veto.mjs'),
      join(home, '.dsh', 'profiles', 'acp', 'plugins', 'tna-discipline.mjs'),
    ];
    check('P9 undoing project A preserves project B dsh plugins and registrations',
      installA.status === 0 && installB.status === 0 && undoA.status === 0
      && plugins.every((path) => existsSync(path))
      && patchAfterA.includes('tna-veto') && patchAfterA.includes('tna-discipline'),
      `installs=${installA.status}/${installB.status} undo=${undoA.status} plugins=${plugins.map((path) => existsSync(path)).join(',')} patch=${patchAfterA.slice(0, 180)}`);
    const undoB = runOnboard(b.dir, ['--undo'], env);
    const patchAfterB = existsSync(patch) ? readFileSync(patch, 'utf8') : '';
    check('P10 the final dsh owner release removes plugins and registrations',
      undoB.status === 0
      && plugins.every((path) => !existsSync(path))
      && !patchAfterB.includes('tna-veto') && !patchAfterB.includes('tna-discipline'),
      `undoB=${undoB.status} plugins=${plugins.map((path) => existsSync(path)).join(',')} patch=${patchAfterB.slice(0, 180)}`);
    rmSync(home, { recursive: true, force: true });
  }

  {
    const home = tmp('onboard-p-tamper-owner-home-');
    const a = devinProject(home, 'tampered-owner');
    const env = isolatedEnv(home);
    const install = runOnboard(a.dir, ['--from-chat', allConsent], env);
    const canary = join(home, 'canary.txt');
    writeFileSync(canary, 'must survive');
    const ownershipPath = join(home, '.tna', 'ownership.json');
    writeFileSync(ownershipPath, JSON.stringify({
      schema: 1,
      resources: {
        [`file:${canary.replace(/\\/g, '/')}`]: { kind: 'file', owners: [a.dir.replace(/\\/g, '/')], hash: '0000000000000000000000000000000000000000000000000000000000000000' },
      },
    }, null, 2) + '\n');
    const undo = runOnboard(a.dir, ['--undo'], env);
    check('P7 an untrusted ownership record cannot widen undo filesystem authority',
      install.status === 0 && existsSync(canary)
      && existsSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))
      && readFileSync(canary, 'utf8') === 'must survive',
      `install=${install.status} undo=${undo.status} canary=${existsSync(canary)} hook=${existsSync(join(home, '.tna', 'veto-hooks', 'devin', 'hook.mjs'))}`);
    rmSync(home, { recursive: true, force: true });
  }
}

// ---- T05. Layered readiness in install output (first-install trust-layer AC11) ----
// The receipt is a readiness claim, so consent labels are not enough: every
// required mechanical layer must be named with its honest state, adapter-level
// evidence must never be upgraded into live-host proof, and a decline or an
// unsupported surface must cap the overall verdict below full readiness.
{
  const { spawnSync } = await import('node:child_process');
  const ONB = join(HERE, 'onboarding.mjs');
  const mkDevin = (prefix) => {
    const dir = tmp(prefix);
    mkdirSync(join(dir, '.devin'), { recursive: true });
    const appData = join(dir, 'appdata');
    mkdirSync(join(appData, 'devin'), { recursive: true });
    writeFileSync(join(appData, 'devin', 'config.json'), '{}\n');
    const env = { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: appData };
    delete env.CLAUDE_PLUGIN_ROOT;
    return { dir, env };
  };
  const runInstall = (fx, components) => spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components, mapSkills: [] })], {
    cwd: fx.dir, input: '', encoding: 'utf8', timeout: 60000, env: fx.env,
  });
  const outputOf = (r) => String(r.stdout ?? '') + String(r.stderr ?? '');
  const namesEveryLayer = (text) => ['floor', 'mandatory-gate', 'veto', 'evidence-recorder', 'done-gate', 'ledger-append-only']
    .every((name) => new RegExp(`${name}:`).test(text));

  {
    const fx = mkDevin('onboard-t05-declined-');
    const r = runInstall(fx, { floor: true, hooks: false, overlays: false, evidenceGate: false });
    const text = outputOf(r);
    check('T05a a hooks-declined install names the declined mechanical layers',
      r.status === 0 && /Readiness \(required layers\)/.test(text)
      && /mandatory-gate:\s*declined/.test(text)
      && /veto:\s*declined/.test(text)
      && /evidence-recorder:\s*declined/.test(text),
      `status=${r.status} out=${text.slice(-700)}`);
    check('T05b a hooks-declined install never emits a full-readiness verdict',
      !/full-readiness|fully ready|installation healthy/i.test(text)
      && /Overall:\s*partial readiness/i.test(text),
      `status=${r.status} out=${text.slice(-500)}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }

  {
    const fx = mkDevin('onboard-t05-complete-');
    const r = runInstall(fx, { floor: true, hooks: true, overlays: false, evidenceGate: true });
    const text = outputOf(r);
    check('T05c a complete install names every required layer in its receipt',
      r.status === 0 && /Readiness \(required layers\)/.test(text) && namesEveryLayer(text),
      `status=${r.status} out=${text.slice(-800)}`);
    check('T05d the strongest honest verdict still names unsupported and unproven surfaces',
      /done-gate:\s*unsupported/.test(text)
      && /adapter self-test:/.test(text)
      && /live host proof:\s*(open|unproven)/i.test(text)
      && /Overall:\s*partial readiness/i.test(text)
      && !/full-readiness|fully ready|installation healthy/i.test(text),
      `status=${r.status} out=${text.slice(-800)}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

// ---- F1. A declined component suppresses its wiring, not just its report (roast r1) ----
// Spec line 88: a decline remains off. The install receipt already says
// "declined", but the planner wired every event anyway — a floor decline
// still wrote SessionStart:reinject, an evidence-gate decline still wrote
// the Pre/PostToolUse entries. The wired file is the artifact the harness
// reads, so the test inspects config.json itself.
{
  const { spawnSync } = await import('node:child_process');
  const ONB = join(HERE, 'onboarding.mjs');
  const mkDevin = (prefix) => {
    const dir = tmp(prefix);
    mkdirSync(join(dir, '.devin'), { recursive: true });
    const appData = join(dir, 'appdata');
    mkdirSync(join(appData, 'devin'), { recursive: true });
    writeFileSync(join(appData, 'devin', 'config.json'), '{}\n');
    const env = { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: appData };
    delete env.CLAUDE_PLUGIN_ROOT;
    return { dir, env };
  };
  const runInstall = (fx, components) => spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components, mapSkills: [] })], {
    cwd: fx.dir, input: '', encoding: 'utf8', timeout: 60000, env: fx.env,
  });
  const wired = (fx) => JSON.parse(readFileSync(join(fx.dir, 'appdata', 'devin', 'config.json'), 'utf8'));

  {
    const fx = mkDevin('onboard-f1-flooroff-');
    const r = runInstall(fx, { floor: false, hooks: true, overlays: false, evidenceGate: true });
    const cfg = wired(fx);
    check('F1a a floor decline writes NO SessionStart:reinject entry',
      r.status === 0 && !JSON.stringify(cfg.hooks?.SessionStart ?? []).includes('reinject'),
      `status=${r.status} SessionStart=${JSON.stringify(cfg.hooks?.SessionStart ?? null)}`);
    check('F1b a floor decline still wires the consented hook entries',
      JSON.stringify(cfg.hooks?.PreToolUse ?? []).includes('gate-hook')
      && JSON.stringify(cfg.hooks?.PostToolUse ?? []).includes('gate-hook')
      && JSON.stringify(cfg.hooks?.UserPromptSubmit ?? []).includes('gate-hook'),
      `status=${r.status} cfg=${JSON.stringify(cfg.hooks ?? null).slice(0, 300)}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }
  {
    const fx = mkDevin('onboard-f1-egoff-');
    const r = runInstall(fx, { floor: true, hooks: true, overlays: false, evidenceGate: false });
    const cfg = wired(fx);
    check('F1c an evidence-gate decline writes NO Pre/PostToolUse entries',
      r.status === 0
      && !JSON.stringify(cfg.hooks?.PreToolUse ?? []).includes('gate-hook')
      && !JSON.stringify(cfg.hooks?.PostToolUse ?? []).includes('gate-hook'),
      `status=${r.status} cfg=${JSON.stringify(cfg.hooks ?? null).slice(0, 300)}`);
    check('F1d an evidence-gate decline still wires floor + mandatory-gate entries',
      JSON.stringify(cfg.hooks?.SessionStart ?? []).includes('reinject')
      && JSON.stringify(cfg.hooks?.UserPromptSubmit ?? []).includes('gate-hook'),
      `status=${r.status} cfg=${JSON.stringify(cfg.hooks ?? null).slice(0, 300)}`);
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

// ---- F2. Shared dsh skills carry project ownership (roast r1) ----
// dsh skills install into the shared ~/.dsh/skills — two projects can claim
// the same copies. Undo used to rmSync every stamped skillsCopied path with
// no owner check, so one project's --undo ripped the floor out from under a
// sibling. The byte-identical rule as other resources: only the FINAL owner
// deletes, and only while the copy still matches what was installed.
{
  const { spawnSync } = await import('node:child_process');
  const ONB = join(HERE, 'onboarding.mjs');
  const home = tmp('onboard-f2-home-');
  mkdirSync(join(home, '.dsh', 'profiles', 'acp'), { recursive: true });
  writeFileSync(join(home, '.dsh', 'profiles', 'acp', 'cordis.patch.yml'), '# patch\n');
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  delete env.CLAUDE_PLUGIN_ROOT;
  const install = (dir) => spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: [] })], {
    cwd: dir, input: '', encoding: 'utf8', timeout: 60000, env,
  });
  const undo = (dir) => spawnSync(process.execPath, [ONB, '--undo'], {
    cwd: dir, input: '', encoding: 'utf8', timeout: 60000, env,
  });
  const skillsDir = join(home, '.dsh', 'skills');
  const installed = () => existsSync(skillsDir) && readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, 'SKILL.md'))).length > 0;

  {
    const a = tmp('onboard-f2-a-');
    const b = tmp('onboard-f2-b-');
    const ra = install(a);
    check('F2a a dsh install copies skills into the shared skills dir',
      ra.status === 0 && installed(), `status=${ra.status} out=${String(ra.stdout ?? '').slice(-300)}`);
    const rb = install(b);
    check('F2b a second project install keeps the shared skills (claimed as co-owner)',
      rb.status === 0 && installed(), `status=${rb.status} out=${String(rb.stdout ?? '').slice(-300)}`);
    const ua = undo(a);
    check('F2c undoing the first project leaves shared skills in place (another owner remains)',
      ua.status === 0 && installed(), `status=${ua.status} out=${String(ua.stdout ?? '').slice(-400)}`);
    const ub = undo(b);
    check('F2d undoing the FINAL owner removes the shared skills',
      ub.status === 0 && !installed(), `status=${ub.status} out=${String(ub.stdout ?? '').slice(-400)}`);
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
  {
    // Sole owner still gets a clean undo — the registry must not turn a
    // one-project install into a permanent leak.
    const home2 = tmp('onboard-f2-home2-');
    mkdirSync(join(home2, '.dsh', 'profiles', 'acp'), { recursive: true });
    writeFileSync(join(home2, '.dsh', 'profiles', 'acp', 'cordis.patch.yml'), '# patch\n');
    const env2 = { ...process.env, USERPROFILE: home2, HOME: home2 };
    delete env2.CLAUDE_PLUGIN_ROOT;
    const c = tmp('onboard-f2-c-');
    const rc = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: [] })], {
      cwd: c, input: '', encoding: 'utf8', timeout: 60000, env: env2,
    });
    const skillsDir2 = join(home2, '.dsh', 'skills');
    const uc = spawnSync(process.execPath, [ONB, '--undo'], {
      cwd: c, input: '', encoding: 'utf8', timeout: 60000, env: env2,
    });
    check('F2e a sole owner undo still removes the shared skills it installed',
      rc.status === 0 && uc.status === 0
      && !(existsSync(skillsDir2) && readdirSync(skillsDir2).filter((n) => existsSync(join(skillsDir2, n, 'SKILL.md'))).length > 0),
      `install=${rc.status} undo=${uc.status} out=${String(uc.stdout ?? '').slice(-300)}`);
    rmSync(c, { recursive: true, force: true });
    rmSync(home2, { recursive: true, force: true });
  }
  rmSync(home, { recursive: true, force: true });
}

// ---- F4. Registration evaluates only the config file the install targets (roast r1) ----
// Unioning all candidate files let a complete config sitting at a candidate the
// installer never touches certify a target file that lacks the contract.
{
  const home = tmp('onboard-f4-home-');
  const appData = join(home, 'appdata');
  const target = join(appData, 'devin', 'config.json');      // first candidate — install target
  const other = join(home, '.config', 'devin', 'config.json'); // second candidate — never installed to
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(dirname(other), { recursive: true });
  const ev = (event, target2) => ({ hooks: [{ type: 'command', command: `node "x/veto-hooks/devin/hook.mjs" ${target2}` }] });
  writeFileSync(target, JSON.stringify({ hooks: { SessionStart: ev('SessionStart', 'reinject') } }));
  writeFileSync(other, JSON.stringify({ hooks: {
    SessionStart: ev('SessionStart', 'reinject'),
    UserPromptSubmit: ev('UserPromptSubmit', 'gate-hook'),
    PreToolUse: ev('PreToolUse', 'gate-hook'),
    PostToolUse: ev('PostToolUse', 'gate-hook'),
  } }));
  const prev = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA };
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  process.env.APPDATA = appData;
  try {
    const r = registrationStatus('devin', home);
    check('F4 registration reports the target file missing events even when another candidate is fully wired',
      r.missing.includes('UserPromptSubmit:gate-hook') && r.missing.includes('PreToolUse:gate-hook'),
      `missing=${JSON.stringify(r.missing)}`);
  } finally {
    process.env.USERPROFILE = prev.USERPROFILE;
    process.env.HOME = prev.HOME;
    process.env.APPDATA = prev.APPDATA;
  }
  rmSync(home, { recursive: true, force: true });
}

// ---- F9. hookCmd quoting survives metachar home paths (roast r1) ----
// `node "path"` inside double quotes still lets POSIX shells expand $(...) and
// backticks — a home dir like a$(id) would EXECUTE on hook invocation. Every
// POSIX-active char in the path must be backslash-escaped.
{
  const hookPath = 'C:/Users/meta$`evil`(x) dir/.tna/veto-hooks/devin/hook.mjs';
  const { merged } = planDevinConfig({}, hookPath, { floor: true, hooks: true, evidenceGate: true });
  const cmds = JSON.stringify(merged.hooks);
  // Every `$`, backtick, and interior `"` must carry a backslash escape.
  check('F9 a home path with $, backticks, spaces, and parens cannot alter the command',
    !/(?<!\\)[$`]/.test(cmds) && /\\\$/.test(cmds) && /\\`/.test(cmds),
    `hooks=${cmds.slice(0, 260)}`);
}

// ---- F5. Read-only scan/preflight must not create .dsh/profiles/acp (roast r1) ----
// preflightFirstInstall iterated adaptersFor('dsh') whose dshProfileDirs
// fallback mkdir'd the acp profile — an abort that reports "nothing was
// written" left the directory behind.
{
  const { spawnSync } = await import('node:child_process');
  const ONB = join(HERE, 'onboarding.mjs');
  const home = tmp('onboard-f5-home-');
  const appData = join(home, 'appdata');
  mkdirSync(join(appData, 'devin'), { recursive: true });
  const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: appData };
  delete env.CLAUDE_PLUGIN_ROOT;
  const dir = tmp('onboard-f5-proj-');
  mkdirSync(join(dir, '.dsh'), { recursive: true });
  const r = spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({
    components: { floor: true, hooks: true, overlays: true, evidenceGate: true },
    mapSkills: 'not-an-array',
  })], { cwd: dir, input: '', encoding: 'utf8', timeout: 60000, env });
  check('F5 aborting preflight leaves no .dsh/profiles/acp directory behind',
    r.status !== 0 && !existsSync(join(dir, '.dsh', 'profiles', 'acp')),
    `status=${r.status} acp=${existsSync(join(dir, '.dsh', 'profiles', 'acp'))} err=${String(r.stderr ?? '').slice(-160)}`);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

// ---- F3. Undo strips only the entries this install wrote (roast r1) ----
// A pre-existing marker-matching entry (the user's own wiring, or a sibling
// install's) must survive our --undo. Install recorded only coarse
// entries:added and undo called unwireConfig — every command carrying the
// TNA marker went, including wiring this install never created.
{
  const { spawnSync } = await import('node:child_process');
  const ONB = join(HERE, 'onboarding.mjs');
  const home = tmp('onboard-f3-home-');
  const appData = join(home, 'appdata');
  mkdirSync(join(appData, 'devin'), { recursive: true });
  const configFile = join(appData, 'devin', 'config.json');
  // The user's own pre-existing marker-matching wiring — recorded by nobody.
  const USER_ENTRY = 'node "C:/their-own-layout/veto-hooks/devin/hook.mjs" reinject';
  writeFileSync(configFile, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: USER_ENTRY }] }] },
  }, null, 2) + '\n');
  const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: appData };
  delete env.CLAUDE_PLUGIN_ROOT;
  const install = (dir) => spawnSync(process.execPath, [ONB, '--from-chat', JSON.stringify({ components: { floor: true, hooks: true, overlays: false, evidenceGate: true }, mapSkills: [] })], {
    cwd: dir, input: '', encoding: 'utf8', timeout: 60000, env,
  });
  const undo = (dir) => spawnSync(process.execPath, [ONB, '--undo'], {
    cwd: dir, input: '', encoding: 'utf8', timeout: 60000, env,
  });
  const readCfg = () => JSON.parse(readFileSync(configFile, 'utf8'));
  const sessionStartHasUserEntry = () => JSON.stringify(readCfg().hooks?.SessionStart ?? []).includes('their-own-layout');

  {
    const a = tmp('onboard-f3-a-');
    mkdirSync(join(a, '.devin'), { recursive: true });
    const b = tmp('onboard-f3-b-');
    mkdirSync(join(b, '.devin'), { recursive: true });
    const ra = install(a);
    check('F3a install preserves the pre-existing marker-matching entry (deduped as equivalent)',
      ra.status === 0 && sessionStartHasUserEntry(), `status=${ra.status} SessionStart=${JSON.stringify(readCfg().hooks?.SessionStart ?? null).slice(0, 240)}`);
    const rb = install(b);
    check('F3b a sibling install claims shared entries without rewriting the file',
      rb.status === 0 && sessionStartHasUserEntry(), `status=${rb.status}`);
    const ua = undo(a);
    check('F3c undoing the first project leaves entries the sibling claims AND the user entry intact',
      ua.status === 0 && sessionStartHasUserEntry()
      && JSON.stringify(readCfg().hooks?.PreToolUse ?? []).includes('gate-hook'),
      `status=${ua.status} cfg=${JSON.stringify(readCfg().hooks ?? null).slice(0, 400)}`);
    const ub = undo(b);
    check('F3d undoing the final owner strips our entries but PRESERVES the pre-existing marker entry',
      ub.status === 0 && sessionStartHasUserEntry()
      && !JSON.stringify(readCfg().hooks?.PreToolUse ?? []).includes('gate-hook')
      && !JSON.stringify(readCfg().hooks?.PostToolUse ?? []).includes('gate-hook'),
      `status=${ub.status} cfg=${JSON.stringify(readCfg().hooks ?? null).slice(0, 400)}`);
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
  rmSync(home, { recursive: true, force: true });
}

// ---- R2. Wired-equivalence must require OUR dispatcher path (roast r2) ----
// `hook.mjs <target>` from ANY path counted as already-wired: a foreign
// `node /evil/hook.mjs gate-hook` suppressed our real entry (install skipped)
// and satisfied the doctor's registration contract. Equivalence is only valid
// for our own adapter — `veto-hooks/devin/hook.mjs` at whatever layout.
{
  const foreign = { hooks: { PreToolUse: [{ matcher: 'x', hooks: [{ type: 'command', command: 'node "/evil/hook.mjs" gate-hook', timeout: 7 }] }] } };
  const { merged, added, already } = planDevinConfig(foreign, 'C:/u/.tna/veto-hooks/devin/hook.mjs', { floor: true, hooks: true, evidenceGate: true });
  check('R2a a foreign hook.mjs path does NOT count as already-wired',
    added.includes('PreToolUse:gate-hook') && !already.includes('PreToolUse:gate-hook'),
    `added=${JSON.stringify(added)} already=${JSON.stringify(already)}`);
  check('R2b the foreign entry itself is preserved alongside ours',
    /evil\/hook\.mjs/.test(JSON.stringify(merged.hooks.PreToolUse)),
    JSON.stringify(merged.hooks.PreToolUse).slice(0, 300));
  const ours = { hooks: { PreToolUse: [{ matcher: 'x', hooks: [{ type: 'command', command: 'node "C:/their-own/veto-hooks/devin/hook.mjs" gate-hook', timeout: 7 }] }] } };
  const r2 = planDevinConfig(ours, 'C:/u/.tna/veto-hooks/devin/hook.mjs', { floor: true, hooks: true, evidenceGate: true });
  check('R2c our own adapter at a custom layout still dedupes (equivalence kept)',
    r2.already.includes('PreToolUse:gate-hook') && !r2.added.includes('PreToolUse:gate-hook'),
    `added=${JSON.stringify(r2.added)} already=${JSON.stringify(r2.already)}`);
}
{
  // registrationStatus uses the same equivalence — a foreign hook.mjs must
  // not satisfy the registration contract either.
  const home = tmp('onboard-r2-home-');
  const appData = join(home, 'appdata');
  mkdirSync(join(appData, 'devin'), { recursive: true });
  const cfgFile = join(appData, 'devin', 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'node "/evil/hook.mjs" reinject' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "/evil/hook.mjs" gate-hook' }] }],
    PreToolUse: [{ hooks: [{ type: 'command', command: 'node "/evil/hook.mjs" gate-hook' }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: 'node "/evil/hook.mjs" gate-hook' }] }],
  } }));
  const prev = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA };
  process.env.USERPROFILE = home; process.env.HOME = home; process.env.APPDATA = appData;
  try {
    const r = registrationStatus('devin', home);
    check('R2d foreign hook.mjs wiring leaves every event missing in registration',
      r.missing.length === 4, `missing=${JSON.stringify(r.missing)}`);
  } finally {
    process.env.USERPROFILE = prev.USERPROFILE; process.env.HOME = prev.HOME; process.env.APPDATA = prev.APPDATA;
  }
  rmSync(home, { recursive: true, force: true });
}

// ---- R3. Registration evidence must read command fields only (roast r2) ----
// eventCommands collected EVERY string under the event key — a description or
// statusMessage containing `hook.mjs gate-hook` satisfied the contract and hid
// an unwired gate. Only real command fields count.
{
  const home = tmp('onboard-r3-home-');
  const appData = join(home, 'appdata');
  mkdirSync(join(appData, 'devin'), { recursive: true });
  writeFileSync(join(appData, 'devin', 'config.json'), JSON.stringify({ hooks: {
    PreToolUse: [{ description: 'veto-hooks/devin/hook.mjs gate-hook', hooks: [] }],
    PostToolUse: [{ statusMessage: 'veto-hooks/devin/hook.mjs gate-hook' }],
  } }));
  const prev = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA };
  process.env.USERPROFILE = home; process.env.HOME = home; process.env.APPDATA = appData;
  try {
    const r = registrationStatus('devin', home);
    check('R3 a description/statusMessage string never satisfies the registration contract',
      r.missing.includes('PreToolUse:gate-hook') && r.missing.includes('PostToolUse:gate-hook'),
      `missing=${JSON.stringify(r.missing)}`);
  } finally {
    process.env.USERPROFILE = prev.USERPROFILE; process.env.HOME = prev.HOME; process.env.APPDATA = prev.APPDATA;
  }
  rmSync(home, { recursive: true, force: true });
}

// ---- R3-resid. Prose must not set `evidence`; event keys must not match at
// arbitrary depth (roast r3) ----
// registrationStatus still substring-matched the raw file text for `evidence`,
// so a lone description/comment containing the marker reported TNA-shaped
// wiring. And eventCommands walked the whole config — an event key under a
// `backup`/disabled wrapper, or a `command` inside a non-hook sub-object,
// satisfied the contract.
{
  const home = tmp('onboard-r3b-home-');
  const appData = join(home, 'appdata');
  mkdirSync(join(appData, 'devin'), { recursive: true });
  writeFileSync(join(appData, 'devin', 'config.json'), JSON.stringify({ hooks: {
    PreToolUse: [{ description: 'veto-hooks/devin/hook.mjs gate-hook', hooks: [] }],
  } }));
  const prev = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA };
  process.env.USERPROFILE = home; process.env.HOME = home; process.env.APPDATA = appData;
  try {
    const r = registrationStatus('devin', home);
    check('R3b prose alone never sets evidence',
      r.evidence === false, `evidence=${r.evidence}`);
  } finally {
    process.env.USERPROFILE = prev.USERPROFILE; process.env.HOME = prev.HOME; process.env.APPDATA = prev.APPDATA;
  }
  rmSync(home, { recursive: true, force: true });
}
{
  const home = tmp('onboard-r3c-home-');
  const appData = join(home, 'appdata');
  mkdirSync(join(appData, 'devin'), { recursive: true });
  const cmd = 'node "C:/u/veto-hooks/devin/hook.mjs" gate-hook';
  writeFileSync(join(appData, 'devin', 'config.json'), JSON.stringify({ hooks: {
    backup: { PreToolUse: [{ hooks: [{ type: 'command', command: cmd }] }] },
    archived: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd }] }] },
    SessionStart: [{ hooks: [{ type: 'command', command: 'node "C:/u/veto-hooks/devin/hook.mjs" reinject' }] }],
    PreToolUse: [{ hooks: [{ type: 'command', command: cmd }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: cmd }] }],
  } }));
  const prev = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA };
  process.env.USERPROFILE = home; process.env.HOME = home; process.env.APPDATA = appData;
  try {
    const r = registrationStatus('devin', home);
    check('R3c an event key under a non-hooks wrapper never satisfies registration',
      r.missing.includes('UserPromptSubmit:gate-hook'),
      `missing=${JSON.stringify(r.missing)}`);
  } finally {
    process.env.USERPROFILE = prev.USERPROFILE; process.env.HOME = prev.HOME; process.env.APPDATA = prev.APPDATA;
  }
  rmSync(home, { recursive: true, force: true });
}
{
  // The canonical-path equivalence is case-insensitive on the same ground as
  // the filesystems that carry it — `VETO-HOOKS\Devin\hook.mjs` IS our
  // dispatcher, not a foreign hook (roast r3 nit → required: it double-fired).
  const mixed = { hooks: { PreToolUse: [{ matcher: 'x', hooks: [{ type: 'command', command: 'node "C:/u/.tna/VETO-HOOKS/DEVIN/HOOK.MJS" gate-hook', timeout: 7 }] }] } };
  const { added, already } = planDevinConfig(mixed, 'C:/u/.tna/veto-hooks/devin/hook.mjs', { floor: true, hooks: true, evidenceGate: true });
  check('R3d own dispatcher path dedupes case-insensitively',
    already.includes('PreToolUse:gate-hook') && !added.includes('PreToolUse:gate-hook'),
    `added=${JSON.stringify(added)} already=${JSON.stringify(already)}`);
}

console.log(failures === 0 ? '\nAll onboarding seam expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
