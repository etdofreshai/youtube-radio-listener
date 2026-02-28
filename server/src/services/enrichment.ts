/**
 * Track Metadata Enrichment Service
 *
 * Pluggable provider architecture:
 * 1. YouTubeProvider  — uses yt-dlp --dump-json (always available)
 * 2. Future: MusicBrainzProvider, DiscogsProvider, LastFmProvider
 *
 * Each provider implements EnrichmentProvider interface.
 * The service runs providers in priority order, merging results.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as store from '../store/memory';
import type { Track } from '../types';

const execFileAsync = promisify(execFile);
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

// ---------- Provider Interface ----------

export interface EnrichmentResult {
  // YouTube-sourced
  ytChannel?: string | null;
  ytChannelId?: string | null;
  ytUploadDate?: string | null;
  ytDescription?: string | null;
  ytThumbnailUrl?: string | null;
  ytViewCount?: number | null;
  ytLikeCount?: number | null;
  // Music metadata
  album?: string | null;
  releaseYear?: number | null;
  genre?: string | null;
  label?: string | null;
  isrc?: string | null;
  bpm?: number | null;
  // Duration (may update existing)
  duration?: number | null;
}

export interface EnrichmentProvider {
  /** Unique name for this provider */
  name: string;
  /** Confidence level for data from this provider */
  confidence: 'high' | 'medium' | 'low';
  /** Priority (lower = runs first). Ties broken by insertion order. */
  priority: number;
  /** Check if provider is available (has API keys, etc.) */
  isAvailable(): boolean;
  /** Enrich a track. Returns partial fields to merge. */
  enrich(track: Track): Promise<EnrichmentResult>;
}

// ---------- YouTube Provider (via yt-dlp --dump-json) ----------

class YouTubeProvider implements EnrichmentProvider {
  name = 'youtube';
  confidence: 'high' = 'high';
  priority = 10;

  isAvailable(): boolean {
    return true; // yt-dlp is always available (it's a project dependency)
  }

  async enrich(track: Track): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {};

    try {
      const { stdout } = await execFileAsync(YT_DLP, [
        '--dump-json',
        '--no-playlist',
        '--no-download',
        '--no-warnings',
        track.youtubeUrl,
      ], {
        timeout: 30_000,
        maxBuffer: 5 * 1024 * 1024,
      });

      const info = JSON.parse(stdout);

      result.ytChannel = info.channel || info.uploader || null;
      result.ytChannelId = info.channel_id || info.uploader_id || null;
      result.ytDescription = info.description ? info.description.slice(0, 2000) : null;
      result.ytThumbnailUrl = info.thumbnail || null;
      result.ytViewCount = typeof info.view_count === 'number' ? info.view_count : null;
      result.ytLikeCount = typeof info.like_count === 'number' ? info.like_count : null;

      // Upload date: yt-dlp returns YYYYMMDD format
      if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
        const d = info.upload_date;
        result.ytUploadDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      }

      // Duration
      if (typeof info.duration === 'number' && info.duration > 0) {
        result.duration = Math.round(info.duration);
      }

      // Try to extract album/artist/genre from yt-dlp metadata
      // yt-dlp sometimes provides these for music videos
      if (info.album) result.album = info.album;
      if (info.release_year) result.releaseYear = info.release_year;
      if (info.genre) result.genre = info.genre;

      // YouTube Music tracks sometimes have 'artist' and 'track' fields
      if (info.track && !track.title) {
        // We don't override existing title/artist, just note it
      }

    } catch (err) {
      console.error(`[enrichment:youtube] Failed for track ${track.id}:`, err instanceof Error ? err.message : err);
      // Return what we have (empty is fine)
    }

    return result;
  }
}

// ---------- Stub: MusicBrainz Provider (future) ----------

class MusicBrainzProvider implements EnrichmentProvider {
  name = 'musicbrainz';
  confidence: 'high' = 'high';
  priority = 20;

  isAvailable(): boolean {
    // Future: check for API key or rate limit status
    return false;
  }

  async enrich(_track: Track): Promise<EnrichmentResult> {
    // Placeholder for MusicBrainz lookup by title+artist
    // Would use https://musicbrainz.org/ws/2/recording?query=...
    return {};
  }
}

