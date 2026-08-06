import { test } from "node:test";
import assert from "node:assert/strict";
import { RecapIndex } from "../src/recap.js";
import { applyRecaps } from "../src/swap.js";

function toolResult(toolCallId: string, text: string): any {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text }] };
}

test("applyRecaps is a no-op when the index is empty", () => {
  const idx = new RecapIndex();
  const msgs = [toolResult("a", "x")];
  const r = applyRecaps(msgs, idx, 10, 5);
  assert.equal(r.changed, false);
  assert.equal(r.swappedCount, 0);
  assert.equal(r.messages, msgs);
});

test("applyRecaps swaps aged results but leaves young ones untouched", () => {
  const idx = new RecapIndex();
  idx.hydrate([
    { toolCallId: "old", shortId: "r1", toolName: "read", birthTurn: 0, recapText: "did X", originalText: "long original text here" },
    { toolCallId: "new", shortId: "r2", toolName: "read", birthTurn: 9, recapText: "did Y", originalText: "long original text here" },
  ]);
  const msgs = [toolResult("old", "long original text here"), toolResult("new", "long original text here")];
  const r = applyRecaps(msgs, idx, 10, 5);
  assert.equal(r.changed, true);
  assert.equal(r.swappedCount, 1);
  // old (age 10 >= 5) swapped
  assert.ok(r.messages[0].content[0].text.startsWith("〈recap〉"));
  assert.ok(r.messages[0].content[0].text.includes("[recap_recover: r1]"));
  // young (age 1 < 5) unchanged — same object reference
  assert.equal(r.messages[1], msgs[1]);
});

test("applyRecaps is idempotent", () => {
  const idx = new RecapIndex();
  idx.hydrate([
    { toolCallId: "old", shortId: "r1", toolName: "read", birthTurn: 0, recapText: "did X", originalText: "long original text here" },
  ]);
  const msgs = [toolResult("old", "long original text here")];
  const first = applyRecaps(msgs, idx, 10, 5);
  assert.equal(first.changed, true);
  const second = applyRecaps(first.messages, idx, 10, 5);
  assert.equal(second.changed, false);
  assert.equal(second.swappedCount, 0);
  assert.equal(second.messages, first.messages);
});

test("applyRecaps skips when the recap is not shorter than the original", () => {
  const idx = new RecapIndex();
  const original = "tiny";
  idx.hydrate([
    { toolCallId: "c", shortId: "r1", toolName: "read", birthTurn: 0, recapText: "this recap is much longer than the tiny original", originalText: original },
  ]);
  const msgs = [toolResult("c", original)];
  const r = applyRecaps(msgs, idx, 10, 5);
  assert.equal(r.changed, false);
  assert.equal(r.messages, msgs);
});
