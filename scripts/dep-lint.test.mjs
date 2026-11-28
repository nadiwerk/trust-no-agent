#!/usr/bin/env node
/**
 * Fail-first test for scripts/dep-lint.mjs — dependency-touch lint.
 * Zero dependencies. Run: node scripts/dep-lint.test.mjs
 *
 * Seam: checkDeps(files, { commitMsg }) — flags dependency manifests in a
 * changed-file list. Report mode always returns the touched manifests; gate
 * mode fails unless the commit message carries a `dep-ok` marker. Skills
 * lockfiles (skills-lock.json) are NOT third-party deps — never flagged.
 */
import { checkDeps, DEP_FILES } from './dep-lint.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// ---- A. Dependency manifests are detected ----
{
  const { depFiles } = checkDeps(['src/index.js', 'package.json'], {});
  check('A1 package.json flagged', depFiles.includes('package.json'), JSON.stringify(depFiles));
}
{
  const { depFiles } = checkDeps(['a/package-lock.json', 'b/requirements.txt', 'c.txt'], {});
  check('A2 lockfile + requirements flagged, plain file not',
    depFiles.length === 2 && depFiles.every((f) => f !== 'c.txt'), JSON.stringify(depFiles));
}
{
  const { depFiles } = checkDeps(['skills-lock.json', 'scripts/x.mjs'], {});
  check('A3 skills-lock.json is NOT a third-party dep', depFiles.length === 0, JSON.stringify(depFiles));
}
{
  check('A4 DEP_FILES exported and non-empty', Array.isArray(DEP_FILES) && DEP_FILES.length > 3);
}

// ---- B. Gate mode: dep touch without marker fails, with marker passes ----
{
  const { depFiles, ok } = checkDeps(['package.json'], { gate: true, commitMsg: 'feat: x' });
  check('B1 dep touch without dep-ok marker fails gate',
    depFiles.length === 1 && ok === false, JSON.stringify({ depFiles, ok }));
}
{
  const { ok } = checkDeps(['package.json'], { gate: true, commitMsg: 'feat: x\n\ndep-ok: lodash pinned 4.17.21' });
  check('B2 dep touch with dep-ok marker passes gate', ok === true);
}
{
  const { ok } = checkDeps(['src/index.js'], { gate: true, commitMsg: 'feat: x' });
  check('B3 no dep touch passes gate trivially', ok === true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
