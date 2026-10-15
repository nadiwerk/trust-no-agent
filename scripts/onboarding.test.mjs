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
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanSkillDirs, suggestTriggers, planOnboarding, serializeStamp, parseStamp } from './onboarding.mjs';
import { parseOverlayFrontmatter } from './overlay-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
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
    const dir = tmp('onboard-never-');
    const r = spawnSync(process.execPath, [ONBOARD, '--undo'], { cwd: dir, input: '', encoding: 'utf8', timeout: 30000 });
    check('G2 --undo on a never-onboarded tree is a no-op with a named message',
      r.status === 0 && /nothing to undo/i.test(String(r.stdout ?? '')), `code=${r.status} out=${String(r.stdout ?? '').slice(0, 120)}`);
    rmSync(dir, { recursive: true, force: true });
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

console.log(failures === 0 ? '\nAll onboarding seam expectations hold.' : `\nFAIL: ${failures} expectation(s) broken.`);
process.exit(failures === 0 ? 0 : 1);
