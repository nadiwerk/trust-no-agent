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
import { decideBeforeWith, logVeto, logVetoWith, observeAfterWith } from './tna-gate.mjs';
import { doneGateVerdict } from './done-gate.mjs';
import { buildFloorFromRouter, resolveRouterDir, FLOOR_KEY } from './reinjection.mjs';
import { delegateVerdict } from './delegation-gate.mjs';
import { makeStore } from './tna-store.mjs';

export default {
  id: 'tna-gate',

  async setup(ctx) {
    const directory = ctx.location?.directory ?? process.cwd();
    const store = makeStore({ fsDir: directory, storage: ctx.storage });

    const registration = await ctx.tool.hook('execute.before', async (input) => {
      const tool = String(input?.tool ?? '');
      const args = input?.input && typeof input.input === 'object' ? input.input : {};

      // Delegation gate (Gap 3, 2026-11-15): a delegation prompt without the
      // discipline block is a delegation without its guards — subagents never
      // read AGENTS.md, so the brief is the only path the rules reach them.
      // Deny by throwing (the proven opencode veto shape) and log it.
      const dv = delegateVerdict({ tool, args });
      if (!dv.allow) {
        await logVetoWith(store, {
          harness: 'opencode-v2-delegate',
          tool,
          command: String(args.description ?? ''),
        });
        throw new Error(`[tna-gate] ${dv.reason}`);
      }

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

    // Evidence recorder: the after-event carries { tool, input:{command},
    // result:{output:{exit}, metadata:{exit}} } (shape proven live
    // 2026-10-12). Only an explicit exit code records — an unknown outcome
    // touches nothing, and recording never throws (it must not break the
    // session it observes).
    const afterRegistration = await ctx.tool.hook('execute.after', async (event) => {
      try {
        const tool = String(event?.tool ?? '');
        const input = event?.input && typeof event.input === 'object' ? event.input : {};
        const exit = event?.result?.output?.exit ?? event?.result?.metadata?.exit;
        if (exit === undefined) return;
        await observeAfterWith(store, { tool, command: String(input.command ?? ''), pass: exit === 0 });
      } catch {
        /* recording never breaks the session */
      }
    });

    // Done-gate layer (ported from the canonical done-receipt-gate Stop hook,
    // 2026-11-15): opencode V2 has no Stop hook, so we flag on `session.idle`
    // from the server event stream. A closing turn whose prose asserts
    // completion (same CLAIM_PATTERNS as the canonical gate) with NO evidence
    // tool call in the same turn is recorded in the veto log — the router's
    // done-gate layer is "flagged", and flagging must never break the session
    // it observes (every failure here is silent, like the recorder above).

    const controller = new AbortController();
    const idleLoop = (async () => {
      try {
        // NOTE (measured live 2026-11-15): the service ignores `types` here —
        // subscribe({types:[...]}) yields an EMPTY stream silently, while the
        // proven-working workflow-delegation plugin subscribes WITHOUT types
        // and filters client-side. Subscribe bare; the event.type guard below
        // does the filtering.
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            // Trigger surface (measured live 2026-11-15): service 2.2.6 never
            // emits `session.idle` (docs vocabulary); the observable end-of-turn
            // event is `session.execution.succeeded`. Accept both — the
            // classifier is the same either way.
            if (event?.type !== 'session.idle' && event?.type !== 'session.execution.succeeded') continue;
            const sessionID = event?.data?.sessionID ?? event?.properties?.sessionID;
            if (!sessionID) continue;
            const messages = await ctx.session.context({ sessionID });
            const v = doneGateVerdict(messages ?? []);
            if (v.claim && !v.evidence) {
              const entry = {
                harness: 'opencode-v2-donegate',
                tool: 'session.idle',
                command: `[${sessionID}] ${v.claim}`,
              };
              await logVetoWith(store, entry);
              // FS mirror, best-effort: storage is the proven durable surface,
              // but no public API reads plugin storage — the FS copy is what
              // doctor/audit/orchestrator can verify from outside. The vanish
              // finding was proven on HOOK callbacks; the event loop's FS
              // access is unmeasured, so this write is attempted and its
              // failure is silent (storage remains the source of truth).
              try {
                logVeto(directory, entry);
              } catch {
                /* mirror failure never breaks the session */
              }
            }
          } catch (e) {
            /* flagging never breaks the session */
          }
        }
      } catch (e) {
        /* event stream unavailable or aborted — fail-open */
      }
    })();

    // Re-injection layer (Gap 1, 2026-11-15): after compaction the router
    // floor (Iron Laws + MANDATORY) falls out of context and ledger
    // compensation relies on agent initiative — proven to fail silently.
    // When `session.compaction.ended` fires, rebuild the floor from the live
    // project router (never from memory) and attach it as a keyed session
    // instruction ('tna-floor') — entries render into instructions at the
    // next step boundary WITHOUT queuing a message turn. Sessions never
    // compacted pay nothing. Every failure degrades silently: no router ->
    // no entry; a half router still emits a floor that names the missing half.
    const routerDir = resolveRouterDir(directory);
    const reinjectLoop = (async () => {
      try {
        // Same bare-subscribe contract as the idle loop above (measured 2026-11-15).
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            if (event?.type !== 'session.compaction.ended') continue; // guard: a stream that ignores the types filter
            const sessionID = event?.data?.sessionID ?? event?.properties?.sessionID;
            if (!sessionID) continue;
            const floor = buildFloorFromRouter(routerDir);
            if (!floor) continue;
            await ctx.session.instructions?.entry?.put?.({ sessionID, key: FLOOR_KEY, value: floor });
            // FS mirror of the attach (measured 2026-11-15: event-loop FS
            // writes persist; no public API reads instruction entries, so
            // this is the externally verifiable audit artifact).
            try {
              logVeto(directory, {
                harness: 'opencode-v2-reinject',
                tool: 'session.instructions.entry.put',
                command: `[${sessionID}] tna-floor (${floor.length} chars)`,
              });
            } catch {
              /* mirror failure never breaks the session */
            }
          } catch (e) {
            /* re-injection never breaks the session */
          }
        }
      } catch (e) {
        /* event stream unavailable or aborted — fail-open */
      }
    })();

    return () => {
      controller.abort();
      registration?.dispose?.();
      afterRegistration?.dispose?.();
      idleLoop?.catch?.(() => {});
      reinjectLoop?.catch?.(() => {});
    };
  },
};
