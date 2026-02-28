/**
 * Scheduling helpers — not a daemon, just logic + instructions.
 *
 * This module provides:
 * 1. Rate-limit checks (can we run now?)
 * 2. OpenClaw cron job instructions
 *
 * The actual scheduling is done via OpenClaw cron, not an internal loop.
 */
import { Store } from '../data/store.js';
import type { AppConfig } from '../types.js';
import { log } from '../utils/logger.js';

export interface ScheduleCheck {
  canRunDiscovery: boolean;
  canImport: boolean;
  tracksImportedThisHour: number;
  importCapRemaining: number;
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
}

export function checkSchedule(store: Store, config: AppConfig): ScheduleCheck {
  const runLog = store.getRunLog();
  const lastRun = runLog.length > 0 ? runLog[runLog.length - 1] : null;

  let minutesSinceLastRun: number | null = null;
  let canRunDiscovery = true;

  if (lastRun) {
    const elapsed = Date.now() - new Date(lastRun.completedAt).getTime();
    minutesSinceLastRun = Math.round(elapsed / 60000);
    if (minutesSinceLastRun < config.discoveryIntervalMinutes) {
      canRunDiscovery = false;
      log.debug(`Too soon since last run (${minutesSinceLastRun}min < ${config.discoveryIntervalMinutes}min)`);
    }
  }

  const tracksImportedThisHour = store.tracksImportedLastHour();
  const importCapRemaining = Math.max(0, config.hourlyImportCap - tracksImportedThisHour);

  return {
    canRunDiscovery,
    canImport: importCapRemaining > 0,
    tracksImportedThisHour,
    importCapRemaining,
    lastRunAt: lastRun?.completedAt ?? null,
    minutesSinceLastRun,
  };
}

/** Generate OpenClaw cron job setup instructions */
export function getCronInstructions(projectDir: string): string {
  return `
# ── OpenClaw Cron Setup for song-explorations ──

# Discovery run every 20 minutes:
openclaw cron add --schedule "*/20 * * * *" \\
  --name "song-discovery" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/index.ts discover"

# Import run every hour (picks best candidates up to cap):
openclaw cron add --schedule "0 * * * *" \\
  --name "song-import" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/index.ts import"

# Status check daily at 9am CST (3pm UTC):
openclaw cron add --schedule "0 15 * * *" \\
  --name "song-status" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/index.ts status"

# ── Alternative: combined discover+import every 20 min ──
openclaw cron add --schedule "*/20 * * * *" \\
  --name "song-explore" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/index.ts"
`.trim();
}
