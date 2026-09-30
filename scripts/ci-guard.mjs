#!/usr/bin/env node
/**
 * A structural guard for .github/workflows/ci.yml — the artifact that went DARK
 * for two releases without any local gate noticing.
 *
 * The defect this exists to end (2026-09-30, ledger: "CI was dark for two
 * releases"): the step added in v0.1.25 carried TWO `run:` keys in one step
 * item. Two keys of the same name on one mapping node is invalid YAML, so GitHub
 * never BUILT the job — every run for v0.1.25 and v0.1.26 failed at 0s with
 * "failed because of a workflow file issue", and `gh run --log-failed` answered
 * "log not found" because no job existed to log. Meanwhile the pre-commit hook
 * ran 12 suites green, so every claim about "gates EXIT 0" was true about the
 * local proxy and misleading about the artifact the owner reads (the CI email).
 *
 * The lesson recorded in the ledger is not "be careful with YAML": it is that a
 * green local gate says nothing about a remote check that never started, and a
 * 0-second failure is the signature worth recognizing. So this guard checks the
 * workflow FILE where the damage is done, and it checks it structurally — with
 * no YAML dependency — so the pre-commit hook can run it on any machine.
 *
 * What is structurally true of a workflow GitHub can build, and checkable:
 *
 *   1. The file parses as YAML when a parser is genuinely reachable (M1) —
 *      probed by loading the module, not by asking whether the specifier
 *      resolves: `require('yaml')` resolves in some sandboxes where the module
 *      cannot be loaded, which would let M1 claim a verdict it never computed.
 *      A duplicated mapping key and tab indentation — the incident's shapes —
 *      are caught by the structural walk in either case.
 *   2. Structurally, in the step blocks: no step item repeats a key (M2), every
 *      step item has exactly one of `run:`/`uses:` (M3), and `jobs:` exists with
 *      at least one job that has at least one step (M4) — a workflow with no
 *      buildable job reports "success" while testing nothing.
 *   3. Every `run:` in this repo names a script that EXISTS (M5). A workflow
 *      whose step calls a renamed or deleted script fails remotely for a reason
 *      no local suite can see.
 *   4. No line is indented with a TAB (M6). YAML forbids tabs as indentation, so
 *      such a file is not parseable and GitHub does not build the job — the same
 *      class as the duplicated key, and the one member of that class the step
 *      walk cannot fail on by construction: a tab-indented step line still READS
 *      as a step line, so the shape has to be named explicitly. A tab inside a
 *      value is legal and is not reported.
 *
 * The structural walk deliberately stands alone rather than delegating to a
 * parser: a corrupt shape must be caught on a machine where no YAML package is
 * installed (this repo ships none, and the pre-commit hook runs everywhere).
 * M1 is the extra opinion when a parser is truly present; M5 resolves its
 * `run:` targets by path, with no parsing at all.
 *
 * Exit 0 = buildable shape; exit 1 = a workflow file that cannot run.
 *
 * Usage: node scripts/ci-guard.mjs [path]   (default: .github/workflows/ci.yml)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse `run: <script>` / `- run: <script>` commands into script paths to check. */
function scriptsRunIn(command) {
  // Only `node scripts/x.mjs` invocations are resolvable here; anything else is
  // treated as opaque (shell pipelines, `git clone …`, heredocs).
  const out = [];
  for (const m of command.matchAll(/\bnode\s+([^\s;&|]+\.mjs)/g)) out.push(m[1]);
  return out;
}

/**
 * @param {string} text workflow file contents
 * @param {{resolveScript?: (p: string) => string | null}} [opts] resolver for M5
 * @returns {{valid: boolean|null, errors: string[], stats: {jobs: number, steps: {job: string, name: string}[], scriptRefs: string[]}}}
 */
