#!/usr/bin/env node
/**
 * trust-no-agent doctor — installation self-check for adopters.
 * Pure Node, zero dependencies. Run: node scripts/doctor.mjs
 *   (from inside the project whose installation you want to check; the script
 *   may live in a trust-no-agent clone — canonical skill names are read from
 *   its own ../skills when present, so a clone can doctor any project.)
 * Exit 0 = installation healthy. Exit 1 = an enforcement gap found.
 *
 * Checks an adopter's installation against the documented install contract:
 *  C1. Router present (AGENTS.md + WORKFLOW.md) in the current directory.
 *  C2. Git hooks active: core.hooksPath set to a dir holding pre-commit +
 *      commit-msg (and, in repo mode, identical to the tracked copies).
 *  C3. Every canonical skill exists in at least one harness discovery path:
 *      ./skills (repo / clone-on-demand), project .agents/.opencode/.claude/
 *      .cursor skills dirs, or ~/.agents/skills (agentskills.io standard).
 *  C4. Ledger ready: .trust/ either absent-but-creatable on first ship-log
 *      (warn) or present and confirmed gitignored.
 *  C5. Corrective tier enforced: a ledger with entries but no .trust/lessons.md
 *      warns during a 14-day grace period (measured from the oldest dated
 *      ledger entry, ship-log `## YYYY-MM-DD` headers), then FAILS — after
 *      grace, lesson capture is mandatory, not optional. Test override:
 *      TNA_DOCTOR_GRACE_DAYS. Decision logic lives in corrective-tier.mjs.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { checkStarve, checkStale, DEFAULT_GRACE_DAYS } from './corrective-tier.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_SKILLS = join(ROOT, 'skills');
// Used only when doctor runs outside a trust-no-agent clone (no ../skills to
// read). Kept in sync with the repo layout; a clone run reads the filesystem.
const FALLBACK_SKILLS = [
  'breakpoint', 'scribe', 'save-as', 'fork-it', 'make-it-so',
  'expect-fail', 'root-cause', 'roast-my-code', 'receipts', 'no-thanks', 'ship-log',
];

const cwd = process.cwd();
const problems = [];
const notes = [];
const pass = (m) => console.log('PASS  ' + m);
const warn = (m) => { notes.push(m); console.log('WARN  ' + m); };
const fail = (m) => { problems.push(m); console.log('FAIL  ' + m); };

// ---- canonical skill names: filesystem truth in repo mode, fallback list otherwise ----
let skillNames = FALLBACK_SKILLS;
if (existsSync(REPO_SKILLS)) {
  const names = [];
  for (const cat of readdirSync(REPO_SKILLS)) {
    const catDir = join(REPO_SKILLS, cat);
    if (!statSync(catDir).isDirectory()) continue;
    for (const skill of readdirSync(catDir)) {
      if (statSync(join(catDir, skill)).isDirectory() && existsSync(join(catDir, skill, 'SKILL.md')))
        names.push(skill);
    }
  }
  if (names.length) skillNames = names.sort();
}

console.log(`trust-no-agent doctor — checking ${cwd}`);
console.log(`expects ${skillNames.length} skills (${skillNames.join(', ')})`);

// ---- C1. router ----
for (const f of ['AGENTS.md', 'WORKFLOW.md']) {
  if (existsSync(join(cwd, f))) pass(`router ${f} present`);
  else fail(`router ${f} missing — copy from the trust-no-agent repo: cp ${f} .`);
}

// ---- C2. git hooks ----
let hooksPath = '';
try {
  hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8' }).trim();
} catch { /* not set */ }
if (!hooksPath) {
  fail('core.hooksPath not set — enforcement inactive. Run: git config core.hooksPath scripts/hooks');
} else {
  const hp = join(cwd, hooksPath);
  const hasPre = existsSync(join(hp, 'pre-commit'));
  const hasMsg = existsSync(join(hp, 'commit-msg'));
  if (!hasPre || !hasMsg)
    fail(`hooks dir "${hooksPath}" lacks ${hasPre ? '' : 'pre-commit '}${hasMsg ? '' : 'commit-msg'}`);
  else {
    pass(`git hooks active (core.hooksPath=${hooksPath})`);
    // Repo mode: compare against the tracked copies so a stale hook is caught.
    const tracked = join(ROOT, 'scripts', 'hooks');
    if (existsSync(join(tracked, 'pre-commit'))) {
      for (const h of ['pre-commit', 'commit-msg']) {
        if (!existsSync(join(tracked, h))) continue;
        const a = readFileSync(join(hp, h), 'utf8');
        const b = readFileSync(join(tracked, h), 'utf8');
        if (a !== b) warn(`${h} differs from the repo's tracked copy — refresh it`);
      }
    }
  }
}

