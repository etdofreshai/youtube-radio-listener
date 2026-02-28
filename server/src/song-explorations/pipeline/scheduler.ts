/**
 * Scheduling helpers — not a daemon, just logic + instructions.
 *
 * This module provides:
 * 1. Rate-limit checks (can we run now?)
 * 2. OpenClaw cron job instructions
 *
 * The actual scheduling is done via OpenClaw cron, not an internal loop.
 *
 * Default cadence: Hourly (60 minutes) with 5 tracks added per run.
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

/** Generate OpenClaw cron job setup instructions (hourly cadence) */
export function getCronInstructions(projectDir: string): string {
  return `
# ── OpenClaw Cron Setup for song-explorations ──
#
# Default: Hourly cadence, 5 tracks added per run
# Recommendations based on existing tracks in DB

# Discovery + Import run every hour (at minute 0):
openclaw cron add --schedule "0 * * * *" \\
  --name "song-discovery-hourly" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/song-explorations/index.ts"

# Alternative: Separate discover and import schedules

# Discovery only - every hour:
openclaw cron add --schedule "0 * * * *" \\
  --name "song-discover" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/song-explorations/index.ts discover"

# Import only - every hour at minute 5 (after discovery):
openclaw cron add --schedule "5 * * * *" \\
  --name "song-import" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/song-explorations/index.ts import"

# Status check daily at 9am CST (3pm UTC):
openclaw cron add --schedule "0 15 * * *" \\
  --name "song-status" \\
  --prompt "Run: cd ${projectDir} && npx tsx src/song-explorations/index.ts status"
`.trim();
}
