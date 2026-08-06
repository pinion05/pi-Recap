/**
 * pi-Recap — pure context rewriting.
 *
 * Replaces aged tool-result messages with their recaps. Only swaps when:
 *  - the result is at least `threshold` turns old, AND
 *  - the recap is shorter than the original text, AND
 *  - the message has not already been swapped (idempotent).
 *
 * Returns a new messages array only when something changed; otherwise returns
 * the original array reference unchanged.
 */

import type { RecapIndex } from "./recap.js";

export interface SwapResult {
  messages: any[];
  changed: boolean;
  swappedCount: number;
}

const RECAP_PREFIX = "〈recap〉";

function isAlreadyRecapped(msg: any): boolean {
  const first = Array.isArray(msg?.content) ? msg.content[0] : null;
  return !!first && first.type === "text" && typeof first.text === "string" && first.text.startsWith(RECAP_PREFIX);
}

export function applyRecaps(
  messages: any[],
  index: RecapIndex,
  currentTurn: number,
  threshold: number,
): SwapResult {
  if (index.size() === 0 || threshold <= 0) {
    return { messages, changed: false, swappedCount: 0 };
  }
  let changed = false;
  let swappedCount = 0;

  const out = messages.map((msg) => {
    if (!msg || msg.role !== "toolResult" || !msg.toolCallId) return msg;
    if (isAlreadyRecapped(msg)) return msg;

    const record = index.get(msg.toolCallId);
    if (!record) return msg;

    const age = currentTurn - record.birthTurn;
    if (age < threshold) return msg;
    if (!record.recapText) return msg;
    // guard: only swap if the recap is actually shorter
    if (record.originalText.length > 0 && record.recapText.length >= record.originalText.length) return msg;

    changed = true;
    swappedCount += 1;
    return {
      ...msg,
      content: [
        { type: "text", text: `${RECAP_PREFIX} ${record.recapText}\n[recap_recover: ${record.shortId}]` },
      ],
    };
  });

  return { messages: changed ? out : messages, changed, swappedCount };
}
