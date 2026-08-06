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

import { CUSTOM_TYPE_RECAP, MIN_RECAP_CHARS, type RecapRecord, type StableCtx } from "./types.js";

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
