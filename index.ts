/**
 * pi-Recap — entry point.
 *
 * Design:
 *   1. (familiar)  On each new tool result in context, run an LLM call that
 *                  shares the main agent's full context (same main model) and
 *                  summarizes that one tool result into 1–3 lines.
 *   2. (swap)      Once a tool result is `swapTurnThreshold` turns old, its
 *                  content is secretly replaced with the recap. The original is
 *                  kept in the session index and recoverable via `recap_recover`.
 *
 * Usage:  pi -e .   then   /Recap on
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { RecapIndex, toolResultText } from "./src/recap.js";
import { applyRecaps } from "./src/swap.js";
import { registerCommands } from "./src/commands.js";
import { registerRecoverTool } from "./src/recovery.js";
import { CUSTOM_TYPE_RECAP, DEFAULT_CONFIG, type RecapConfig, type RecapRecord, type StableCtx } from "./src/types.js";

export default function (pi: ExtensionAPI) {
  const currentConfig: { value: RecapConfig } = { value: { ...DEFAULT_CONFIG } };
  const index = new RecapIndex();
  let currentTurn = 0;
  let stable: StableCtx | null = null;

  registerCommands(pi, currentConfig, index, () => currentTurn);
  registerRecoverTool(pi, index);

  pi.on("session_start", async (_event, ctx: any) => {
    currentConfig.value = loadConfig();
    index.hydrate(reconstructRecaps(ctx));
    currentTurn = 0;
    stable = { model: ctx.model, modelRegistry: ctx.modelRegistry, sessionManager: ctx.sessionManager };
  });

  pi.on("turn_end", async (event: any) => {
    if (typeof event?.turnIndex === "number") {
      currentTurn = Math.max(currentTurn, event.turnIndex);
    } else {
      currentTurn += 1;
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
      index.markPending(msg.toolCallId);
      const toolName = toolNameById.get(msg.toolCallId) ?? msg.toolName ?? "tool";
      const originalText = toolResultText(msg);
      const birthTurn = currentTurn;
      const snap = messages.slice();
      index.runRecap(stable, msg.toolCallId, toolName, birthTurn, originalText, snap).catch(() => {});
    }

    // Phase B — swap aged tool results with their recaps.
    const { messages: swapped, changed } = applyRecaps(
      messages,
      index,
      currentTurn,
      currentConfig.value.swapTurnThreshold,
    );
    if (!changed) return undefined;
    return { messages: swapped };
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
