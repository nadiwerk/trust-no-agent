#!/usr/bin/env node
/**
 * Regression pin for eval checks 35-38 (hardening-general 05/AC9,
 *
 * What it pins: (a) the adapter-matrix markers exist in the three live
 * files, (b) the check code exists in eval.mjs. The FAIL direction — eval
 * exits 1 when the matrix is removed — was proven live in-session
 * (2026-10-12: 8 errors, exit 1, recorded in .trust/progress.txt) before the
 * prose landed, and re-proven for THIS file by the strip-and-restore dance
 * (matrix paragraph removed → this suite FAILs; restored → PASS). Checks 37
 * (newcomer onboarding) and 38 (remaining-harness verdicts) pinned the same
 * way: markers stripped → FAIL.
 *
 * Zero dependencies. Run: node scripts/eval-adapter.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const makeItSo = readFileSync(join(ROOT, 'skills', 'engineering', 'make-it-so', 'SKILL.md'), 'utf8');
for (const [label, re] of [
  ['adapter matrix named', /adapter matrix/i],
  ['opencode veto adapter named', /tool\.execute\.before/],
  ['Claude/Codex pre-tool adapter named', /PreToolUse/],
  ['no-single-API rule literal', /No single harness API carries enforcement/],
]) {
  check(`35 ${label} in AGENTS.md §5`, re.test(agents), String(re));
}

const compat = readFileSync(join(ROOT, 'docs', 'compatibility.md'), 'utf8');
const install = readFileSync(join(ROOT, 'docs', 'installation.md'), 'utf8');
for (const [file, text] of [['compatibility.md', compat], ['installation.md', install]]) {
  check(`36 veto-vs-audit-only table in ${file}`, /veto vs audit-only/i.test(text), file);
  check(`36 doc-first marking in ${file}`, /doc-first/i.test(text), file);
}

const evalSrc = readFileSync(join(HERE, 'eval.mjs'), 'utf8');
check('eval.mjs carries check 35 (adapter matrix)', /---- 35\. /.test(evalSrc));
check('eval.mjs carries check 36 (veto guarantee docs)', /---- 36\. /.test(evalSrc));
check('eval.mjs carries check 37 (onboarding markers)', /---- 37\. /.test(evalSrc));
check('eval.mjs carries check 38 (remaining-harness verdicts)', /---- 38\. /.test(evalSrc));
check('eval.mjs carries the AC8 row-discipline rule (veto rows name proof status)', /Row discipline/.test(evalSrc));
// Check 39 pins (findings-adaptation ticket 02, AC4): the brief contract readers —
// eval.mjs §39 itself, the template + filled example in AGENTS.md §5, and the
// executor-side fields in make-it-so. FAIL direction: markers stripped from
// AGENTS.md → these red (proven by check 39's own RED run before §5 gained
// the template).
check('eval.mjs carries check 39 (brief VERIFY/TIMEBOX/PARTIAL)', /---- 39\. /.test(evalSrc));
for (const [label, re] of [
  ['VERIFY placeholder', /VERIFY: </],
  ['TIMEBOX placeholder', /TIMEBOX: </],
  ['PARTIAL placeholder', /PARTIAL: </],
  ['filled example', /VERIFY: node /],
]) {
  check(`39 ${label} in AGENTS.md §5`, re.test(agents), String(re));
}
for (const [label, re] of [
  ['VERIFY named', /VERIFY:/],
  ['TIMEBOX named', /TIMEBOX/],
  ['PARTIAL named', /PARTIAL/],
]) {
  check(`39 ${label} in make-it-so delegation section`, re.test(makeItSo), String(re));
}

// Check 40 pins (findings-adaptation ticket 03, AC5): the autonomy ladder's
// adopter-facing contract. FAIL direction: strip the ladder paragraph from
// compatibility.md → these red (proven by check 40's own RED run).
check('eval.mjs carries check 40 (autonomy ladder decay)', /---- 40\. /.test(evalSrc));
for (const [label, re] of [
  ['rungs in order', /audit-only\s*→\s*veto-proven\s*→\s*trusted/],
  ['decay window stated', /30-day|30 days|DECAY_DAYS/],
  ['read-time decay stated', /read[- ]time/i],
  ['CLI named', /autonomy-ladder\.mjs/],
]) {
  check(`40 ${label} in compatibility.md`, re.test(compat), String(re));
}
for (const [label, re] of [
  ['per-step Verify: line', /Verify:/],
  ['dual-router refusal named', /dual-router/i],
  ['purge documented', /purge/i],
  ['sweep documented', /sweep/i],
  ['doctor-output-first support flow', /doctor output first/i],
]) {
  check(`37 ${label} in installation.md`, re.test(install), String(re));
}

// Check 38 pins (full-enforcement ticket 03, AC4/AC5): OMO verdict + dated
// live-proof plans exist in compatibility.md. FAIL direction proven the same
// way (verdicts removed → FAIL).
for (const [label, re] of [
  ['OMO verdict written', /OMO verdict/i],
  ['omp/Devin live-proof plan', /live-proof plan/i],
  ['review-by date set', /review-by 2026-11-13/i],
]) {
  check(`38 ${label} in compatibility.md`, re.test(compat), String(re));
}

// Check 41 pins (findings-adaptation ticket 04, AC6): the staleness doctrine at
// the recall site. FAIL direction: strip the stale-probe bullet from
// make-it-so → these red (proven by check 41's own RED run — 4 errors before
// the bullet landed; the --allow-exec pin reddens without the sign-off,
// proven by the 2026-10-13 strip-dance).
check('eval.mjs carries check 41 (stale lessons cannot gate)', /---- 41\. /.test(evalSrc));
for (const [label, re] of [
  ['probe CLI named', /stale-probe\.mjs/],
  ['staleness window stated', /21[- ]day|21 days/],
  ['execution opt-in stated', /--allow-exec/],
  ['dead verdict named', /dead/i],
  ['dead cannot gate stated', /cannot gate|can.?t gate|never gates|not be able to gate/],
  ['re-verification mechanism stated', /Probe:/],
]) {
  check(`41 ${label} in make-it-so lessons section`, re.test(makeItSo), String(re));
}

// Check 44 pins (onboarding ticket 10, AC15): the onboarding contract at
// the adopter doc. FAIL direction: strip the onboarding section from
// docs/installation.md -> these red.
check('eval.mjs carries check 44 (onboarding contract)', /---- 44\. /.test(evalSrc));
for (const [label, re] of [
  ['CLI named', /onboarding\.mjs/],
  ['per-component consent stated', /consent per component|per component/],
  ['declined-is-OFF stated', /mechanically OFF|declin\w+ (is )?OFF/],
  ['mapping scope stated', /maps your\s+installed skills/],
  ['grandfather stated', /grandfather/],
  ['map-only stated', /--map-only/],
  ['undo stated', /--undo/],
]) {
  check(`44 ${label} in installation.md onboarding section`, re.test(install), String(re));
}

// Check 45 pins (receipt-enforcement ticket 08, AC13): the enforcement
// contract at the receipts skill. FAIL direction: strip the enforced-shape
// section from the skill -> these red.
check('eval.mjs carries check 45 (receipt enforcement contract)', /---- 45\. /.test(evalSrc));
const receiptsSkill = readFileSync(join(HERE, '..', 'skills', 'discipline', 'receipts', 'SKILL.md'), 'utf8');
for (const [label, re] of [
  ['seam named', /receipt-enforcement\.mjs/],
  ['per-boolean stated', /each of the five booleans carrying its own evidence/],
  ['blanket rejected', /blanket "all five hold" is not a verdict/],
  ['allowlist named', /repo-gate allowlist/],
  ['fast receipt named', /fast one-line receipt/],
  ['window stated', /14 days|RECEIPT_STALE_DAYS/],
  ['re-verification stated', /re-verif/],
  ['veto named', /commit veto|veto denies/],
]) {
  check(`45 ${label} in the receipts skill`, re.test(receiptsSkill), String(re));
}

// Check 42 pins (findings-adaptation ticket 05, AC7): the bounded-judgment
// contract at the judgment site. FAIL direction: strip the judgment section
// from behavioral-eval/README.md → these red (proven by check 42's own RED
// run — 5 errors before the section landed).
check('eval.mjs carries check 42 (deterministic-first bounded judgment)', /---- 42\. /.test(evalSrc));
const bevalReadme = readFileSync(join(HERE, '..', 'scripts', 'behavioral-eval', 'README.md'), 'utf8');
for (const [label, re] of [
  ['seam named', /local-judge\.mjs/],
  ['deterministic-first stated', /deterministic graders first/i],
  ['judge-last stated', /last resort/i],
  ['no-API-key stated', /no API key|keyless/i],
  ['inconclusive fail-closed stated', /inconclusive/],
]) {
  check(`42 ${label} in behavioral-eval README`, re.test(bevalReadme), String(re));
}

// Check 43 pins (decision-composition ticket 05, AC17): the composition
// contract at the adopter doc. FAIL direction: strip the overlay section
// from docs/installation.md -> these red.
check('eval.mjs carries check 43 (overlay composition contract)', /---- 43\. /.test(evalSrc));
for (const [label, re] of [
  ['registry seam named', /overlay-registry\.mjs/],
  ['insert-before named', /insert-before/],
  ['insert-after named', /insert-after/],
  ['wrap named', /\bwrap\b/],
  ['user: prefix shown', /user:/],
  ['canonical-first stated', /canonical.{0,40}(first|complete)|first and complete/i],
  ['keyless stated', /keyless|no API key/i],
  ['fail-open stated', /fail-open/],
]) {
  check(`43 ${label} in installation.md overlay section`, re.test(install), String(re));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
