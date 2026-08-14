/**
 * pi-Recap — entry point.
 *
 * Design:
 *   1. (familiar)  On each new tool result in context, run an LLM call that
 *                  shares the main agent's full context (same main model) and
 *                  summarizes that one tool result into 1–3 lines.
 *   2. (compress)  Once a tool result is `swapTurnThreshold` turns old, its raw
 *                  content is removed from future context and a compact recap
 *                  note is injected in its place. The original is kept in the
 *                  session index and recoverable via `recap_recover`.
 *
 * Implementation note: pi's `context` event honors message REMOVAL but NOT
 * content mutation of tool-result messages, so a true in-place "swap" is not
 * possible. We follow the proven pi-context-prune pattern: filter the raw
 * toolResult out and inject the recap as a separate context message.
 *
 * Eligibility note: only tool results that appear WHILE Recap is enabled are
 * ever recapped. A `seen` set tracks every toolCallId observed in context
 * (even while disabled), so turning Recap on after a long disabled stretch
 * never triggers a parallel recap of the entire prior history — which would
 * otherwise fan out one full-context LLM call per old result.
 *
 * Usage:  pi -e .   then   /Recap on
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { RecapIndex, collectNewRecappables } from "./src/recap.js";
import { selectRemovable } from "./src/swap.js";
import { registerCommands } from "./src/commands.js";
import { registerRecoverTool } from "./src/recovery.js";
import { CUSTOM_TYPE_RECAP, CUSTOM_TYPE_RECAP_MSG, DEFAULT_CONFIG, type RecapConfig, type RecapRecord, type StableCtx } from "./src/types.js";

export default function (pi: ExtensionAPI) {
  const currentConfig: { value: RecapConfig } = { value: { ...DEFAULT_CONFIG } };
  const index = new RecapIndex();
  const injected = new Set<string>(); // toolCallIds whose recap has been injected as a context message
  let currentTurn = 0;
  let stable: StableCtx | null = null;
  // toolCallIds observed in context so far (this session, in-memory). Recapping
  // only fires for ids that are NEW since the last walk, so enabling Recap
  // mid-session never revisits results that predate the flip.
  const seen = new Set<string>();
  let primed = false;

  registerCommands(pi, currentConfig, index, () => currentTurn);
  registerRecoverTool(pi, index);

  pi.on("session_start", async (_event, ctx: any) => {
    currentConfig.value = loadConfig();
    // Extension closures persist across session switches in one pi process —
    // stale `index`/`injected` state must not leak into the new session.
    index.clear();
    index.hydrate(reconstructRecaps(ctx));
    currentTurn = reconstructTurn(ctx);
    injected.clear();
    reconstructInjected(ctx).forEach((id) => injected.add(id));
    stable = { model: ctx.model, modelRegistry: ctx.modelRegistry, sessionManager: ctx.sessionManager };
    // Reset per-session tracking: the first context event will re-prime `seen`
    // from this session's history, so resumed/switched sessions never recap
    // tool results that predate this run.
    seen.clear();
    primed = false;
  });

  pi.on("turn_end", async (_event: any, ctx: any) => {
    // event.turnIndex resets per process (0-indexed), so it can't be trusted
    // across sessions. Increment our own counter and persist it.
    currentTurn += 1;
    try {
      ctx.sessionManager.appendCustomEntry("recap-turn", { turn: currentTurn });
    } catch {
      // best-effort
    }

    // Inject recaps for tool results that have crossed the swap threshold.
    // Persisted as a context-message (display:false => in LLM context, hidden
    // from the user). The raw result is filtered out in the `context` event.
    // Gated on `enabled` to match Phase B — injecting while Recap is disabled
    // would leave both the raw result AND the recap in context (duplicates).
    if (currentConfig.value.enabled) {
      const threshold = currentConfig.value.swapTurnThreshold;
      for (const record of index.all()) {
        if (injected.has(record.toolCallId)) continue;
        if (!record.recapText) continue;
        if (currentTurn - record.birthTurn < threshold) continue;
        if (record.originalText.length > 0 && record.recapText.length >= record.originalText.length) continue;
        try {
          ctx.sessionManager.appendCustomMessageEntry(
            CUSTOM_TYPE_RECAP_MSG,
            `〈pi-Recap〉 ${record.toolName} result → ${record.recapText}\n[original recoverable via recap_recover({ refs: ["${record.shortId}"] })]`,
            false,
            { toolCallId: record.toolCallId, shortId: record.shortId, toolName: record.toolName },
          );
          // Mark injected only after a successful append — a failed inject
          // retries on the next turn_end instead of losing the recap.
          injected.add(record.toolCallId);
        } catch {
          // best-effort
        }
      }
    }
  });

  pi.on("context", async (event: any, ctx: any) => {
    const enabled = currentConfig.value.enabled;

    // Refresh stable refs (the active model can change mid-session).
    stable = { model: ctx.model, modelRegistry: ctx.modelRegistry, sessionManager: ctx.sessionManager };

    const messages: any[] = Array.isArray(event?.messages) ? event.messages : [];

    // Priming pass — the first context event of this session. Seed `seen` with
    // every tool result already present so we never recap pre-existing history.
    // This is what prevents a token blow-up when Recap is turned on after a
    // long stretch off (or when resuming): only results generated from here on
    // are eligible. Runs regardless of `enabled`.
    if (!primed) {
      for (const m of messages) {
        if (m?.role === "toolResult" && m.toolCallId) seen.add(m.toolCallId);
      }
      primed = true;
    }

    // Phase A — recap only tool results that are (a) enabled, (b) genuinely
    // new since the last walk, and (c) eligible by size / not tool-excluded.
    // `seen` accumulates even while disabled, so flipping Recap on mid-session
    // never revisits results that predate the flip.
    const fresh = collectNewRecappables(messages, seen, (id) => index.has(id) || index.isPending(id), currentConfig.value);
    for (const item of fresh) {
      index.markPending(item.toolCallId);
      const birthTurn = currentTurn;
      const snap = messages.slice();
      index.runRecap(stable, item.toolCallId, item.toolName, birthTurn, item.text, snap);
    }

    // Phase B (context pruning) only runs when Recap is active.
    if (!enabled) return undefined;

    // Phase B — remove aged raw tool results (the recap was injected at turn_end).
    const toRemove = selectRemovable(messages, index, injected, currentTurn, currentConfig.value.swapTurnThreshold);
    if (toRemove.size === 0) return undefined;
    return {
      messages: messages.filter(
        (msg) => !(msg && msg.role === "toolResult" && toRemove.has(msg.toolCallId)),
      ),
    };
  });
}

/** Best-effort reconstruction of recap records from persisted session entries. */
function reconstructRecaps(ctx: any): RecapRecord[] {
  const out: RecapRecord[] = [];
  try {
    const entries = ctx?.sessionManager?.buildContextEntries?.() ?? [];
    for (const e of entries) {
      const rec = e?.customType === CUSTOM_TYPE_RECAP ? (e?.data ?? e) : null;
      if (rec && rec.toolCallId && typeof rec.recapText === "string") {
        out.push(rec as RecapRecord);
      }
    }
  } catch {
    // best-effort — start with an empty index
  }
  return out;
}

/** Reconstruct the turn counter from the last persisted `recap-turn` entry. */
function reconstructTurn(ctx: any): number {
  try {
    const entries = ctx?.sessionManager?.buildContextEntries?.() ?? [];
    let max = 0;
    for (const e of entries) {
      if (e?.customType === "recap-turn" && typeof e?.data?.turn === "number") {
        max = Math.max(max, e.data.turn);
      }
    }
    return max;
  } catch {
    return 0;
  }
}

/** Reconstruct the set of toolCallIds already injected as recap-messages. */
function reconstructInjected(ctx: any): Set<string> {
  const out = new Set<string>();
  try {
    const entries = ctx?.sessionManager?.buildContextEntries?.() ?? [];
    for (const e of entries) {
      if (e?.customType === CUSTOM_TYPE_RECAP_MSG && e?.details?.toolCallId) {
        out.add(e.details.toolCallId);
      }
    }
  } catch {
    // best-effort
  }
  return out;
}
