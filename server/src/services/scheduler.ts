/**
 * Background Enrichment Scheduler
 *
 * Runs on a timer (default every 3 minutes).
 * Each tick:
 *   1. Finds 1-2 tracks that need enrichment (prioritized).
 *   2. Queues them into the enrichment queue.
 *   3. Respects backoff cooldowns and budget limits.
 *
 * Design:
 *   - Lightweight: just a setInterval that calls into the enrichment queue.
 *   - Idempotent: the queue deduplicates, so overlapping ticks are safe.
 *   - Graceful: can be started/stopped at runtime.
 */

import * as store from '../store/memory';
import { enrichmentQueue, budgetTracker, enrichmentStats } from './enrichment';
import type { SchedulerStatus } from '../types';

// ============================================================
// Configuration
// ============================================================

const TICK_INTERVAL_MS = parseInt(process.env.ENRICH_INTERVAL_MS || '180000', 10); // 3 min
const BATCH_SIZE = parseInt(process.env.ENRICH_BATCH_SIZE || '2', 10);              // tracks per tick

// ============================================================
// Scheduler State
// ============================================================

let timer: ReturnType<typeof setInterval> | null = null;
let lastTickAt: string | null = null;
let nextTickAt: string | null = null;
let running = false;

// ============================================================
// Tick Logic
// ============================================================

function tick(): void {
  const now = Date.now();
  lastTickAt = new Date(now).toISOString();
  nextTickAt = new Date(now + TICK_INTERVAL_MS).toISOString();

  try {
    // Find tracks that need enrichment
    const candidates = store.getTracksNeedingEnrichment(BATCH_SIZE, now);

    if (candidates.length === 0) {
      return; // Nothing to do — quiet tick
    }

    console.log(`[scheduler] Tick: found ${candidates.length} track(s) to enrich`);

    for (const track of candidates) {
      // Determine which stage to run
      let stage: 'A' | 'B';

      if (track.enrichmentStatus === 'none' || !track.stageACompletedAt) {
        stage = 'A';
      } else if (track.enrichmentStatus === 'stage_a_done' && track.metadataConfidence !== 'high') {
        // Stage A done but incomplete — try Stage B
        if (budgetTracker.canDoAIEnrich()) {
          stage = 'B';
        } else {
          console.log(`[scheduler] Skipping Stage B for ${track.id} — AI budget exhausted`);
          continue;
        }
      } else if (track.enrichmentStatus === 'error') {
        // Retry: start from whichever stage hasn't completed
        stage = track.stageACompletedAt ? 'B' : 'A';
      } else if (track.enrichmentStatus === 'complete' && track.metadataConfidence !== 'high') {
        // Re-enrich: start from A to refresh YouTube data
        stage = 'A';
      } else {
        continue;
      }

      const queued = enrichmentQueue.enqueue(track.id, stage);
      if (queued) {
        console.log(`[scheduler]   Queued ${track.id} for Stage ${stage} ("${track.title}" — confidence: ${track.metadataConfidence || 'none'})`);
      }
    }
  } catch (err) {
    console.error('[scheduler] Tick error:', err);
  }
}

// ============================================================
// Public API
// ============================================================

/** Start the background scheduler */
export function startScheduler(): void {
  if (running) {
    console.log('[scheduler] Already running');
    return;
  }

  running = true;
  nextTickAt = new Date(Date.now() + TICK_INTERVAL_MS).toISOString();

  // Run first tick after a short delay (let server finish starting)
  setTimeout(() => {
    if (!running) return;
    tick();
    timer = setInterval(tick, TICK_INTERVAL_MS);
  }, 5_000);

  console.log(`[scheduler] ✅ Started (interval: ${TICK_INTERVAL_MS / 1000}s, batch: ${BATCH_SIZE})`);
}

/** Stop the background scheduler */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  nextTickAt = null;
  console.log('[scheduler] ⏹ Stopped');
}

/** Force a tick right now (for debugging / manual trigger) */
export function forceTick(): void {
  tick();
}

/** Get full scheduler status */
export function getSchedulerStatus(): SchedulerStatus {
  return {
    running,
    intervalMs: TICK_INTERVAL_MS,
    queueLength: enrichmentQueue.length,
    activeJobs: enrichmentQueue.activeCount,
    maxConcurrency: enrichmentQueue.maxConcurrency,
    budget: budgetTracker.getStatus(),
    lastTickAt,
    nextTickAt,
    stats: {
      totalStageACompleted: enrichmentStats.stageACompleted,
      totalStageBCompleted: enrichmentStats.stageBCompleted,
      totalErrors: enrichmentStats.errors,
    },
  };
}
