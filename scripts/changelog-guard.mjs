#!/usr/bin/env node
/**
 * A structural guard for CHANGELOG.md — the release artifact that has now been
 * corrupted twice by the same release step.
 *
 * The defect this exists to end (2026-09-30, twice in two releases): while
 * adding a compare link for the new version, the edit was anchored on the
 * `[Unreleased]: …` line inside the trailing link block, and the replacement
 * swallowed the version heading that follows it. The result was a CHANGELOG that
 * still looked complete — every other heading intact, the link block intact —
 * with one entire release section silently gone (`## [0.1.22]` the first time,
 * `## [0.1.23]` the second). Both were caught only because the release-notes
 * extraction could not find its anchor, which is an accident, not a check.
 *
 * What is structurally true of a correct CHANGELOG, and therefore checkable:
 *
 *   1. The link block lives at the TAIL. Everything from its first line to EOF
 *      is a link definition or a blank line. A heading cannot be swallowed by a
 *      tail-anchored edit if the tail cannot hold headings (M1).
 *   2. Every release LINK has a matching release HEADING, and vice versa (M2).
 *      This is the exact signature of both incidents: a link with no section.
 *   3. `[Unreleased]` appears exactly once as a heading and once as a link (M3).
 *      Both incidents began with a duplicate/missing pair here.
 *   4. Version headings are descending, newest first (M4) — the writer contract
 *      (`## [x.y.z] - <date>` above the previous release), and a duplicate band
 *      is how a bad replace announces itself early.
 *
 * The check runs on any CHANGELOG path so it can be pointed at a candidate file
 * during a release, not only at the committed one.
 *
 * Usage: node scripts/changelog-guard.mjs [path]   (default: CHANGELOG.md)
 * Exit 0 = structurally sound; exit 1 = a release section or link is missing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;
const UNRELEASED_HEADING = /^## \[Unreleased\]/;
const LINK_LINE = /^\[([^\]]+)\]:\s*https?:\/\/\S+/;

/**
 * @param {string} text CHANGELOG contents
 * @returns {{errors: string[], stats: {versions: string[], linkCount: number}}}
 */
export function checkChangelog(text) {
  const errors = [];
  const lines = text.split(/\r?\n/);

  // M1 — the link block is a TAIL: no heading may appear inside or after it.
  const firstLink = lines.findIndex((l) => LINK_LINE.test(l));
  if (firstLink !== -1) {
    const tail = lines.slice(firstLink);
    const strayHeadings = tail.filter((l) => /^#{1,6}\s/.test(l));
    if (strayHeadings.length)
      errors.push(
        `the compare-link block is not at the tail: ${strayHeadings.length} heading(s) sit inside it (first: "${strayHeadings[0].slice(0, 60)}") — a release edit anchored there can swallow a section`,
      );
  }

  const versionHeadingLine = (v) => versionHeadingLineIn(lines, v);
  const versions = [];
  const links = new Set();
  for (const l of lines) {
    const vh = l.match(VERSION_HEADING);
    if (vh) versions.push(vh[1]);
    const lk = l.match(LINK_LINE);
    if (lk) links.add(lk[1]);
  }

  // M2 — every release section has its compare link, and every link its section.
  const headingSet = new Set(versions);
  const missingLinks = versions.filter((v) => !links.has(v));
  const orphanLinks = [...links].filter((v) => /^\d+\.\d+\.\d+$/.test(v) && !headingSet.has(v));
  if (missingLinks.length)
    errors.push(`release heading(s) with no compare link: ${missingLinks.join(', ')}`);
  if (orphanLinks.length)
    errors.push(
      `compare link(s) with no release section: ${orphanLinks.join(', ')} — the signature of a section being swallowed (this is the 2026-09-30 incident)`,
    );

  // M3 — exactly one `[Unreleased]` heading and one `[Unreleased]` link.
  const unreleasedHeadings = lines.filter((l) => UNRELEASED_HEADING.test(l)).length;
  const unreleasedLinks = lines.filter((l) => /^\[Unreleased\]:\s*https/.test(l)).length;
  if (unreleasedHeadings !== 1)
    errors.push(`expected exactly one "## [Unreleased]" heading, found ${unreleasedHeadings}`);
  if (unreleasedLinks !== 1)
    errors.push(`expected exactly one "[Unreleased]:" link, found ${unreleasedLinks}`);

  // M4 — newest first, no duplicates.
  //
  // Compares each SUCCESSIVE pair numerically, and reports the offending pair
  // with its line numbers: the first version of this walk reported
  // "0.1.23 appears after 0.1.24" for a file whose order was correct, and the
  // message could not be trusted because it named the pair without saying where
  // (2026-09-30 — the guard's own bug hunt). Numeric compare, explicitly: string
  // compare puts "0.1.9" after "0.1.11".
  const seen = new Set();
  for (let i = 1; i < versions.length; i++) {
    const newer = versions[i - 1];
    const older = versions[i];
    if (seen.has(older)) errors.push(`duplicate release heading: ${older}`);
    seen.add(newer);
    if (compareSemver(older, newer) > 0)
      errors.push(
        `release headings are not newest-first: ${older} (${versionHeadingLine(older)}) appears after ${newer} (${versionHeadingLine(newer)})`,
      );
  }
  if (versions.length) seen.add(versions[versions.length - 1]);

  return { errors, stats: { versions, linkCount: links.size } };
}

/** Line number of a version's heading, for a message the reader can act on. */
function versionHeadingLineIn(lines, v) {
  const i = lines.findIndex((l) => new RegExp('^## \\[' + v.replace(/\./g, '\\.') + '\\]').test(l));
  return i === -1 ? 'missing' : 'line ' + (i + 1);
}

/**
 * -1 when a is older than b, +1 when newer, 0 when equal.
 *
 * Numeric per segment. A plain string compare would order "0.1.9" after
 * "0.1.11", which is exactly the kind of confident-but-wrong signal this guard
 * exists to prevent (and it bit the guard's own first version, 2026-09-30).
 */
function compareSemver(a, b) {
  if (a === b) return 0;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] === undefined || pb[i] === undefined) return a < b ? -1 : 1;
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = resolve(ROOT, process.argv[2] ?? 'CHANGELOG.md');
  if (!existsSync(target)) {
    console.error(`FAIL: ${target} does not exist`);
    process.exit(1);
  }
  const { errors, stats } = checkChangelog(readFileSync(target, 'utf8'));
  if (errors.length) {
    for (const e of errors) console.error(`ERROR changelog: ${e}`);
    console.error(`\nFAIL: ${errors.length} structural error(s) — ${stats.versions.length} release heading(s), ${stats.linkCount} link(s)`);
    process.exit(1);
  }
  console.log(`OK: changelog structure sound (${stats.versions.length} releases, ${stats.linkCount} links, link block at the tail)`);
  process.exit(0);
}
