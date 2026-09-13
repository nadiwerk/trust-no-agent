#!/usr/bin/env node
/**
 * Scheduled update-check CLI — the executable wrapper (spec: docs/specs/scheduled-update-check.md).
 * Zero dependencies.
 *
 *   node scripts/update-check-cli.mjs [--projects-root DIR] [--upstream-url URL]
 *     Runs the check: fetch upstream CHANGELOG → build report → write log →
 *     notify per platform (silent when all-current or on failure).
 *
 *   node scripts/update-check-cli.mjs install [--projects-root DIR] [--upstream-url URL]
 *     Opt-in: registers the weekly Monday-09:00 task for this platform and prints
 *     what was registered. Human verifies the registration afterwards.
 *
 *   node scripts/update-check-cli.mjs uninstall
 *     Removes the registered task.
 *
 * Detection only: no command here ever installs skills, stamps versions, or
 * mutates any project (spec Constraint — Iron Law 4).
 */
import { resolveConfig, buildReport } from './update-check.mjs';
import { pickBackend, formatLog } from './update-delivery.mjs';
import { installPlan, uninstallPlan } from './update-install.mjs';
import { mkdirSync, appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--projects-root') args.projectsRoot = argv[++i];
    else if (argv[i] === '--upstream-url') args.upstreamUrl = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

function collectStamps(projectsRoot) {
  const stamps = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || (e.name.startsWith('.') && e.name !== '.trust')) continue;
      const p = join(dir, e.name);
      if (e.name === '.trust') continue;
      const stamp = join(p, '.trust', 'tna-version');
      try {
        stamps.push({ project: p, version: readFileSync(stamp, 'utf8').trim() });
      } catch {
        walk(p, depth + 1);
      }
    }
  };
  walk(projectsRoot, 0);
  return stamps;
}

async function runCheck({ projectsRoot, upstreamUrl }) {
  const config = resolveConfig({ projectsRoot, upstreamUrl });
  const logPath = join(here, '..', '.trust', 'update-check.log');

  // Trust boundary: the URL lands in shell-free fetch but must still be sane.
  if (upstreamUrl && !/^https:\/\//.test(upstreamUrl)) {
    console.error('refusing non-https upstream-url');
    process.exit(2);
  }

  let changelogText = null;
  let fetchError = null;
  try {
    const res = await fetch(config.upstreamUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Cap the body: a hostile URL must not OOM the scheduled run.
    const len = Number(res.headers.get('content-length') || 0);
    if (len > 2_000_000) throw new Error(`CHANGELOG too large (${len} bytes)`);
    const text = await res.text();
    changelogText = text.slice(0, 2_000_000);
  } catch (e) {
    fetchError = String(e.message || e);
  }

  const report = buildReport({ stamps: collectStamps(config.projectsRoot), upstreamVersion: null, changelogText, fetchError, extractUpstream: true });

  const ranAt = new Date().toISOString();
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, formatLog({ ranAt, ...report }) + '\n');

  const backend = pickBackend({ platform: process.platform, report });
  if (backend.mode === 'toast') notifyWindows(report);
  else if (backend.mode === 'native') notifyNative(report);
  // silent / log-only: nothing pops
  console.log(formatLog({ ranAt, ...report }));
}

function notifyWindows(report) {
  const title = 'trust-no-agent update tersedia';
  const body = report.lines.filter((l) => l.kind === 'stale').map((l) => l.text).join('; ');
  const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; ` +
    `$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); ` +
    `($t.SelectSingleNode('//text[@id="1"]')).InnerText = '${title}'; ` +
    `($t.SelectSingleNode('//text[@id="2"]')).InnerText = '${body.replace(/'/g, "''")}'; ` +
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show([Windows.UI.Notifications.ToastNotification]::new($t));`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 30000 });
  } catch (e) {
    appendFileSync(join(here, '..', '.trust', 'update-check.log'), `toast failed: ${String(e.message).slice(0, 200)}\n`);
  }
}

function notifyNative(report) {
  const body = report.lines.filter((l) => l.kind === 'stale').map((l) => l.text).join('; ').replace(/"/g, '');
  try {
    if (process.platform === 'darwin') execFileSync('osascript', ['-e', `display notification "${body}" with title "trust-no-agent update"`], { timeout: 15000 });
    else execFileSync('notify-send', ['trust-no-agent update', body], { timeout: 15000 });
  } catch {
    // degrade to log-only (spec AC 10) — the log write already happened
  }
}

function doInstall(args) {
  const plan = installPlan({ platform: process.platform, projectsRoot: args.projectsRoot, upstreamUrl: args.upstreamUrl });
  execFileSync(plan.register(plan.command)[0], plan.register(plan.command).slice(1), { stdio: 'inherit' });
  console.log(`registered: ${plan.taskName} (${plan.backend}, ${plan.schedule})`);
  console.log(`command: ${plan.command}`);
  console.log('HUMAN VERIFY: check your OS scheduler lists this task before relying on it.');
}

function doUninstall() {
  const plan = uninstallPlan({ platform: process.platform });
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', plan.removal], { stdio: 'inherit' });
  } else {
    execFileSync('bash', ['-c', plan.removal], { stdio: 'inherit' });
  }
  console.log(`removed: ${plan.taskName}`);
}

const args = parseArgs(process.argv.slice(2));
const mode = args._[0];
if (mode === 'install') doInstall(args);
else if (mode === 'uninstall') doUninstall();
else await runCheck(args);