// ---- C3. skills in a discovery location ----
// A skill root may use either layout: the repo's categorized
// skills/<cat>/<name>/SKILL.md or an adopter's flattened skills/<name>/SKILL.md
// (README install: cp -r skills/*/*). A candidate dir counts when either shape
// holds the skill.
const candidates = [];
const pushIfExists = (p) => { if (existsSync(p)) candidates.push(p); };
const skillPresent = (dir, name) => {
  if (existsSync(join(dir, name, 'SKILL.md'))) return true; // flattened
  // categorized: any <cat>/<name>/SKILL.md under the root
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry, name, 'SKILL.md');
    if (existsSync(p)) return true;
  }
  return false;
};
pushIfExists(join(cwd, 'skills')); // repo checkout / clone-on-demand layout
pushIfExists(join(cwd, '.agents', 'skills'));
pushIfExists(join(cwd, '.opencode', 'skills'));
pushIfExists(join(cwd, '.claude', 'skills'));
pushIfExists(join(cwd, '.cursor', 'skills'));
pushIfExists(join(homedir(), '.agents', 'skills')); // agentskills.io shared path
const missing = skillNames.filter((name) => !candidates.some((d) => skillPresent(d, name)));
if (missing.length)
  fail(`skills missing from every discovery location: ${missing.join(', ')}`);
else
  pass(`${skillNames.length} skills found in harness discovery path(s)`);

// ---- C6. update check (stale skills) ----
// Detection is mechanical; the update itself is a user decision — see
// docs/installation.md "Updating" (model proposes, user approves).
// Installed version: .trust/tna-version, stamped at install/update time.
// Upstream version: highest [x.y.z] heading in this clone's CHANGELOG.md.
{
  const changelog = join(ROOT, 'CHANGELOG.md');
  const upstreamVersion = existsSync(changelog)
    ? (readFileSync(changelog, 'utf8').match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1] || ''
    : '';
  const marker = join(cwd, '.trust', 'tna-version');
  const installedVersion = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
  const res = checkStale({ installedVersion, upstreamVersion });
  if (res.level === 'stale') warn(res.message);
  else if (res.level === 'unstamped') warn(res.message);
  else if (res.level === 'current' && installedVersion)
    pass(`skills version current (v${installedVersion})`);
  // 'unknown' (no upstream changelog or nothing installed) degrades silently
}

// ---- C4. ledger ----
const trust = join(cwd, '.trust');
if (!existsSync(trust)) {
  warn('.trust/ ledger not created yet — created on first ship-log entry; add .trust/ to .gitignore to keep it private');
} else {
  try {
    const out = execFileSync('git', ['check-ignore', '.trust/progress.txt'], { cwd, encoding: 'utf8' });
    if (out.trim()) pass('.trust/ confirmed gitignored');
    else fail('.trust/ exists but is NOT gitignored — add .trust/ to .gitignore (private ledger)');
  } catch {
    // exit 1 = not ignored; exit 128 = not a git repo — distinguish
    try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' }); fail('.trust/ exists but is NOT gitignored — add .trust/ to .gitignore (private ledger)'); }
    catch { warn('not inside a git repo — cannot verify .trust/ is gitignored'); }
  }
}

// ---- C5. corrective tier enforced (grace, then hard) ----
// lessons.md is the corrective memory tier; its writers are the make-it-so
// repair loop and the receipts lesson capture (see eval.mjs check 18). A
// ledger that grows while lessons.md never appears means lessons are being
// skipped. checkStarve (corrective-tier.mjs) turns that drift into a signal:
// WARN during the grace period, FAIL once grace is exhausted — after grace,
// lesson capture is mandatory, not optional.
if (existsSync(trust)) {
  const lessonsPath = join(trust, 'lessons.md');
  const progressPath = join(trust, 'progress.txt');
  let ledgerText = '';
  if (existsSync(progressPath)) {
    try { ledgerText = readFileSync(progressPath, 'utf8'); } catch { ledgerText = 'unreadable'; }
  }
  const graceDays = Number(process.env.TNA_DOCTOR_GRACE_DAYS ?? '') || DEFAULT_GRACE_DAYS;
  const res = checkStarve({
    ledgerText,
    lessonsExists: existsSync(lessonsPath),
    today: new Date(),
    graceDays,
  });
  if (res.level === 'fail') fail(res.message);
  else if (res.level === 'warn') warn(res.message);
  else pass('corrective tier healthy (lessons.md exists)');

  // ---- C7. ledger audit (Loaded:-gap / visual-gate / context-gap) ----
  // The audit is WARN, not FAIL: the ledger is private working memory and its
  // format is agent-written, so findings are leads for the next session to fix
  // (add the missing line or load the skill), not installation defects. The
  // decision logic lives in ledger-audit.mjs, tested by ledger-audit.test.mjs.
  if (existsSync(progressPath)) {
    try {
      const { auditLedger } = await import('./ledger-audit.mjs');
      const { findings } = auditLedger({ ledgerText, today: new Date() });
      for (const f of findings) warn(f.message);
      if (!findings.length) pass('ledger audit clean (Loaded: trail, visual gate, context confirmation)');
    } catch { warn('ledger audit could not run — scripts/ledger-audit.mjs unreadable'); }
  }
}

// ---- summary ----
console.log('');
if (problems.length) {
  console.error(`FAIL: ${problems.length} installation gap(s), ${notes.length} warning(s).`);
  process.exit(1);
}
console.log(`OK: installation healthy (${notes.length} warning(s)).`);
process.exit(0);
