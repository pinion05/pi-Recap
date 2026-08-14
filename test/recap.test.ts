import { test } from "node:test";
import assert from "node:assert/strict";
import { isRecappable, isToolExcluded, collectNewRecappables } from "../src/recap.js";
import { MIN_RECAP_CHARS, DEFAULT_CONFIG } from "../src/types.js";

test("isRecappable: skips results under MIN_RECAP_CHARS", () => {
	// The familiar's 1–3 line summary would be longer than a tiny original,
	// so recapping costs tokens instead of saving them.
	assert.equal(isRecappable(""), false);
	assert.equal(isRecappable("a".repeat(MIN_RECAP_CHARS - 1)), false);
});

test("isRecappable: keeps results at or above MIN_RECAP_CHARS", () => {
	assert.equal(isRecappable("a".repeat(MIN_RECAP_CHARS)), true);
	assert.equal(isRecappable("a".repeat(5000)), true);
});

test("isToolExcluded: false by default, true when listed", () => {
	const c = { ...DEFAULT_CONFIG, excludeTools: ["read", "replace"] };
	assert.equal(isToolExcluded("read", c), true);
	assert.equal(isToolExcluded("replace", c), true);
	assert.equal(isToolExcluded("bash", c), false);
	// Trims whitespace and tolerates a missing name.
	assert.equal(isToolExcluded("  read ", c), true);
	assert.equal(isToolExcluded(undefined as unknown as string, c), false);
});

test("isToolExcluded: empty excludeTools recaps everything", () => {
	const c = { ...DEFAULT_CONFIG, excludeTools: [] };
	assert.equal(isToolExcluded("read", c), false);
	assert.equal(isToolExcluded("anything", c), false);
});

/** Minimal assistant tool_use + toolResult pair for one toolCallId. */
function toolPair(id: string, name: string, text: string): any[] {
	return [
		{ role: "assistant", content: [{ type: "tool_use", id, name }] },
		{ role: "toolResult", toolCallId: id, content: [{ type: "text", text }] },
	];
}

test("collectNewRecappables: disabled walk seeds seen, later enabled walk returns nothing old", () => {
	const messages = [
		...toolPair("A", "read", "x".repeat(MIN_RECAP_CHARS)),
		...toolPair("B", "bash", "x".repeat(MIN_RECAP_CHARS)),
	];
	const seen = new Set<string>();
	// While disabled: nothing is recapped, but every observed id is marked seen.
	assert.deepEqual(collectNewRecappables(messages, seen, () => false, { ...DEFAULT_CONFIG, enabled: false }), []);
	// Blow-up regression: enabling later must NOT replay the pre-flip results
	// as a fan-out of full-context LLM calls.
	assert.deepEqual(collectNewRecappables(messages, seen, () => false, { ...DEFAULT_CONFIG, enabled: true }), []);
});

test("collectNewRecappables: only genuinely new results are returned", () => {
	const seen = new Set<string>();
	const ab = [
		...toolPair("A", "read", "x".repeat(MIN_RECAP_CHARS)),
		...toolPair("B", "bash", "x".repeat(MIN_RECAP_CHARS)),
	];
	collectNewRecappables(ab, seen, () => false, { ...DEFAULT_CONFIG, enabled: false });
	const messages = [...ab, ...toolPair("C", "bash", "x".repeat(MIN_RECAP_CHARS))];
	assert.deepEqual(collectNewRecappables(messages, seen, () => false, { ...DEFAULT_CONFIG, enabled: true }), [
		{ toolCallId: "C", toolName: "bash", text: "x".repeat(MIN_RECAP_CHARS) },
	]);
});

test("collectNewRecappables: excluded and tiny results are skipped but marked seen", () => {
	const messages = [
		...toolPair("E", "read", "x".repeat(MIN_RECAP_CHARS)), // excluded tool name
		...toolPair("T", "bash", "x".repeat(MIN_RECAP_CHARS - 1)), // tiny result
	];
	const seen = new Set<string>();
	const cfg = { ...DEFAULT_CONFIG, enabled: true, excludeTools: ["read"] };
	assert.deepEqual(collectNewRecappables(messages, seen, () => false, cfg), []);
	assert.deepEqual([...seen].sort(), ["E", "T"]);
	// Flipping eligibility later (re-walk same messages, enabled, nothing
	// excluded) still returns nothing — they were already observed.
	assert.deepEqual(collectNewRecappables(messages, seen, () => false, { ...DEFAULT_CONFIG, enabled: true }), []);
});
