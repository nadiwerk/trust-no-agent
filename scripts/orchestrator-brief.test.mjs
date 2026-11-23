#!/usr/bin/env node
/* orchestrator-brief.test.mjs — fail-first contract for scripts/orchestrator-brief.mjs */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  validateBrief, validatePlan, buildBrief, normalizePlan,
  extractBriefs, validateAny, delegateVerdict, obligatedSkills,
} from './orchestrator-brief.mjs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name} :: ${extra}`); }
};
const codes = (r) => r.findings.map((f) => f.code);

// --- builder round-trip: the forcing function must satisfy its own gate ---
{
  const b = buildBrief({ id: 'A', scope: ['src/x/'], task: 'rename the helper', verify: 'node scripts/t.test.mjs' });
  const r = validateBrief(b);
  check('built brief passes the gate', r.ok, r.findings.map((f) => `${f.code}:${f.detail}`).join('; '));
}
{
  const b = buildBrief({ id: 'T', scope: ['src/'], task: 'write tests for the parser', outcome: 'red then green', verify: 'npx vitest run t/parser.test.ts' });
  const r = validateBrief(b);
  check('test brief loads expect-fail (derived Loading)', r.ok && b.prompt.includes('Loading: expect-fail'), b.prompt.split('\n')[0]);
}

// --- discipline block ---
{
  const r = validateBrief({ prompt: 'TASK: do x\nVERIFY: ls\nTIMEBOX: 5\nPARTIAL: stop\nScope: s/' });
  check('bare prompt fails on rules', codes(r).includes(BRIEF_CODES_RULES()), codes(r).join(','));
}
function BRIEF_CODES_RULES() { return 'brief-rules-missing'; }

// --- Loading: derived from the WORK, not the boilerplate ---
{
  const brief = buildBrief({ id: 'R', scope: ['src/'], task: 'read the auth module and report its exports', verify: 'list file:line citations', mode: 'read-only' });
  const r = validateBrief(brief);
  check('read brief demands no MANDATORY skill despite PARTIAL mentioning ERROR', r.ok, r.findings.join('; '));
}
{
  check('obligatedSkills reads task text', obligatedSkills('write tests for it').includes('expect-fail'));
  check('bug language routes to root-cause', obligatedSkills('fix the failing test').includes('root-cause'));
  check('pr work obligates pr-flow', obligatedSkills('merge the pull request once green').includes('pr-flow'));
}
{
  const b = buildBrief({ id: 'X', scope: ['s/'], task: 'write tests', verify: 'node t.mjs' });
  const r = validateBrief({ ...b, prompt: b.prompt.replace('Loading: expect-fail', 'Loading: receipts') });
  check('Loading mismatch flagged', codes(r).includes('brief-loading-mismatch'), codes(r).join(','));
}
{
  const r = validateBrief({ prompt: 'Repo rules: verified. No refactoring outside the requested scope. No touching files outside the allowed path list.\nTASK: x\nEXPECTED OUTCOME: y\nREQUIRED TOOLS: Read\nMUST DO: z\nMUST NOT DO: w\nCONTEXT: c\nVERIFY: ls\nTIMEBOX: 5\nPARTIAL: stop\nScope: s/' });
  check('no Loading line flagged', codes(r).includes('brief-loading-missing'), codes(r).join(','));
}

// --- window fields ---
{
  const good = buildBrief({ id: 'V', scope: ['s/'], task: 'x', verify: 'node v.mjs' }).prompt;
  const r = validateBrief({ prompt: good.replace(/VERIFY: .*/, 'VERIFY: (fill in)') });
  check('placeholder VERIFY flagged', codes(r).includes('brief-verify-not-command'));
  const r2 = validateBrief({ prompt: good.replace(/TIMEBOX: .*\n/, '') });
  check('missing TIMEBOX flagged', codes(r2).includes('brief-timebox-missing'));
  const r3 = validateBrief({ prompt: good.replace('TIMEBOX: 30', 'TIMEBOX: a while') });
  check('non-numeric TIMEBOX flagged', codes(r3).includes('brief-timebox-invalid'));
}

