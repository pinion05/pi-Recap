/**
 * pi-Recap — config load/save (~/.pi/agent/recap/settings.json).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG, SETTINGS_DIR_NAME, type RecapConfig } from "./types.js";

const SETTINGS_PATH = join(homedir(), ".pi", "agent", SETTINGS_DIR_NAME, "settings.json");

export function loadConfig(): RecapConfig {
  try {
    if (!existsSync(SETTINGS_PATH)) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    return {
      enabled: Boolean(parsed?.enabled ?? DEFAULT_CONFIG.enabled),
      swapTurnThreshold:
        Number.isFinite(parsed?.swapTurnThreshold) && parsed.swapTurnThreshold >= 0
          ? Math.floor(parsed.swapTurnThreshold)
          : DEFAULT_CONFIG.swapTurnThreshold,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: RecapConfig): void {
  try {
    mkdirSync(join(homedir(), ".pi", "agent", SETTINGS_DIR_NAME), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch {
    // best-effort persistence
  }
}
