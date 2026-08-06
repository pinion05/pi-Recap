/**
 * pi-Recap — pure selection of which raw tool results to drop from context.
 *
 * A tool result is removable when:
 *  - it is at least `threshold` turns old, AND
 *  - its recap has been injected (so the model still has the info), AND
 *  - the recap is shorter than the original text.
 */

import type { RecapIndex } from "./recap.js";

export function selectRemovable(
  messages: any[],
  index: RecapIndex,
  injected: Set<string>,
  currentTurn: number,
  threshold: number,
): Set<string> {
  const out = new Set<string>();
  if (threshold <= 0) return out;
  for (const msg of messages) {
    if (!msg || msg.role !== "toolResult" || !msg.toolCallId) continue;
    const record = index.get(msg.toolCallId);
    if (!record) continue;
    if (!record.recapText) continue;
    if (currentTurn - record.birthTurn < threshold) continue;
    if (record.originalText.length > 0 && record.recapText.length >= record.originalText.length) continue;
    if (!injected.has(msg.toolCallId)) continue;
    out.add(msg.toolCallId);
  }
  return out;
}