// --- forbidden work: directive lines only ---
{
  const bad = buildBrief({ id: 'D', scope: ['s/'], task: 'deploy the release to production', verify: 'curl -I app' });
  check('deploy directive flagged', codes(validateBrief(bad)).includes('brief-forbidden-work'));
  const ok = buildBrief({ id: 'N', scope: ['s/'], task: 'inspect the release pipeline', mustNotDo: 'deploy anything; merge this pr', verify: 'ls' });
  check('forbidden verbs inside MUST NOT DO are not directives', !codes(validateBrief(ok)).includes('brief-forbidden-work'), codes(validateBrief(ok)).join(','));
}

// --- scope ---
{
  const r = validateBrief({ prompt: 'Loading: none\nRepo rules: verified. No refactoring outside the requested scope. No touching files outside the allowed path list.\nTASK: x\nEXPECTED OUTCOME: y\nREQUIRED TOOLS: Read\nMUST DO: z\nMUST NOT DO: w\nCONTEXT: c\nVERIFY: ls\nTIMEBOX: 5\nPARTIAL: stop' });
  check('missing scope flagged', codes(r).includes('brief-scope-missing'));
  const r2 = validateBrief({ prompt: 'Loading: none\nRepo rules: verified. No refactoring outside the requested scope. No touching files outside the allowed path list.\nTASK: x\nEXPECTED OUTCOME: y\nREQUIRED TOOLS: Read\nMUST DO: z\nMUST NOT DO: w\nCONTEXT: c\nVERIFY: ls\nTIMEBOX: 5\nPARTIAL: stop\nScope: ../outside' });
  check('escaping scope flagged', codes(r2).includes('brief-scope-escapes'));
}

// --- read-only must not carry write tools ---
{
  const b = buildBrief({ id: 'RO', scope: ['s/'], task: 'inspect', mode: 'read-only', verify: 'file:line' });
  check('read-only builder passes', validateBrief(b).ok);
  const r = validateBrief({ prompt: b.prompt.replace('Read, Grep, Glob (read-only)', 'Read, Edit (read-only)') });
  check('read-only + Edit flagged', codes(r).includes('brief-readonly-write-tool'), codes(r).join(','));
}

// --- plans ---
{
  const a = buildBrief({ id: 'A', scope: ['src/a/'], task: 'x', verify: 'node a.mjs' });
  const b = buildBrief({ id: 'B', scope: ['src/b/'], task: 'y', verify: 'node b.mjs', dependsOn: ['A'] });
  check('valid plan passes', validatePlan({ assignments: [a, b] }).ok);
  const dup = validatePlan({ assignments: [a, { ...b, id: 'A' }] });
  check('duplicate id flagged', codes(dup).includes('plan-duplicate-id'));
  const ghost = validatePlan({ assignments: [a, { ...b, dependsOn: ['GHOST'] }] });
  check('unknown dep flagged', codes(ghost).includes('plan-unknown-dependency'));
  const cyc = validatePlan({ assignments: [{ ...a, depends_on: undefined, dependsOn: ['B'] }, b] });
  check('cycle flagged', codes(cyc).includes('plan-dependency-cycle'), codes(cyc).join(','));
  const many = Array.from({ length: 13 }, (_, i) => buildBrief({ id: `w${i}`, scope: [`s${i}/`], task: 'x', verify: 'ls' }));
  check('>12 assignments flagged', codes(validatePlan({ assignments: many })).includes('plan-too-many'));
  const wide = Array.from({ length: 5 }, (_, i) => buildBrief({ id: `w${i}`, scope: [`s${i}/`], task: 'x', verify: 'ls' }));
  check('wave >4 warns not errors', validatePlan({ assignments: wide }).ok && codes(validatePlan({ assignments: wide })).includes('plan-parallel-cap'));
}

