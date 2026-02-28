/**
 * Discovery stage — finds new candidates from various sources.
 *
 * Strategy:
 * 1. Pick seed tracks (from existing library, sorted by play count)
 * 2. Search for related videos from seeds
 * 3. Run keyword searches from configured queries
 * 4. Deduplicate against seen set
 * 5. Return new candidates
 */
import type { Candidate, CandidateSource, YouTubeAdapter, YouTubeSearchResult, AppConfig } from '../types.js';
import { DedupeSet } from '../utils/dedupe.js';
import { log } from '../utils/logger.js';
import { readFileSync } from 'fs';
import { join } from 'path';

interface SeedConfig {
  searchQueries: string[];
  seeds: Array<{ videoId: string; title: string; channelName: string; channelId: string; durationSeconds: number; plays: number }>;
}

function loadSeedConfig(): SeedConfig {
  try {
    const seedPath = join(__dirname, '..', 'data', 'seeds.json');
    const raw = readFileSync(seedPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { searchQueries: [], seeds: [] };
  }
}

function toCandidate(result: YouTubeSearchResult, source: CandidateSource): Candidate {
  return {
    videoId: result.videoId,
    title: result.title,
    channelName: result.channelName,
    channelId: result.channelId,
    durationSeconds: result.durationSeconds,
    publishedAt: result.publishedAt,
    thumbnailUrl: result.thumbnailUrl,
    discoveredAt: new Date().toISOString(),
    source,
  };
}

export async function discoverCandidates(
  adapter: YouTubeAdapter,
  dedupe: DedupeSet,
  seedVideoIds: string[],
  _config: AppConfig,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const seedConfig = loadSeedConfig();

  // 1. Related videos from seed tracks (library seeds first, then sample seeds)
  const allSeeds = [...new Set([...seedVideoIds, ...seedConfig.seeds.map(s => s.videoId)])];
  const seedsToUse = allSeeds.slice(0, 5); // Limit to avoid API quota burn

  for (const seedId of seedsToUse) {
    try {
      const related = await adapter.getRelatedVideos(seedId, 5);
      for (const result of related) {
        if (!dedupe.hasSeen(result.videoId)) {
          dedupe.markSeen(result.videoId);
          candidates.push(toCandidate(result, { type: 'related', seedVideoId: seedId }));
        }
      }
    } catch (err) {
      log.warn(`Failed to get related videos for ${seedId}:`, err);
    }
  }

  // 2. Keyword searches
  const queries = seedConfig.searchQueries.slice(0, 3); // Limit queries per run
  for (const query of queries) {
    try {
      const results = await adapter.searchVideos(query, 5);
      for (const result of results) {
        if (!dedupe.hasSeen(result.videoId)) {
          dedupe.markSeen(result.videoId);
          candidates.push(toCandidate(result, { type: 'search', query }));
        }
      }
    } catch (err) {
      log.warn(`Failed search for "${query}":`, err);
    }
  }

  log.info(`Discovery found ${candidates.length} new candidates`);
  return candidates;
}
