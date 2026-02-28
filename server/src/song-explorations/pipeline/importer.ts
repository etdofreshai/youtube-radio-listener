/**
 * Importer — takes accepted candidates and adds them to the track library.
 *
 * Enforces:
 * - Hourly import cap
 * - Duplicate rejection (idempotent)
 * - Confidence threshold
 */
import type { Candidate, Track, AppConfig } from '../types.js';
import { Store } from '../data/store.js';
import { log } from '../utils/logger.js';

export interface ImportResult {
  imported: Track[];
  skipped: Array<{ videoId: string; reason: string }>;
  cappedOut: boolean;
}

export function importAcceptedCandidates(
  candidates: Candidate[],
  store: Store,
  config: AppConfig,
): ImportResult {
  const accepted = candidates.filter(c => c.decision?.action === 'accept');
  const imported: Track[] = [];
  const skipped: Array<{ videoId: string; reason: string }> = [];

  // Check hourly cap
  const importedThisHour = store.tracksImportedLastHour();
  const remaining = Math.max(0, config.hourlyImportCap - importedThisHour);

  if (remaining === 0) {
    log.warn(`Hourly import cap reached (${config.hourlyImportCap}). Skipping all.`);
    return {
      imported: [],
      skipped: accepted.map(c => ({ videoId: c.videoId, reason: 'Hourly cap reached' })),
      cappedOut: true,
    };
  }

  // Sort by score descending — import best candidates first
  const sorted = [...accepted].sort((a, b) => (b.scoring?.score ?? 0) - (a.scoring?.score ?? 0));

  for (const candidate of sorted) {
    if (imported.length >= remaining) {
      skipped.push({ videoId: candidate.videoId, reason: 'Hourly cap reached mid-batch' });
      continue;
    }

    // Check duplicate in library
    if (store.getTrack(candidate.videoId)) {
      skipped.push({ videoId: candidate.videoId, reason: 'Already in library' });
      log.debug(`Skipping ${candidate.videoId} — already in library`);
      continue;
    }

    // Check minimum confidence
    const score = candidate.scoring?.score ?? 0;
    if (score < config.minConfidenceScore) {
      skipped.push({ videoId: candidate.videoId, reason: `Score ${score} below threshold` });
      continue;
    }

    const track: Track = {
      videoId: candidate.videoId,
      title: candidate.title,
      channelName: candidate.channelName,
      channelId: candidate.channelId,
      durationSeconds: candidate.durationSeconds,
      addedAt: new Date().toISOString(),
      source: candidate.source,
      confidence: score,
      plays: 0,
      lastPlayedAt: null,
    };

    const added = store.addTrack(track);
    if (added) {
      imported.push(track);
      log.info(`✓ Imported: "${track.title}" (${track.videoId}) — score ${score}`);
    } else {
      skipped.push({ videoId: candidate.videoId, reason: 'Store rejected (duplicate)' });
    }
  }

  return { imported, skipped, cappedOut: imported.length >= remaining };
}
