/**
 * pi-Recap — recovery tool.
 *
 * `recap_recover` returns the full original tool result behind a recap, by the
 * short ref (`rN`) shown in the inline marker, or by toolCallId.
 */

import { Type } from "@sinclair/typebox";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RecapIndex } from "./recap.js";
import { RECOVER_TOOL_NAME } from "./types.js";

export function registerRecoverTool(pi: ExtensionAPI, index: RecapIndex): void {
  pi.registerTool({
    name: RECOVER_TOOL_NAME,
    label: "Recover original tool result",
    description:
      "Recover the full original tool result that pi-Recap replaced with a recap. Pass the short ref from a [recap_recover: rN] marker (or a toolCallId).",
    promptSnippet: "Recover the original behind a recap",
    promptGuidelines: [
      "When a tool result starts with 〈recap〉 and has a [recap_recover: rN] marker, call recap_recover with that ref to get the full original output if you need more detail.",
    ],
    parameters: Type.Object({
      refs: Type.Array(Type.String({ description: "Short ref (e.g. r12) or toolCallId" }), {
        description: "One or more recap refs / toolCallIds to recover the originals for",
      }),
    }),
    async execute(_toolCallId: string, params: { refs: string[] }) {
      const blocks: string[] = [];
      for (const ref of params.refs) {
        const record = index.findByRef(ref);
        if (!record) {
          blocks.push(`## ${ref}\n(not found — no recap record for this ref)`);
          continue;
        }
        const body = truncateHead(record.originalText, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });
        blocks.push(`## ${record.shortId} — ${record.toolName} (toolCallId ${record.toolCallId})\n${body}`);
      }
      return { content: [{ type: "text", text: blocks.join("\n\n") }] };
    },
  });
}
