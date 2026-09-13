#!/usr/bin/env node
/**
 * Scheduled update-check installer decisions — pure functions, zero dependencies.
 * Spec: docs/specs/scheduled-update-check.md. Test: scripts/update-install.test.mjs
 * The CLI wrapper (update-check-cli.mjs) executes the plan; this module only decides.
 */

const TASK_NAME = 'trust-no-agent update-check';
const UPDATE_CHECK_URL = import.meta.url; // …/scripts/update-install.mjs

/** Plain filesystem path of the CLI — `node file:///…` breaks on Windows cmd/PS. */
function cliPath() {
  return new URL('./update-check-cli.mjs', UPDATE_CHECK_URL).pathname.replace(/^\/([A-Za-z]:)/, '$1');
}

/** Reject config values that could break quoting or inject cron/PS lines.
 * Backslash is legal in Windows paths — the dangerous characters are the
 * ones that terminate or commandeer a quoted string: quotes, backtick,
 * command substitution, separators, redirection, and newlines. */
function validateConfigValue(kind, value) {
  if (/[\n\r"'`$;&|<>]/.test(value)) {
    throw new Error(`${kind} contains a character unsafe for scheduler registration: ${JSON.stringify(value.slice(0, 40))}`);
  }
  if (kind === 'upstreamUrl' && !/^https:\/\//.test(value)) {
    throw new Error('upstreamUrl must be an https:// URL');
  }
  return value;
}

/** The CLI path, quoted for shell use (paths with spaces must survive). */
function cliCommand(configArgs) {
  const cli = cliPath();
  return `node "${cli}" ${configArgs}`;
}

/**
 * The full registration plan for one platform (spec AC 1, 11).
 * The command pins the config so the registered task needs no env: overrides are
 * accepted here once, at opt-in time.
 */
export function installPlan({ platform, projectsRoot, upstreamUrl } = {}) {
  const root = validateConfigValue('projectsRoot', projectsRoot || defaultProjectsRoot());
  const url = validateConfigValue('upstreamUrl', upstreamUrl || 'https://raw.githubusercontent.com/nadiwerk/trust-no-agent/master/CHANGELOG.md');
  const configArgs = `--projects-root "${root}" --upstream-url "${url}"`;
  const command = cliCommand(configArgs);

  switch (platform) {
    case 'win32':
      return {
        backend: 'schtasks',
        taskName: TASK_NAME,
        schedule: 'weekly MON 09:00',
        command,
        // Register via Register-ScheduledTask: the Action carries the command
        // as its own Execute/Arguments pair, so no nested quote escaping is needed.
        register: () => [
          'powershell', '-NoProfile', '-Command',
          `Register-ScheduledTask -TaskName '${TASK_NAME}' ` +
          `-Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -Command \"node \\\"${cliPath()}\\\" --projects-root \\\"${root}\\\" --upstream-url \\\"${url}\\\"\"') ` +
          `-Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 09:00) ` +
          `-Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)`,
        ],
      };
    case 'darwin':
      return {
        backend: 'launchd',
        taskName: TASK_NAME,
        schedule: 'weekly Monday 09:00 (StartCalendarInterval Weekday=1 Hour=9 Minute=0)',
        command,
        register: (cmd) => [
          'bash', '-c',
          `mkdir -p ~/Library/LaunchAgents && cat > ~/Library/LaunchAgents/com.trust-no-agent.update-check.plist <<EOF\n` +
          `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
          `<plist version="1.0"><dict>\n  <key>Label</key><string>com.trust-no-agent.update-check</string>\n` +
          `  <key>ProgramArguments</key><array>\n    <string>node</string><string>${cliPath()}</string>\n` +
          `    <string>--projects-root</string><string>${root}</string>\n    <string>--upstream-url</string><string>${url}</string>\n  </array>\n` +
          `  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>\n` +
          `</dict></plist>\nEOF\nlaunchctl load ~/Library/LaunchAgents/com.trust-no-agent.update-check.plist`,
        ],
      };
    case 'linux':
      return {
        backend: 'cron',
        taskName: TASK_NAME,
        schedule: 'cron 0 9 * * 1',
        command,
        register: (cmd) => [
          'bash', '-c',
          `(crontab -l 2>/dev/null | grep -v 'trust-no-agent update-check' ; echo "0 9 * * 1 ${cmd}") | crontab -`,
        ],
      };
    default:
      throw new Error(`no scheduler backend for platform: ${platform}`);
  }
}

/** Removal plan mirroring installPlan's task name (spec AC 8). */
export function uninstallPlan({ platform } = {}) {
  switch (platform) {
    case 'win32':
      return {
        taskName: TASK_NAME,
        removal: `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false`,
      };
    case 'darwin':
      return {
        taskName: TASK_NAME,
        removal: `launchctl unload ~/Library/LaunchAgents/com.trust-no-agent.update-check.plist && rm -f ~/Library/LaunchAgents/com.trust-no-agent.update-check.plist`,
      };
    case 'linux':
      return {
        taskName: TASK_NAME,
        // Match the exact registered marker, not the script name, so unrelated
        // cron entries that merely mention the script are not deleted.
        removal: `crontab -l 2>/dev/null | grep -v 'trust-no-agent update-check' | crontab -`,
      };
    default:
      throw new Error(`no scheduler backend for platform: ${platform}`);
  }
}

function defaultProjectsRoot() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home.replace(/[\\/]+$/, '')}/projects`;
}
