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
 * Usage:  pi -e .   then   /Recap on
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { RecapIndex, isRecappable, toolResultText } from "./src/recap.js";
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

  registerCommands(pi, currentConfig, index, () => currentTurn);
  registerRecoverTool(pi, index);

  pi.on("session_start", async (_event, ctx: any) => {
    currentConfig.value = loadConfig();
    index.hydrate(reconstructRecaps(ctx));
    currentTurn = reconstructTurn(ctx);
    reconstructInjected(ctx).forEach((id) => injected.add(id));
    stable = { model: ctx.model, modelRegistry: ctx.modelRegistry, sessionManager: ctx.sessionManager };
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
    const threshold = currentConfig.value.swapTurnThreshold;
    for (const record of index.all()) {
      if (injected.has(record.toolCallId)) continue;
      if (!record.recapText) continue;
      if (currentTurn - record.birthTurn < threshold) continue;
      if (record.originalText.length > 0 && record.recapText.length >= record.originalText.length) continue;
      injected.add(record.toolCallId);
      try {
        ctx.sessionManager.appendCustomMessageEntry(
          CUSTOM_TYPE_RECAP_MSG,
          `〈pi-Recap〉 ${record.toolName} result → ${record.recapText}\n[original recoverable via recap_recover({ refs: ["${record.shortId}"] })]`,
          false,
          { toolCallId: record.toolCallId, shortId: record.shortId, toolName: record.toolName },
        );
      } catch {
        // best-effort
      }
    }
  });

  pi.on("context", async (event: any, ctx: any) => {
    if (!currentConfig.value.enabled) return undefined;

    // Refresh stable refs (the active model can change mid-session).
    stable = { model: ctx.model, modelRegistry: ctx.modelRegistry, sessionManager: ctx.sessionManager };

    const messages: any[] = Array.isArray(event?.messages) ? event.messages : [];

    // Resolve tool names from assistant tool_use blocks (toolResult messages
    // don't always carry the name).
    const toolNameById = new Map<string, string>();
    for (const m of messages) {
      if (m?.role === "assistant" && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b?.type === "tool_use" && b.id) toolNameById.set(b.id, b.name ?? "tool");
        }
      }
    }

    // Phase A — kick off recaps for newly seen tool results (fire-and-forget).
    for (const msg of messages) {
      if (!msg || msg.role !== "toolResult" || !msg.toolCallId) continue;
      if (index.has(msg.toolCallId) || index.isPending(msg.toolCallId)) continue;
      const toolName = toolNameById.get(msg.toolCallId) ?? msg.toolName ?? "tool";
      const originalText = toolResultText(msg);
      // Skip tiny results — the familiar's 1–3 line summary would be longer
      // than the original, so recapping costs more tokens than it saves.
      if (!isRecappable(originalText)) continue;
      index.markPending(msg.toolCallId);
      const birthTurn = currentTurn;
      const snap = messages.slice();
      index.runRecap(stable, msg.toolCallId, toolName, birthTurn, originalText, snap).catch(() => {});
    }

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
