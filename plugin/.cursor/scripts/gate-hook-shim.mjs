#!/usr/bin/env node
/**
 * Cursor adapter shim - routes Cursor hook events to the shared gate-hook
 * brain (plugin/scripts/gate-hook.mjs), the same veto classifier Claude Code
 * and Codex use. One brain, many adapters (the adapter-matrix principle).
 *
 * Cursor hook contract (cursor.com/docs/hooks, 2026-10):
 *  - stdin carries the event JSON
 *  - exit 0 = allow (stdout JSON optional)
 *  - exit 2 = BLOCK the action (beforeShellExecution) / deny (preToolUse)
 *  - the shared brain's deny shape (exit 2) maps 1:1
 *
 * Thin shim by design: no discipline logic here - classifyAction + state
 * live in gate-hook.mjs. This file only maps Cursor's event names onto the
 * shared stdin contract.
 */
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN = join(HERE, 'gate-hook.mjs');

// Read the Cursor event from stdin, then exec the shared brain with the
// stdin forwarded (gate-hook.mjs parses the same JSON shape: tool/args).
const chunks = [];
const rl = createInterface({ input: process.stdin });
rl.on('line', (l) => chunks.push(l));
rl.on('close', async () => {
  let event = {};
  try { event = JSON.parse(chunks.join('\n') || '{}'); } catch { /* fail-open on unparseable stdin */ }

  // Map Cursor event names onto the shared brain's expectation.
  // beforeShellExecution carries { command }; sessionStart/preCompact carry
  // no command - the brain's floor-injection path reads the prompt hook
  // shape, so we pass a minimal envelope and let the brain decide.
  const payload = JSON.stringify({
    tool: 'bash',
    event: 'cursor:' + (event.hook_event_name ?? 'unknown'),
    command: String(event.command ?? ''),
    ...event,
  });

  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [BRAIN], { input: payload, encoding: 'utf8', timeout: 15000 });
  const out = String(r.stdout ?? '');
  // The brain denies with exit 2 + a reason on stdout - Cursor blocks on
  // exit 2 too, so forward the code and the reason verbatim.
  if (r.status === 2) {
    process.stdout.write(out);
    process.exit(2);
  }
  // allow: exit 0 silent (Cursor contract)
  process.exit(0);
});
