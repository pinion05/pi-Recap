import { test } from "node:test";
import assert from "node:assert/strict";
import { registerRecoverTool } from "../src/recovery.js";

/**
 * Capture the tool registered by registerRecoverTool so execute() can be called directly.
 * Return an object reference (not a destructured value) so `cap.tool` reads the tool *after*
 * registerRecoverTool() has run.
 */
function captureTool(): { pi: any; tool: any } {
	let tool: any;
	const pi: any = { registerTool: (t: any) => { tool = t; } };
	return { pi, get tool() { return tool; } };
}

function mockIndex(records: Record<string, any>): any {
	return { findByRef: (ref: string) => records[ref] };
}

test("recap_recover returns the original text body, not [object Object]", async () => {
	// Regression: truncateHead() returns a TruncationResult object, not a string.
	// Interpolating it directly rendered the body as "[object Object]".
	const cap = captureTool();
	const index = mockIndex({
		r1: { toolCallId: "call_1", shortId: "r1", toolName: "bash", originalText: "the real output\nline 2" },
	});
	registerRecoverTool(cap.pi, index);

	const result = await cap.tool.execute("call_x", { refs: ["r1"] });
	const text: string = result.content[0].text;
	assert.ok(!text.includes("[object Object]"), `body rendered as object: ${text}`);
	assert.ok(text.includes("the real output"), `missing original text: ${text}`);
	assert.ok(text.includes("## r1 — bash (toolCallId call_1)"), `missing header: ${text}`);
});

test("recap_recover preserves a long original through truncateHead", async () => {
	const cap = captureTool();
	const long = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
	const index = mockIndex({
		r2: { toolCallId: "call_2", shortId: "r2", toolName: "read", originalText: long },
	});
	registerRecoverTool(cap.pi, index);

	const result = await cap.tool.execute("call_x", { refs: ["r2"] });
	const text: string = result.content[0].text;
	assert.ok(!text.includes("[object Object]"), `body rendered as object: ${text}`);
	assert.ok(text.includes("line 1"), `missing head of original: ${text.slice(-200)}`);
});

test("recap_recover reports not-found for an unknown ref", async () => {
	const cap = captureTool();
	const index = mockIndex({});
	registerRecoverTool(cap.pi, index);

	const result = await cap.tool.execute("call_x", { refs: ["r999"] });
	const text: string = result.content[0].text;
	assert.ok(text.includes("not found"), `expected not-found note: ${text}`);
});

test("recap_recover handles multiple refs in one call", async () => {
	const cap = captureTool();
	const index = mockIndex({
		r1: { toolCallId: "call_1", shortId: "r1", toolName: "bash", originalText: "alpha" },
		r2: { toolCallId: "call_2", shortId: "r2", toolName: "read", originalText: "beta" },
	});
	registerRecoverTool(cap.pi, index);

	const result = await cap.tool.execute("call_x", { refs: ["r1", "r2"] });
	const text: string = result.content[0].text;
	assert.ok(text.includes("alpha"), `missing r1 body: ${text}`);
	assert.ok(text.includes("beta"), `missing r2 body: ${text}`);
	assert.ok(!text.includes("[object Object]"), `body rendered as object: ${text}`);
});
