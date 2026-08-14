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
  { value: "tools", label: "tools     — toggle which tools pi-Recap recaps" },
  { value: "help", label: "help      — show this help" },
];

/** Collect every tool pi knows about, richest source first. */
function availableTools(pi: ExtensionAPI): { name: string; desc: string }[] {
  const out: { name: string; desc: string }[] = [];
  const seen = new Set<string>();
  const push = (name: unknown, desc: unknown): void => {
    const n = typeof name === "string" ? name.trim() : "";
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push({ name: n, desc: typeof desc === "string" ? desc.replace(/\s+/g, " ").trim() : "" });
  };
  try {
    for (const t of pi.getAllTools()) push(t.name, t.description);
  } catch {
    // fall through to the active-tools fallback
  }
  if (out.length === 0) {
    try {
      for (const name of pi.getActiveTools()) push(name, "");
    } catch {
      // nothing else we can do
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Minimal structural types so this file needs no pi-tui import (pi-tui isn't in
// the repo's node_modules; pi provides it at runtime, but importing the type
// here would break `npm test` / local dev). The real Theme / KeybindingsManager
// passed in by ctx.ui.custom are structurally compatible.
interface PickerTheme {
  fg: (key: string, text: string) => string;
  bold: (text: string) => string;
}
interface PickerKeybindings {
  matches: (data: string, keybinding: string) => boolean;
}

const MAX_VISIBLE = 12;

/**
 * Self-contained toggle list mounted via ctx.ui.custom. Because the component
 * persists across toggles (we only repaint, we never reopen a dialog), the
 * cursor stays on the item you just flipped — no more snap-to-top.
 *
 * 🟢 = recappable (on) · 🔴 = excluded (off). Enter flips the focused tool;
 * Esc/Ctrl-C closes.
 */
class RecapToolsPicker {
  private readonly tools: { name: string; desc: string }[];
  private readonly cfg: { value: RecapConfig };
  private readonly theme: PickerTheme;
  private readonly kb: PickerKeybindings;
  private readonly repaint: () => void;
  private readonly finish: () => void;
  private selected = 0;
  focused = false; // Focusable — TUI sets this; we don't render a hardware cursor.

  constructor(
    tools: { name: string; desc: string }[],
    cfg: { value: RecapConfig },
    theme: PickerTheme,
    kb: PickerKeybindings,
    repaint: () => void,
    finish: () => void,
  ) {
    this.tools = tools;
    this.cfg = cfg;
    this.theme = theme;
    this.kb = kb;
    this.repaint = repaint;
    this.finish = finish;
  }

  private isExcluded(name: string): boolean {
    return this.cfg.value.excludeTools.includes(name);
  }

  private toggle(name: string): void {
    const next = new Set(this.cfg.value.excludeTools);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.cfg.value = { ...this.cfg.value, excludeTools: [...next].sort() };
    saveConfig(this.cfg.value);
  }

  render(_width: number): string[] {
    const n = this.tools.length;
    const excluded = this.cfg.value.excludeTools.length;
    const lines: string[] = [];
    lines.push(this.theme.fg("accent", this.theme.bold("pi-Recap — toggle recappable tools")));
    lines.push(
      this.theme.fg("dim", `🟢 recappable · 🔴 excluded (${excluded}) · ↑/↓ move · Enter toggle · Esc done`),
    );
    const half = Math.floor(MAX_VISIBLE / 2);
    const start = Math.max(0, Math.min(this.selected - half, n - MAX_VISIBLE));
    const end = Math.min(start + MAX_VISIBLE, n);
    for (let i = start; i < end; i++) {
      const t = this.tools[i];
      if (!t) continue;
      const mark = this.isExcluded(t.name) ? "🔴" : "🟢";
      const arrow = i === this.selected ? "→ " : "  ";
      const body = `${arrow}${mark} ${t.name}`;
      lines.push(i === this.selected ? this.theme.fg("accent", body) : body);
    }
    if (start > 0 || end < n) {
      lines.push(this.theme.fg("dim", `  (${this.selected + 1}/${n})`));
    }
    return lines;
  }

  handleInput(data: string): void {
    const n = this.tools.length;
    if (n === 0) return;
    if (this.kb.matches(data, "tui.select.up")) {
      this.selected = this.selected === 0 ? n - 1 : this.selected - 1;
      this.repaint();
    } else if (this.kb.matches(data, "tui.select.down")) {
      this.selected = this.selected === n - 1 ? 0 : this.selected + 1;
      this.repaint();
    } else if (this.kb.matches(data, "tui.select.confirm")) {
      const target = this.tools[this.selected];
      if (target) this.toggle(target.name); // selected stays → cursor stays on the toggled tool
      this.repaint();
    } else if (this.kb.matches(data, "tui.select.cancel")) {
      this.finish();
    }
  }

  invalidate(): void {
    // nothing cached
  }

  dispose(): void {
    // nothing to clean up
  }
}

async function runToolsToggle(
  pi: ExtensionAPI,
  currentConfig: { value: RecapConfig },
  ctx: ExtensionCommandContext,
): Promise<void> {
  const tools = availableTools(pi);
  if (tools.length === 0) {
    ctx.ui.notify("pi-Recap: no tools discovered to configure.", "warning");
    return;
  }
  await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
    return new RecapToolsPicker(
      tools,
      currentConfig,
      theme,
      keybindings,
      () => tui.requestRender(),
      () => done(),
    );
  });
  ctx.ui.notify(
    `pi-Recap tool filter: ${currentConfig.value.excludeTools.length} tool(s) excluded.`,
    "info",
  );
}

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
          const excluded = c.excludeTools.length > 0 ? c.excludeTools.join(", ") : "none";
          ctx.ui.notify(
            `pi-Recap: ${c.enabled ? "ON" : "OFF"} · threshold ${c.swapTurnThreshold} turns · ${index.size()} recap(s) · excluded: ${excluded} · turn ${getCurrentTurn()}`,
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
        case "tools": {
          await runToolsToggle(pi, currentConfig, ctx);
          break;
        }
        default:
          ctx.ui.notify("pi-Recap commands: on · off · status · threshold <n> · tools · help", "info");
      }
    },
  });
}
