import { test } from "node:test";
import assert from "node:assert/strict";
import { isRecappable } from "../src/recap.js";
import { MIN_RECAP_CHARS } from "../src/types.js";

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
