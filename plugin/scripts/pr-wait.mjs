#!/usr/bin/env node
/**
 * pr-wait.mjs — one tested watcher for PR state, replacing ad-hoc polling loops.
 * Pure Node, zero dependencies; talks to GitHub through the `gh` CLI only
 * (never through `jq` or a parser the host may not have — measured adopter
 * incident: a monitor written around `jq` died silently for 30 minutes while
 * the checks it watched failed; another read an empty check list as "all
 * green" because zero registered checks is NOT a completed rollup).
 *
 * The watcher is a gate too (receipts skill, Delivery claims): a polling loop
 * that can end without emitting reports success over a check that never ran.
 * Every non-terminal state here keeps polling until a DECLARED terminal event
 * or the timeout — silence is never a verdict.
 *
 * CLI contract (the public seam; see pr-wait.test.mjs):
 *   node scripts/pr-wait.mjs <pr-number-or-url>
 *     [--repo owner/name]   forwarded to gh; defaults to the cwd's repo
 *     [--until green|any-change]   green = wait for green/terminal (default);
 *                                  any-change = exit on the first observed
 *                                  non-initial state
 *     [--interval N]        seconds between polls (default 30)
 *     [--timeout N]         seconds before giving up (default 3600)
 *     [--once]              one poll, report, exit (probing, tests)
 *
 *   exit 0  green: all checks complete and passing (>=1 check), or PR merged
 *   exit 1  red: a check failed/cancelled, PR closed, merge conflict, timeout
 *   exit 2  bad input, or `gh` missing / not authenticated / erroring
 *   exit 3  still pending (--once only — pending is not failure)
 *
 * Emits one `pr-wait: <event> — <detail>` line per real state transition; a
 * terminal line is always the last output. Redirect to a file to monitor.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GH = process.env.PR_WAIT_GH || 'gh';
const GH_PREFIX = (process.env.PR_WAIT_GH_PREFIX || '').split(' ').filter(Boolean);

const gh = (args) => {
  try {
    return execFileSync(GH, [...GH_PREFIX, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = new Error(`gh invocation failed: ${e.message}`);
    err.cause = e;
    throw err;
  }
};

const repoArgs = (repo) => (repo ? ['--repo', repo] : []);

/** gh pr checks → {list, status}: 'green' | 'failed' | 'pending' | 'no-checks' */
export function classifyChecks(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) return { list, status: 'no-checks', failed: [], pending: [] };
  const failed = list.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel');
  const pending = list.filter((c) => !['pass', 'fail', 'cancel', 'skipping'].includes(c.bucket));
  if (failed.length) return { list, status: 'failed', failed, pending };
  if (pending.length) return { list, status: 'pending', failed, pending };
  return { list, status: 'green', failed, pending };
}

/**
 * One observed sample → terminal verdict or null (keep waiting).
 * `until` is 'green' or 'any-change'; under any-change every non-initial
 * sample terminates so a caller monitoring a stack of PRs learns early.
 */
export function verdictFor({ prState, mergeable, checks, until }) {
  if (prState === 'MERGED') return { event: 'merged', exit: 0, detail: 'PR merged' };
  if (prState === 'CLOSED') return { event: 'closed', exit: 1, detail: 'PR closed unmerged' };
  if (mergeable === 'CONFLICTING') return { event: 'conflict', exit: 1, detail: 'PR has merge conflicts' };
  const c = classifyChecks(checks);
  if (c.status === 'failed')
    return { event: 'checks-failed', exit: 1, detail: `failed: ${c.failed.map((x) => x.name || x.check).join(', ') || 'unnamed check'}` };
  if (c.status === 'green')
    return { event: 'checks-green', exit: 0, detail: `${c.list.length} check(s) green` };
  if (until === 'any-change' && c.list.length)
    return { event: 'checks-observed', exit: 0, detail: `${c.list.length} check(s) registered, ${c.pending.length} pending` };
  return null; // pending or no-checks — keep waiting; silence is not a verdict
}

function parseArgs(argv) {
  const a = { pr: null, repo: null, until: 'green', interval: 30, timeout: 3600, once: false };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--repo') a.repo = argv[++i];
    else if (s === '--until') a.until = argv[++i];
    else if (s === '--interval') a.interval = Number(argv[++i]);
    else if (s === '--timeout') a.timeout = Number(argv[++i]);
    else if (s === '--once') a.once = true;
    else if (!s.startsWith('--') && !a.pr) a.pr = s;
    else return { error: `unknown argument: ${s}` };
  }
  if (!a.pr) return { error: 'usage: pr-wait.mjs <pr-number-or-url> [--repo owner/name] [--until green|any-change] [--interval N] [--timeout N] [--once]' };
  if (!['green', 'any-change'].includes(a.until)) return { error: `--until must be green|any-change, got ${a.until}` };
  if (!(a.interval > 0) || !(a.timeout > 0)) return { error: '--interval and --timeout must be positive seconds' };
  return a;
}

const emit = (event, detail) => console.log(`pr-wait: ${event}${detail ? ` — ${detail}` : ''}`);

function sample(a) {
  const view = JSON.parse(gh(['pr', 'view', String(a.pr), ...repoArgs(a.repo), '--json', 'state,mergeable']));
  const checks = JSON.parse(gh(['pr', 'checks', String(a.pr), ...repoArgs(a.repo), '--json', 'name,state,bucket']));
  return { prState: view.state, mergeable: view.mergeable, checks, until: a.until };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.error) {
    console.error(`pr-wait: ${a.error}`);
    process.exit(2);
  }
  const deadline = Date.now() + a.timeout * 1000;
  let lastKey = '';
  const poll = () => {
    let s;
    try {
      s = sample(a);
    } catch (e) {
      emit('error', e.message.split('\n')[0]);
      process.exit(2);
    }
    const v = verdictFor(s);
    const c = classifyChecks(s.checks);
    const key = `${s.prState}|${s.mergeable}|${c.status}|${c.list.length}`;
    if (v) {
      emit(v.event, v.detail);
      process.exit(v.exit);
    }
    if (key !== lastKey) {
      lastKey = key;
      emit(c.status === 'no-checks' ? 'no-checks' : 'pending',
        c.status === 'no-checks' ? '0 checks registered — not-started, not done' : `${c.pending.length}/${c.list.length} check(s) pending`);
    }
    if (a.once) process.exit(3);
    if (Date.now() >= deadline) {
      emit('timeout', `no terminal state within ${a.timeout}s — still ${c.status}`);
      process.exit(1);
    }
    setTimeout(poll, a.interval * 1000);
  };
  poll();
}

// Run only as a CLI; importing this module exports the pure verdict logic for tests.
try {
  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
} catch {
  main();
}
