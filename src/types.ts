/**
 * pi-Recap — shared types and constants.
 */

/** Subdirectory under ~/.pi/agent/ where settings live. */
export const SETTINGS_DIR_NAME = "recap";

/** Session-entry customType used to persist each recap record (NOT in LLM context). */
export const CUSTOM_TYPE_RECAP = "recap-entry";

/** customType for the injected recap context-message (IN LLM context, not shown to user). */
export const CUSTOM_TYPE_RECAP_MSG = "recap-message";

/** Recovery tool name (stable — referenced from the injected `[original recoverable via recap_recover(...)]` marker). */
export const RECOVER_TOOL_NAME = "recap_recover";

/** Tool results shorter than this are not worth recapping — the familiar's
 *  fixed 1–3 line summary would be longer than the original. */
export const MIN_RECAP_CHARS = 200;

export interface RecapConfig {
  /** Master switch. When false, no recaps run and no swaps happen. */
  enabled: boolean;
  /** A tool result is swapped with its recap once it is this many turns old. */
  swapTurnThreshold: number;
  /** Tool names whose results pi-Recap should never recap (blocklist). */
  excludeTools: string[];
}

export const DEFAULT_CONFIG: RecapConfig = {
  enabled: false,
  swapTurnThreshold: 5,
  excludeTools: [],
};

export interface RecapRecord {
  toolCallId: string;
  /** Short ref shown in the inline marker (r1, r2, …). */
  shortId: string;
  toolName: string;
  /** currentTurn when the tool result was first seen. */
  birthTurn: number;
  /** The familiar's 1–3 line summary. */
  recapText: string;
  /** Original tool-result text — kept for recovery + the swap-shorter guard. */
  originalText: string;
}

/**
 * Long-lived references captured from an ExtensionContext so the (async,
 * fire-and-forget) recap call does not depend on a short-lived event ctx.
 */
export type StableCtx = {
  model: any;
  modelRegistry: any;
  sessionManager: any;
};
