/**
 * AI-powered recommendation pipeline using Cloud Agent SDK.
 *
 * Uses existing tracks as seed context to generate new recommendations.
 * Outputs structured JSON that can be parsed and imported reliably.
 *
 * Flow:
 * 1. Load existing tracks from DB as seed context
 * 2. Build prompt with track history
 * 3. Call Cloud Agent SDK for recommendations
 * 4. Validate and parse JSON response
 * 5. Convert to candidates for the import pipeline
 */
import type { Track, Candidate, AppConfig } from '../types.js';
import {
  createCloudAgentAdapter,
  type RecommendedTrack,
  type CloudAgentConfig,
} from '../adapters/cloud-agent-sdk.js';
import { Store } from '../data/store.js';
import { loadDbSeedTracks } from '../utils/db-seeds.js';
import { log } from '../utils/logger.js';

export interface RecommendationResult {
  /** Successfully converted to candidates */
  candidates: Candidate[];
  /** Raw recommendations from AI (for logging/debugging) */
  raw: RecommendedTrack[];
  /** Any parsing/validation errors */
  errors: Array<{ videoId?: string; error: string }>;
  /** Whether the cap was hit */
  cappedOut: boolean;
}

/**
 * Convert an AI recommendation to a Candidate for the import pipeline.
 */
function toCandidate(rec: RecommendedTrack): Candidate {
  return {
    videoId: rec.videoId,
    title: rec.title,
    channelName: rec.channelName,
    channelId: rec.channelId ?? '',
    durationSeconds: rec.durationSeconds ?? 180, // Default 3 min if not provided
    publishedAt: new Date().toISOString(), // Not provided by AI
    thumbnailUrl: `https://i.ytimg.com/vi/${rec.videoId}/hqdefault.jpg`,
    discoveredAt: new Date().toISOString(),
    source: { type: 'search', query: 'ai-recommendation' },
    scoring: {
      score: rec.confidence,
      passed: true,
      reasons: [
        { rule: 'ai-recommendation', passed: true, weight: 1.0, detail: rec.reason },
      ],
    },
    decision: {
      action: 'accept',
      reason: `AI recommended with confidence ${rec.confidence}: ${rec.reason}`,
      decidedAt: new Date().toISOString(),
    },
  };
}

/**
 * Run the AI recommendation pipeline.
 *
 * Uses existing tracks as seeds to generate new recommendations.
 * Respects the add-per-run cap from config.
 */
export async function runRecommendations(
  store: Store,
  config: AppConfig,
): Promise<RecommendationResult> {
  const { recommendation } = config;

  if (!recommendation.enabled) {
    log.info('AI recommendations disabled via config');
    return { candidates: [], raw: [], errors: [], cappedOut: false };
  }

  // Get existing tracks as seed context — prefer store tracks, fall back to main DB
  let existingTracks = store.getTracks();
  if (existingTracks.length === 0) {
    log.info('Song-explorations store empty — attempting to seed from main DB tracks');
    existingTracks = await loadDbSeedTracks(50);
  }
  if (existingTracks.length === 0) {
    log.warn('No existing tracks available as recommendation seeds (store empty, no DB or DB empty)');
    return { candidates: [], raw: [], errors: [], cappedOut: false };
  }
  log.info(`Using ${existingTracks.length} tracks as recommendation seed context`);

  // Check how many we can still add this hour
  const importedThisHour = store.tracksImportedLastHour();
  const remaining = Math.max(0, config.hourlyImportCap - importedThisHour);

  if (remaining === 0) {
    log.warn(`Hourly import cap reached (${config.hourlyImportCap}). Skipping recommendations.`);
    return { candidates: [], raw: [], errors: [], cappedOut: true };
  }

  // Limit to add-per-run cap
  const maxToAdd = Math.min(remaining, recommendation.addPerRunCap);

  log.info(`Requesting up to ${maxToAdd} AI recommendations (cap: ${recommendation.addPerRunCap}, remaining this hour: ${remaining})`);

  // Create adapter and get recommendations
  const adapterConfig: CloudAgentConfig = {
    enabled: recommendation.enabled,
    oauthToken: recommendation.cloudAgentOAuthToken,
    model: recommendation.model,
    endpoint: recommendation.endpoint,
    timeoutMs: 30000,
  };

  const adapter = createCloudAgentAdapter(adapterConfig);

  try {
    const response = await adapter.getRecommendations(existingTracks, maxToAdd);

    if (response.notes) {
      log.info(`AI notes: ${response.notes}`);
    }

    const candidates: Candidate[] = [];
    const errors: Array<{ videoId?: string; error: string }> = [];

    for (const rec of response.recommendations) {
      // Skip if already in library
      if (store.getTrack(rec.videoId)) {
        errors.push({ videoId: rec.videoId, error: 'Already in library' });
        continue;
      }

      // Skip if already a candidate
      if (store.getCandidates().some(c => c.videoId === rec.videoId)) {
        errors.push({ videoId: rec.videoId, error: 'Already a candidate' });
        continue;
      }

      // Skip if previously rejected
      if (store.isRejected(rec.videoId)) {
        errors.push({ videoId: rec.videoId, error: 'Previously rejected' });
        continue;
      }

      // Validate videoId format (11 chars)
      if (!/^[a-zA-Z0-9_-]{11}$/.test(rec.videoId)) {
        errors.push({ videoId: rec.videoId, error: 'Invalid YouTube video ID format' });
        continue;
      }

      candidates.push(toCandidate(rec));
    }

    log.info(`AI recommendations: ${candidates.length} valid, ${errors.length} skipped`);

    return {
      candidates,
      raw: response.recommendations,
      errors,
      cappedOut: candidates.length >= maxToAdd,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`AI recommendation failed: ${errorMsg}`);
    return {
      candidates: [],
      raw: [],
      errors: [{ error: errorMsg }],
      cappedOut: false,
    };
  }
}
