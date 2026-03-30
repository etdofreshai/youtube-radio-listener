/**
 * Auto-Next Recommender
 *
 * Given the currently playing track, recommends what to play next using:
 * 1. Last.fm similar tracks API
 * 2. Local library cache check
 * 3. YouTube search fallback via yt-dlp
 * 4. Random fallback if Last.fm returns nothing
 *
 * Env vars:
 *   AUTO_NEXT_ENABLED  — enable/disable (default: true)
 *   AUTO_NEXT_PREFETCH — auto-download upcoming tracks (default: true)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as store from '../store';
import { getSimilarTracks } from './lastfm';
import type { Track } from '../types';
import { ytDlpAvailable, ytDlpBin } from '../deps';

const execFileAsync = promisify(execFile);

// ============================================================
// Types
// ============================================================

export interface TrackInfo {
  id: string | null;
  title: string;
  artist: string;
  youtubeUrl: string | null;
  audioStatus: string | null;
  duration: number | null;
}

export interface NextTrackResult {
  track: TrackInfo;
  cached: boolean;
  needsDownload: boolean;
  upcoming: TrackInfo[];
}

// ============================================================
// Config
// ============================================================

function isEnabled(): boolean {
  return process.env.AUTO_NEXT_ENABLED !== 'false';
}

// ============================================================
// Helpers
// ============================================================

function trackToInfo(track: Track): TrackInfo {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    youtubeUrl: track.youtubeUrl,
    audioStatus: track.audioStatus,
    duration: track.duration,
  };
}

function isTrackCached(track: Track): boolean {
  return track.audioStatus === 'ready' && track.audioFilename != null;
}

/**
 * Search YouTube for an artist+track and return a TrackInfo with YouTube URL.
 * Returns null if yt-dlp is not available or search fails.
 */
async function searchYouTube(artist: string, trackName: string): Promise<TrackInfo | null> {
  if (!ytDlpAvailable()) {
    console.warn('[auto-next] yt-dlp not available — cannot search YouTube');
    return null;
  }

  try {
    const query = `${artist} ${trackName}`;
    const { stdout } = await execFileAsync(ytDlpBin(), [
      `ytsearch:${query}`,
      '--dump-json',
      '--no-download',
      '--no-playlist',
    ]);

    // yt-dlp may return multiple JSON lines; take the first
    const firstLine = stdout.trim().split('\n')[0];
    if (!firstLine) return null;

    const meta = JSON.parse(firstLine) as {
      webpage_url?: string;
      title?: string;
      uploader?: string;
      duration?: number;
    };

    return {
      id: null,
      title: meta.title ?? trackName,
      artist: artist,
      youtubeUrl: meta.webpage_url ?? null,
      audioStatus: null,
      duration: meta.duration ?? null,
    };
  } catch (err) {
    console.error(`[auto-next] YouTube search failed for "${artist} ${trackName}":`, err);
    return null;
  }
}

/**
 * Pick random tracks from the library as fallback.
 */
async function getRandomFallback(count: number, excludeId?: string): Promise<TrackInfo[]> {
  try {
    const all = await store.getAllTracks();
    const filtered = all.filter(
      (t) => t.id !== excludeId && !t.isLiveStream
    );
    if (filtered.length === 0) return [];

    // Fisher-Yates shuffle, take first `count`
    const shuffled = [...filtered];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count).map(trackToInfo);
  } catch (err) {
    console.error('[auto-next] getRandomFallback error:', err);
    return [];
  }
}

// ============================================================
// Main Export
// ============================================================

/**
 * Get the next recommended track based on the currently playing track.
 */
export async function getNextTrack(currentTrackId: string): Promise<NextTrackResult | null> {
  if (!isEnabled()) {
    console.log('[auto-next] AUTO_NEXT_ENABLED=false — disabled');
    return null;
  }

  // 1. Look up current track
  const current = await store.getTrack(currentTrackId);
  if (!current) {
    console.error(`[auto-next] Track not found: ${currentTrackId}`);
    return null;
  }

  const artist = current.artist;
  const title = current.title;

  // 2. Query Last.fm for similar tracks
  const similar = await getSimilarTracks(artist, title, 20);

  // Collect candidates: prioritise cached tracks
  let primaryTrackInfo: TrackInfo | null = null;
  let primaryCached = false;
  let primaryNeedsDownload = false;
  const upcomingInfos: TrackInfo[] = [];

  if (similar.length > 0) {
    for (const candidate of similar) {
      if (primaryTrackInfo && upcomingInfos.length >= 3) break;

      // Check local library
      const localMatches = await store.findTracksByCanonicalIdentity(
        candidate.track,
        candidate.artist
      );

      if (localMatches.length > 0) {
        const localTrack = localMatches[0];
        const info = trackToInfo(localTrack);
        const cached = isTrackCached(localTrack);

        if (!primaryTrackInfo) {
          primaryTrackInfo = info;
          primaryCached = cached;
          primaryNeedsDownload = !cached;
        } else if (upcomingInfos.length < 3) {
          upcomingInfos.push(info);
        }
      } else if (!primaryTrackInfo) {
        // Not in local library — search YouTube
        const ytResult = await searchYouTube(candidate.artist, candidate.track);
        if (ytResult) {
          primaryTrackInfo = ytResult;
          primaryCached = false;
          primaryNeedsDownload = true;
        }
      }
    }
  }

  // 3. Fallback to random if we couldn't find a recommendation
  if (!primaryTrackInfo) {
    console.log('[auto-next] Last.fm returned no usable results — using random fallback');
    const fallbacks = await getRandomFallback(4, currentTrackId);
    if (fallbacks.length === 0) return null;
    const [first, ...rest] = fallbacks;
    primaryTrackInfo = first;
    primaryCached = first.audioStatus === 'ready';
    primaryNeedsDownload = !primaryCached;
    upcomingInfos.push(...rest.slice(0, 3));
  }

  // Fill upcoming slots with random tracks if needed
  if (upcomingInfos.length < 3) {
    const needed = 3 - upcomingInfos.length;
    const extras = await getRandomFallback(needed + 1, currentTrackId);
    const existingIds = new Set([
      primaryTrackInfo.id,
      ...upcomingInfos.map((u) => u.id),
    ]);
    for (const extra of extras) {
      if (upcomingInfos.length >= 3) break;
      if (!existingIds.has(extra.id)) {
        upcomingInfos.push(extra);
        existingIds.add(extra.id);
      }
    }
  }

  return {
    track: primaryTrackInfo,
    cached: primaryCached,
    needsDownload: primaryNeedsDownload,
    upcoming: upcomingInfos,
  };
}