// --- shape tolerance + extraction ---
{
  const n = normalizePlan({ tasks: [{ id: 'A', files: ['s/'], depends_on: ['B'] }] });
  check('tasks/files/depends_on spellings normalize', n.assignments[0].scope[0] === 's/' && n.assignments[0].dependsOn[0] === 'B');
  const ex = extractBriefs(`<tna_orchestration>{"tasks":[{"id":"A","files":["s/"],"prompt":"x"}]}</tna_orchestration>`);
  check('tna_orchestration tag extracts', ex?.assignments?.length === 1);
  check('validateAny on bare prompt text', validateAny('just do it').kind === 'brief');
}

// --- delegateVerdict ---
{
  check('non-delegation tool passes through', delegateVerdict({ tool: 'bash', args: {} }).allow);
  check('empty prompt denied', !delegateVerdict({ tool: 'task', args: { prompt: '  ' } }).allow);
  check('bare prompt denied with findings', !delegateVerdict({ tool: 'run_subagent', args: { task: 'just do it' } }).allow);
  const built = buildBrief({ id: 'A', scope: ['s/'], task: 'x', verify: 'node t.mjs' });
  check('built prompt allowed', delegateVerdict({ tool: 'task', args: { prompt: built.prompt } }).allow);
}

// --- CLI ---
const dir = mkdtempSync(join(tmpdir(), 'tna-obrief-'));
const S = join(process.cwd(), 'scripts', 'orchestrator-brief.mjs');
try {
  const bad = spawnSync(process.execPath, [S, '--text', 'just do it'], { encoding: 'utf8' });
  check('CLI --text malformed exit 1', bad.status === 1 && bad.stdout.includes('FAIL'), `status=${bad.status}`);
  const good = buildBrief({ id: 'A', scope: ['s/'], task: 'x', verify: 'node t.mjs' });
  const f = join(dir, 'b.md'); writeFileSync(f, good.prompt);
  const ok = spawnSync(process.execPath, [S, '--file', f], { encoding: 'utf8' });
  check('CLI --file valid exit 0', ok.status === 0 && ok.stdout.includes('PASS'), `status=${ok.status} out=${ok.stdout.slice(0, 80)}`);

  const denyPayload = JSON.stringify({ tool_name: 'task', tool_input: { prompt: 'just do it' } });
  const deny = spawnSync(process.execPath, [S, '--pretool'], { input: denyPayload, encoding: 'utf8' });
  const denyJson = (() => { try { return JSON.parse(deny.stdout); } catch { return null; } })();
  check('pretool bare delegation denied (documented shape, exit 0 + deny JSON)',
    deny.status === 0 && denyJson?.hookSpecificOutput?.permissionDecision === 'deny',
    `status=${deny.status} out=${deny.stdout.slice(0, 140)}`);
  const allowPayload = JSON.stringify({ tool_name: 'task', tool_input: { prompt: good.prompt } });
  const allow = spawnSync(process.execPath, [S, '--pretool'], { input: allowPayload, encoding: 'utf8' });
  check('pretool compliant delegation allowed exit 0', allow.status === 0);
  const other = spawnSync(process.execPath, [S, '--pretool'], { input: JSON.stringify({ tool_name: 'bash', tool_input: {} }), encoding: 'utf8' });
  check('pretool ignores non-delegation tool', other.status === 0);
  const junk = spawnSync(process.execPath, [S, '--pretool'], { input: 'not json', encoding: 'utf8' });
  check('pretool fail-open on junk stdin', junk.status === 0);
  const selfcheck = spawnSync(process.execPath, [S, '--tests'], { encoding: 'utf8' });
  check('--tests self-check passes', selfcheck.status === 0 && selfcheck.stdout.includes('PASS'), `status=${selfcheck.status}`);
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
