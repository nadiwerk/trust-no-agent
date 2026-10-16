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

// Aggregate-report gate + labeled-claims pins (Adaptation wave 1).\nfor (const [label, re] of [\n  ['aggregate gate present', /Aggregate-report gate/],\n  ['gap-never-pass stated', /gap in the report never counts as a pass/],\n]) {\n  check(\AG \ in AGENTS.md\, re.test(agentsText2), String(re));\n}\n{\n  const rs46 = readFileSync(join(HERE, '..', 'skills', 'discipline', 'receipts', 'SKILL.md'), 'utf8');\n  const cr = readFileSync(join(HERE, '..', 'docs', 'chat-receipt.md'), 'utf8');\n  check('LC labeled-claims in receipts skill', /## Labeled claims/.test(rs46), 'missing');\n  check('LC labeled-claims in chat-receipt', /Labeled claims/.test(cr) && /measured \\/ inferred \\/ guess/.test(cr), 'missing');\n}\n\n// Check 44 pins (onboarding ticket 10, AC15): the onboarding contract at
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

// INCONCLUSIVE verdict pins (Adaptation wave 1): verification that proved nothing is never a pass.\n{\n  const rs45 = readFileSync(join(HERE, '..', 'skills', 'discipline', 'receipts', 'SKILL.md'), 'utf8');\n  check('45a INCONCLUSIVE verdict section present', /## The INCONCLUSIVE verdict/.test(rs45), 'missing');\n  check('45a never-a-pass stated', /never a pass/.test(rs45), 'missing');\n}\n\n// Check 46 pins (setup-command ticket 04; setup-as-skill ticket 01 moved the
// procedure into the skill body). FAIL direction: remove the command file or
// the skill, or strip a marker -> these red.
check('eval.mjs carries check 46 (/setup-tna chat front door)', /---- 46\. /.test(evalSrc));
const cmdFile46 = readFileSync(join(HERE, '..', '.opencode', 'command', 'setup-tna.md'), 'utf8');
for (const [label, re] of [
  ['wrapper named', /thin wrapper/i],
  ['routes to skill', /setup-tna skill/],
  ['no-direct-write guard surfaced', /NEVER[^.]*\.trust\//i],
]) {
  check(`46 ${label} in the command wrapper`, re.test(cmdFile46), String(re));
}
const skillBody46 = readFileSync(join(HERE, '..', 'skills', 'meta', 'setup-tna', 'SKILL.md'), 'utf8');
for (const [label, re] of [
  ['from-chat named', /--from-chat/],
  ['no-direct-write guard', /NEVER write[^.]*\.trust\//i],
  ['no-yes-without-answers guard', /NEVER run `--yes`|never run `--yes`/i],
  ['degrade path stated', /Degrade path|degrade path/],
  ['doctor(-lite) final proof', /doctor\.mjs|doctor-lite/],
  ['byte-identical copy demanded', /byte-identical/i],
  ['opencode veto-copy branch', /harness is OpenCode|harness === 'opencode'|OpenCode tree/i],
  ['claude/codex verify-not-rewire branch', /already ships the veto|not re-wire|don't re-wire|don.t re-wire/i],
  ['honest audit-only branch', /audit-only/i],
  ['doctor-lite veto check', /veto plugin is present|veto-plugin-present/i],
  ['forwarded-answers boundary', /Forwarded[\s\S]{0,20}answers are the human.s, verbatim[\s\S]{0,60}never edits, fills, or[\s\S]{0,10}confirms/i],
]) {
  check(`46 ${label} in the setup-tna skill body`, re.test(skillBody46), String(re));
}

// Engagement-criteria pins (Adaptation wave 1): the chain engages by count, never mood.\nfor (const [label, re] of [\n  ['engagement criteria section present', /Engagement criteria \(mechanical, not felt\)/],\n  ['engagement named as count', /more than one file/],\n  ['not-a-mood guard', /never a mood/],\n]) {\n  check(6-ENG \ in AGENTS.md, re.test(agentsText2), String(re));\n}\n\n// Blind reviewers + enforcement ladder pins (Adaptation wave 2).
const roastSkill = readFileSync(join(HERE, '..', 'skills', 'engineering', 'roast-my-code', 'SKILL.md'), 'utf8');
check('45c blind reviewers in roast-my-code', /Blind reviewers \(never leak the parent's verdict\)/.test(roastSkill), 'missing');
check('45c inputs-not-conclusions stated', /inputs to verify[\s\S]{0,20}not the[\s\S]{0,20}conclusions drawn/.test(roastSkill), 'missing');
const ruleInhW2 = readFileSync(join(HERE, '..', 'docs', 'rule-inheritance.md'), 'utf8');
check('45c enforcement ladder present', /## The enforcement ladder/.test(ruleInhW2), 'missing');
check('45c no-enforcer rule stated', /a rule with no enforcer is itself a\s+repeat failure/.test(ruleInhW2), 'missing');
check('45c proven-to-fail stated', /proven to fail\s+on a real past mistake/.test(ruleInhW2), 'missing');

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
