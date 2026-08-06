import { test } from "node:test";
import assert from "node:assert/strict";
import { RecapIndex } from "../src/recap.js";
import { selectRemovable } from "../src/swap.js";

function toolResult(toolCallId: string, text: string): any {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text }] };
}

function idx(records: Array<Partial<import("../src/types.js").RecapRecord> & { toolCallId: string }>) {
  const i = new RecapIndex();
  i.hydrate(
    records.map((r, n) => ({
      toolCallId: r.toolCallId,
      shortId: r.shortId ?? `r${n + 1}`,
      toolName: r.toolName ?? "read",
      birthTurn: r.birthTurn ?? 0,
      recapText: r.recapText ?? "short recap",
      originalText: r.originalText ?? "long original text here",
    })),
  );
  return i;
}

test("selectRemovable is empty when nothing is aged+injected", () => {
  const i = idx([{ toolCallId: "a", birthTurn: 0 }]);
  const injected = new Set<string>();
  const msgs = [toolResult("a", "long original text here")];
  assert.equal(selectRemovable(msgs, i, injected, 1, 1).size, 0); // not injected
  injected.add("a");
  assert.equal(selectRemovable(msgs, i, injected, 0, 1).size, 0); // not aged (currentTurn 0)
});

test("selectRemovable picks aged + injected + shorter-recap results", () => {
  const i = idx([
    { toolCallId: "old", birthTurn: 0 }, // aged + injected -> removable
    { toolCallId: "young", birthTurn: 5 }, // not aged
  ]);
  const injected = new Set(["old", "young"]);
  const msgs = [toolResult("old", "long original text here"), toolResult("young", "long original text here")];
  const out = selectRemovable(msgs, i, injected, 10, 5);
  assert.equal(out.size, 1);
  assert.ok(out.has("old"));
});

test("selectRemovable skips when the recap is not shorter than the original", () => {
  const i = idx([{ toolCallId: "c", birthTurn: 0, recapText: "this recap is way longer than tiny", originalText: "tiny" }]);
  const injected = new Set(["c"]);
  const msgs = [toolResult("c", "tiny")];
  assert.equal(selectRemovable(msgs, i, injected, 10, 1).size, 0);
});

test("selectRemovable: threshold 0 disables", () => {
  const i = idx([{ toolCallId: "c", birthTurn: 0 }]);
  const injected = new Set(["c"]);
  const msgs = [toolResult("c", "long original text here")];
  assert.equal(selectRemovable(msgs, i, injected, 100, 0).size, 0);
});
