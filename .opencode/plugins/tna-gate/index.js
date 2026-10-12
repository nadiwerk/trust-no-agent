/**
 * trust-no-agent gate for opencode V2 — veto irreversible tool calls without
 * fresh test evidence (spec: docs/specs/hardening-general.md, AC1; ported to
 * the V2 API in ticket 08, storage-backed after the live FS-write finding).
 *
 * V2 directory plugin (autoloaded from `.opencode/plugins/`): export default
 * `{ id, setup }`, hook via `ctx.tool.hook("execute.before", (input) => …)`
 * receiving ONE argument `{ tool, input }` (per the official V2 migration
 * guide + the live workflow-delegation plugin on this machine). Deny is by
 * throwing — proven live on opencode v2.0.27 (probe-4/5/6 denied, 2026-10-12).
 *
 * Evidence lives in `ctx.storage` (the only durable write a V2 hook has —
 * hook FS-writes vanish live, proven by the probe that wrote directly and
 * left no file). The project's `.trust/` FS copy is READ as the preferred
 * source (doctor + audit read the FS) but NEVER written from the hook.
 *
 * Thin adapter by design: the boundary is decideBefore's core
 * (scripts/tna-gate.mjs over ticket 01's action-gate); this file only maps
 * the V2 event shape + storage seam onto it — no discipline logic here.
 * Fail-closed is irreversible-only.
 */
import { decideBeforeWith, logVetoWith } from '../../../scripts/tna-gate.mjs';
import { makeStore } from '../../../scripts/tna-store.mjs';

export default {
  id: 'tna-gate',

  async setup(ctx) {
    const directory = ctx.location?.directory ?? process.cwd();
    const store = makeStore({ fsDir: directory, storage: ctx.storage });

    const registration = await ctx.tool.hook('execute.before', async (input) => {
      const tool = String(input?.tool ?? '');
      const args = input?.input && typeof input.input === 'object' ? input.input : {};
      const v = await decideBeforeWith(store, { tool, args });
      if (!v.allow) {
        await logVetoWith(store, {
          harness: 'opencode-v2',
          tool,
          command: String(args.command ?? ''),
        });
        throw new Error(`[tna-gate] ${v.reason}`);
      }
    });

    return () => {
      registration?.dispose?.();
    };
  },
};