// ---------- Stub: Last.fm Provider (future) ----------

class LastFmProvider implements EnrichmentProvider {
  name = 'lastfm';
  confidence: 'medium' = 'medium';
  priority = 30;

  isAvailable(): boolean {
    return !!process.env.LASTFM_API_KEY;
  }

  async enrich(_track: Track): Promise<EnrichmentResult> {
    // Placeholder for Last.fm API lookup
    // Would use track.getInfo with artist + title
    return {};
  }
}

// ---------- Provider Registry ----------

const providers: EnrichmentProvider[] = [
  new YouTubeProvider(),
  new MusicBrainzProvider(),
  new LastFmProvider(),
];

/** Register a custom provider at runtime */
export function registerProvider(provider: EnrichmentProvider): void {
  providers.push(provider);
  providers.sort((a, b) => a.priority - b.priority);
}

/** List registered providers and their availability */
export function listProviders(): Array<{ name: string; available: boolean; priority: number; confidence: string }> {
  return providers.map(p => ({
    name: p.name,
    available: p.isAvailable(),
    priority: p.priority,
    confidence: p.confidence,
  }));
}

// ---------- Active enrichments (prevent duplicates) ----------

const activeEnrichments = new Set<string>();

// ---------- Enrichment Orchestrator ----------

/**
 * Enrich a single track by running all available providers in priority order.
 * Later providers can fill gaps left by earlier ones but won't overwrite existing values
 * (unless the value is null).
 */
export async function enrichTrack(trackId: string): Promise<Track | null> {
  const track = store.getTrack(trackId);
  if (!track) return null;

  if (activeEnrichments.has(trackId)) {
    console.log(`[enrichment] Already enriching ${trackId}, skipping`);
    return track;
  }
  activeEnrichments.add(trackId);

  try {
    const merged: EnrichmentResult = {};
    let usedProvider = '';

    const available = providers.filter(p => p.isAvailable()).sort((a, b) => a.priority - b.priority);

    for (const provider of available) {
      try {
        console.log(`[enrichment] Running ${provider.name} for track ${trackId}`);
        const result = await provider.enrich(track);

        // Merge: only fill null/undefined fields
        for (const [key, value] of Object.entries(result)) {
          if (value != null && (merged as any)[key] == null) {
            (merged as any)[key] = value;
          }
        }

        if (!usedProvider) {
          usedProvider = provider.name;
        } else {
          usedProvider += `+${provider.name}`;
        }
      } catch (err) {
        console.error(`[enrichment] Provider ${provider.name} error:`, err);
      }
    }

    // Determine confidence based on how much data we got
    const filledFields = Object.entries(merged).filter(([, v]) => v != null).length;
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (filledFields >= 5) confidence = 'high';
    else if (filledFields >= 2) confidence = 'medium';

    // Apply to store
    const updated = store.updateTrackMetadata(trackId, {
      ...merged,
      metadataSource: usedProvider || null,
      metadataConfidence: confidence,
      lastEnrichedAt: new Date().toISOString(),
    });

    if (updated) {
      console.log(`[enrichment] ✅ Enriched track ${trackId} via ${usedProvider} (${filledFields} fields, confidence: ${confidence})`);
    }

    return updated;
  } finally {
    activeEnrichments.delete(trackId);
  }
}

/**
 * Enrich all tracks that haven't been enriched yet (or not recently).
 * Useful as a batch job.
 */
export async function enrichAllTracks(options?: { force?: boolean; maxAge?: number }): Promise<number> {
  const allTracks = store.getAllTracks();
  const maxAgeMs = (options?.maxAge ?? 7 * 24 * 60 * 60) * 1000; // default 7 days
  let enriched = 0;

  for (const track of allTracks) {
    const needsEnrichment = options?.force ||
      !track.lastEnrichedAt ||
      (Date.now() - new Date(track.lastEnrichedAt).getTime() > maxAgeMs);

    if (needsEnrichment) {
      await enrichTrack(track.id);
      enriched++;
      // Small delay to be nice to APIs
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return enriched;
}