export async function checkWorkflow(text, opts = {}) {
  const errors = [];
  const lines = text.split(/\r?\n/);
  const resolveScript = opts.resolveScript ?? ((p) => (existsSync(resolve(ROOT, p)) ? null : p));

  // ---- M1: does a YAML parser reach us at all, and does the file parse? ----
  // One reachable parser is MEASURED against the file, not trusted by name: a
  // bare `require('yaml')` can resolve in a sandbox where the module cannot
  // actually load (seen 2026-09-30), so the module is imported and its `parse`
  // called before its verdict is believed. When no parser answers, `valid`
  // stays `null` and the structural walk below is the verdict.
  let valid = null;
  let parserNote = 'no YAML parser reachable';
  // Shapes that make the file unparseable on their own, caught without a parser.
  // Declared before the parser probe: M6 (below, and the duplicate-key walk)
  // both write it, and a `let` read before its declaration is a TDZ crash, not a
  // default (this cost one RED run, 2026-09-30).
  let unparseableShape = false;
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    for (const name of ['yaml', 'js-yaml']) {
      try {
        const mod = req(name);
        if (typeof mod.parse !== 'function') continue;
        const parsed = mod.parse(text);
        valid = parsed != null && typeof parsed === 'object';
        parserNote = name;
        break;
      } catch {
        /* try the next parser */
      }
    }
  } catch {
    /* no module system here — the structural walk stands alone */
  }

  // ---- M6: YAML forbids tabs as indentation ----
  // This is the shape the walk below cannot catch by construction: a line
  // indented with a tab (or with spaces followed by a tab) still PARSES as a
  // mapping key for a reader that trims, so every other check here stays quiet
  // while YAML rejects the file and GitHub refuses to build the job. Named
  // explicitly because a check that never examines a shape cannot fail on it.
  // A tab inside a value is legal, so only indentation counts: the tab must
  // appear before the line's first non-space character.
  for (let i = 0; i < lines.length; i++) {
    const lead = lines[i].match(/^[ \t]*/)[0];
    if (lead.includes('\t')) {
      unparseableShape = true;
      errors.push(
        `line ${i + 1} is indented with a TAB — YAML forbids tabs as indentation, so GitHub will not build the job (same class as the duplicated \`run:\` key: no job log exists to read)`,
      );
    }
  }

  // ---- M2/M3: hand-rolled step-block walk, parser-free ----
  // A step item is a `- key:` line inside a `steps:` block whose indentation is
  // deeper than the `steps:` key. Keys of that item are the block's own-role
  // lines indented one level deeper than the dash.
  const jobs = [];
  const stepItems = []; // { job, name, keys: [{key, line}], indent }
  let structuralDuplicate = false;
  let currentJob = null;
  let inSteps = false;
  let stepsIndent = -1;
  let jobsIndent = -1;
  let currentItem = null;
  // `steps: []` — a job whose step list is explicitly empty. The block walk has
  // no lines to read, so the shape is recorded here and judged below.
  const emptyStepJobs = new Set();
  let sawJobsKey = false;

  const flushItem = () => {
    if (currentItem) stepItems.push(currentItem);
    currentItem = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    // Job headings sit directly under `jobs:` (two-space indent, no dash). Two
    // guards keep the trigger narrow, because the first version matched `push:`
    // and `pull_request:` under the `on:` trigger and invented two jobs:
    //   (a) nothing is a job heading before the `jobs:` key appears;
    //   (b) the indentation baseline comes from THAT key's own column, so an
    //       `on:` body indented two spaces can never be read as jobs.
    // (2026-09-30, the guard's own bug hunt — twice: the earlier version also
    // gave every step `job: undefined` by letting the step walk at indent 2 eat
    // the heading line.)
    if (/^jobs:\s*$/.test(trimmed)) {
      sawJobsKey = true;
      jobsIndent = indent;
      inSteps = false;
      flushItem();
      continue;
    }
    const atJobsIndent = sawJobsKey && jobsIndent !== -1 && indent === jobsIndent + 2;

    if (atJobsIndent && /^([A-Za-z0-9_-]+):\s*$/.test(trimmed)) {
      flushItem();
      inSteps = false;
      currentJob = trimmed.slice(0, -1);
      jobs.push(currentJob);
      continue;
    }

    // `steps:` with a value on the same line (`steps: []`) — an explicit empty
    // step list. Still enters the block so the job counts as having one.
    const stepsInline = /^steps:\s*(\S.*)$/.exec(trimmed);
    if (stepsInline) {
      inSteps = true;
      stepsIndent = indent;
      flushItem();
      if (/^\[\s*\]$/.test(stepsInline[1].trim())) emptyStepJobs.add(currentJob);
      continue;
    }

    if (/^steps:\s*$/.test(trimmed)) {
      inSteps = true;
      stepsIndent = indent;
      flushItem();
      continue;
    }
    // any key at or above the steps indent that is not a step line ends the block
    if (inSteps && indent <= stepsIndent) {
      inSteps = false;
      flushItem();
    }

    if (!inSteps) continue;

    const itemStart = /^-\s*(.*)$/.exec(trimmed);
    if (itemStart && indent === stepsIndent + 2) {
      flushItem();
      currentItem = { job: currentJob, name: '', keys: [], indent: indent + 2, line: lineNo };
      const rest = itemStart[1].trim();
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rest);
      if (kv) {
        currentItem.keys.push({ key: kv[1], line: lineNo });
        if (kv[1] === 'name') currentItem.name = kv[2].trim().replace(/^["']|["']$/g, '');
      } else if (rest && !rest.startsWith('#')) {
        currentItem.name = rest;
      }
      continue;
    }
    if (!currentItem) continue;
    // a continuation/heredoc body line may be deeper than the item keys
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (kv && indent === currentItem.indent) {
      currentItem.keys.push({ key: kv[1], line: lineNo });
      if (kv[1] === 'name' && !currentItem.name) currentItem.name = kv[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  flushItem();

  for (const item of stepItems) {
    const seen = new Map();
    for (const { key, line } of item.keys) {
      if (seen.has(key)) {
        structuralDuplicate = true;
        unparseableShape = true;
        errors.push(
          `duplicate key \`${key}:\` in the step at line ${line} (job \`${item.job}\`) — a duplicated key is invalid YAML and GitHub will not build the job at all (the 2026-09-30 incident, twice)`,
        );
      } else seen.set(key, line);
    }
    const hasRun = seen.has('run');
    const hasUses = seen.has('uses');
    if (!hasRun && !hasUses)
      errors.push(
        `step at line ${item.line} (job \`${item.job}\`) has neither \`run:\` nor \`uses:\` — a step that runs nothing`,
      );
    if (hasRun && hasUses)
      errors.push(
        `step at line ${item.line} (job \`${item.job}\`) has BOTH \`uses:\` and \`run:\` — GitHub's schema accepts only one`,
      );
  }

  if (!jobs.length) errors.push('no `jobs:` mapping found — a workflow with no job can never fail, so it reports success while testing nothing');
  for (const job of jobs) {
    if (!stepItems.some((s) => s.job === job) && !emptyStepJobs.has(job))
      errors.push(`job \`${job}\` has no steps — a job that runs nothing`);
  }
  for (const job of emptyStepJobs)
    errors.push(`job \`${job}\` has an empty \`steps: []\` list — a job that runs nothing (and cannot fail anything)`);

  // ---- M5: every `node scripts/…` a step invokes must exist ----
  const scriptRefs = [];
  for (const item of stepItems) {
    const runLine = item.keys.find((k) => k.key === 'run');
    if (!runLine) continue;
    // A step's `run:` may be a block scalar; walk forward to the next step key.
    const start = runLine.line;
    const body = [lines[start - 1].replace(/^\s*[-\s]*run:\s*/, '')];
    for (let i = start; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) break;
      const ind = l.length - l.trimStart().length;
      if (ind < item.indent + 2) break;
      body.push(l);
    }
    for (const ref of scriptsRunIn(body.join('\n'))) {
      scriptRefs.push(ref);
      const missing = resolveScript(ref);
      if (missing)
        errors.push(`step at line ${start} (job \`${item.job}\`) runs \`${missing}\`, which does not exist — the remote job would fail for a reason no local suite sees`);
    }
  }

  // The parser's verdict was absent; the structural walk is the verdict. Any
  // shape a YAML reader would reject (a duplicated key, a step that runs
  // nothing, a job-less workflow) is reported as `valid: false` — never left at
  // `null` while errors exist, which is how a reader of this function gets told
  // "not checked" about a file that is known broken.
  if (valid === null && errors.length) valid = false;

  // A parser that loaded without throwing has already accepted the file; these
  // shapes can survive structural reading and still be unbuildable, so the walk
  // keeps its veto in that case too.
  return {
    valid: unparseableShape ? false : valid,
    errors,
    stats: { jobs: jobs.length, steps: stepItems.map((s) => ({ job: s.job, name: s.name })), scriptRefs, parser: parserNote },
  };
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = resolve(ROOT, process.argv[2] ?? '.github/workflows/ci.yml');
  if (!existsSync(target)) {
    console.error(`FAIL: ${target} does not exist`);
    process.exit(1);
  }
  const { valid, errors, stats } = await checkWorkflow(readFileSync(target, 'utf8'));
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ci: ${e}`);
    console.error(
      `\nFAIL: ${errors.length} workflow structural error(s) — ${stats.jobs} job(s), ${stats.steps.length} step(s)`,
    );
    process.exit(1);
  }
  if (valid === false) {
    console.error('FAIL: the workflow file is not valid YAML — GitHub would not build any job');
    process.exit(1);
  }
  console.log(
    `OK: workflow buildable (${stats.jobs} job(s), ${stats.steps.length} step(s), ${stats.scriptRefs.length} script reference(s) resolved; YAML: ${stats.parser})`,
  );
  process.exit(0);
}
