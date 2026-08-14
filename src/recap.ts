/**
 * pi-Recap — the "familiar".
 *
 * The familiar is an LLM call made with the MAIN model and the MAIN agent's
 * full context as its prefix, asked to summarize a single tool result into
 * 1–3 lines. Because it reuses the main model + the main context prefix, the
 * input tokens hit the provider's prefix cache (so the shared context is billed
 * at cache-read rate) and the call simultaneously warms the cache for the main
 * agent's next call.
 */

import { CUSTOM_TYPE_RECAP, MIN_RECAP_CHARS, type RecapConfig, type RecapRecord, type StableCtx } from "./types.js";

const RECAP_INSTRUCTION = (toolName: string, id: string) =>
  `Above is the full conversation so far, including a tool result you just received.
Summarize the tool result with toolCallId \`${id}\` (tool: ${toolName}) in 1–3 lines, for your own future use in this task.
Keep only what the ongoing work still needs: outcomes, file paths, key values, errors. Omit code blocks, logs, and filler — the original is recoverable on demand.
Reply with ONLY the 1–3 summary lines.`;

/** Concatenate the text parts of a toolResult message. */
export function toolResultText(msg: any): string {
  if (!msg || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
}

/** Whether a tool result is large enough to be worth recapping. */
export function isRecappable(text: string): boolean {
  return text.length >= MIN_RECAP_CHARS;
}

/** Whether a tool is excluded from recapping by the user's blocklist. */
export function isToolExcluded(toolName: string, config: RecapConfig): boolean {
  const name = (toolName ?? "tool").trim();
  return config.excludeTools.includes(name);
}

/**
 * Phase A eligibility — pure. Walk a context snapshot and return the tool
 * results that should get a recap fired for them now: (a) Recap is enabled,
 * (b) genuinely new since the last walk, (c) not already tracked, (d) large
 * enough, (e) not tool-excluded. `seen` ALWAYS accumulates (even while
 * disabled / skipped), so flipping Recap on mid-session never revisits
 * results that predate the flip — the parallel-recap blow-up guard.
 */
export function collectNewRecappables(
  messages: any[],
  seen: Set<string>,
  alreadyTracked: (id: string) => boolean,
  config: RecapConfig,
): { toolCallId: string; toolName: string; text: string }[] {
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

  const out: { toolCallId: string; toolName: string; text: string }[] = [];
  for (const msg of messages) {
    if (!msg || msg.role !== "toolResult" || !msg.toolCallId) continue;
    const id = msg.toolCallId;
    const isNew = !seen.has(id);
    seen.add(id);
    if (!config.enabled || !isNew) continue;
    if (alreadyTracked(id)) continue;
    const text = toolResultText(msg);
    // Skip tiny results — the familiar's 1–3 line summary would be longer
    // than the original, so recapping costs more tokens than it saves.
    if (!isRecappable(text)) continue;
    const toolName = toolNameById.get(id) ?? msg.toolName ?? "tool";
    // Skip tools the user excluded from recapping (e.g. hash-anchored
    // editors whose line anchors must stay verbatim in context).
    if (isToolExcluded(toolName, config)) continue;
    out.push({ toolCallId: id, toolName, text });
  }
  return out;
}

export class RecapIndex {
  private readonly byId = new Map<string, RecapRecord>();
  private readonly pending = new Set<string>();
  private counter = 0;

  has(toolCallId: string): boolean {
    return this.byId.has(toolCallId);
  }
  isPending(toolCallId: string): boolean {
    return this.pending.has(toolCallId);
  }
  get(toolCallId: string): RecapRecord | undefined {
    return this.byId.get(toolCallId);
  }
  findByRef(ref: string): RecapRecord | undefined {
    for (const r of this.byId.values()) {
      if (r.shortId === ref || r.toolCallId === ref) return r;
    }
    return undefined;
  }
  size(): number {
    return this.byId.size;
  }
  all(): RecapRecord[] {
    return Array.from(this.byId.values());
  }
  markPending(toolCallId: string): void {
    this.pending.add(toolCallId);
  }

  /** Drop all state. Called on session_start — extension closures persist
   * across session switches in one pi process, so stale records from the
   * previous session must not leak into the new one. */
  clear(): void {
    this.byId.clear();
    this.pending.clear();
    this.counter = 0;
  }

  /** Reconstruct the index from persisted session entries. */
  hydrate(records: RecapRecord[]): void {
    for (const r of records) {
      if (!r || !r.toolCallId || typeof r.recapText !== "string") continue;
      this.byId.set(r.toolCallId, r);
      const n = parseInt(String(r.shortId).replace(/^r/, ""), 10);
      if (Number.isFinite(n) && n > this.counter) this.counter = n;
    }
  }

  private nextShortId(): string {
    this.counter += 1;
    return `r${this.counter}`;
  }

  /**
   * Run the familiar call for one tool result, then store + persist the record.
   * Always resolves (failures are swallowed — the original stays in context).
   */
  async runRecap(
    stable: StableCtx,
    toolCallId: string,
    toolName: string,
    birthTurn: number,
    originalText: string,
    contextMessages: any[],
  ): Promise<void> {
    try {
      // Dynamic import: the npm-published pi-ai and pi's bundled pi-ai differ in
      // named exports. Resolving at call time keeps this module loadable in any
      // context (incl. tests that never call runRecap).
      const { stream } = await import("@earendil-works/pi-ai");
      const auth = await stable.modelRegistry.getApiKeyAndHeaders(stable.model);
      const messages = [
        ...contextMessages,
        {
          role: "user",
          content: [{ type: "text", text: RECAP_INSTRUCTION(toolName, toolCallId) }],
          timestamp: Date.now(),
        },
      ];
      const responseStream = stream(
        stable.model,
        { messages },
        { apiKey: auth.apiKey, headers: auth.headers },
      );
      // drain the stream
      for await (const _event of responseStream) {
        /* noop — we only need the final result */
      }
      const res = await responseStream.result();
      const text = (res?.content ?? [])
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("\n")
        .trim();
      if (!text) return;
      const record: RecapRecord = {
        toolCallId,
        shortId: this.nextShortId(),
        toolName,
        birthTurn,
        recapText: text,
        originalText,
      };
      this.byId.set(toolCallId, record);
      try {
        stable.sessionManager.appendCustomEntry(CUSTOM_TYPE_RECAP, record);
      } catch {
        // best-effort persistence
      }
    } catch {
      // swallow — recap is best-effort; original stays in context
    } finally {
      this.pending.delete(toolCallId);
    }
  }
}
