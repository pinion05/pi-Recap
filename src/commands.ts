/**
 * pi-Recap — /Recap command.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { saveConfig } from "./config.js";
import type { RecapIndex } from "./recap.js";
import type { RecapConfig } from "./types.js";

const SUBCOMMANDS = [
  { value: "on", label: "on        — enable pi-Recap" },
  { value: "off", label: "off       — disable pi-Recap" },
  { value: "status", label: "status    — show state, threshold, recap count" },
  { value: "threshold", label: "threshold — show or set the swap turn threshold" },
  { value: "help", label: "help      — show this help" },
];

export function registerCommands(
  pi: ExtensionAPI,
  currentConfig: { value: RecapConfig },
  index: RecapIndex,
  getCurrentTurn: () => number,
): void {
  pi.registerCommand("Recap", {
    description: "pi-Recap — context-sharing tool-result recaps",
    getArgumentCompletions(prefix: string) {
      return SUBCOMMANDS.filter((s) => s.value.startsWith(prefix)).map((s) => s.label);
    },
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parts = args.trim().split(/\s+/);
      let sub = parts[0] || undefined;

      if (!sub) {
        const choice = await ctx.ui.select("pi-Recap — choose a subcommand", SUBCOMMANDS.map((s) => s.label));
        if (!choice) return;
        sub = choice.split(/\s+/)[0];
      }

      switch (sub) {
        case "on": {
          currentConfig.value = { ...currentConfig.value, enabled: true };
          saveConfig(currentConfig.value);
          ctx.ui.notify(
            `pi-Recap enabled — recaps swap in after ${currentConfig.value.swapTurnThreshold} turns.`,
            "info",
          );
          break;
        }
        case "off": {
          currentConfig.value = { ...currentConfig.value, enabled: false };
          saveConfig(currentConfig.value);
          ctx.ui.notify("pi-Recap disabled.", "info");
          break;
        }
        case "status": {
          const c = currentConfig.value;
          ctx.ui.notify(
            `pi-Recap: ${c.enabled ? "ON" : "OFF"} · threshold ${c.swapTurnThreshold} turns · ${index.size()} recap(s) · current turn ${getCurrentTurn()}`,
            "info",
          );
          break;
        }
        case "threshold": {
          const n = parseInt(parts[1] ?? "", 10);
          if (Number.isFinite(n) && n >= 0) {
            currentConfig.value = { ...currentConfig.value, swapTurnThreshold: Math.floor(n) };
            saveConfig(currentConfig.value);
            ctx.ui.notify(`pi-Recap swap threshold set to ${currentConfig.value.swapTurnThreshold} turns.`, "info");
          } else {
            ctx.ui.notify(`pi-Recap swap threshold is ${currentConfig.value.swapTurnThreshold} turns.`, "info");
          }
          break;
        }
        default:
          ctx.ui.notify("pi-Recap commands: on · off · status · threshold <n> · help", "info");
      }
    },
  });
}
