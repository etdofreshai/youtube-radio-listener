/**
 * Playlist import service.
 * Handles importing tracks from YouTube playlists with structured summary output.
 */

import type { YouTubePlaylistItem, YouTubePlaylistInfo } from './youtube-metadata';
import type { Track } from '../types';

// ── Result types ─────────────────────────────────────────────────────────────

export interface SkippedExistingItem {
  videoId: string;
  title: string | null;
  existingTrackId: string;
}

export interface FailedItem {
  videoId: string;
  title: string | null;
  reason: string;
}

export interface PlaylistImportResult {
  /** Tracks successfully created in this run. */
  added: Track[];
  /** Items skipped because the video already exists as a variant. */
  skipped_existing: SkippedExistingItem[];
  /** Items that failed for any other reason (continues on partial failure). */
  failed: FailedItem[];
  /** Total items considered (after cap). */
  total: number;
  /** Human-readable playlist title, if available. */
  playlistTitle: string | null;
  /** True when the playlist was longer than the per-run cap. */
  truncated: boolean;
  /** The cap that was applied. */
  limit: number;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface PlaylistImportDeps {
  findExistingByVideoId: (videoId: string) => Promise<{ trackId: string } | null | undefined>;
  createTrackForItem: (item: YouTubePlaylistItem) => Promise<Track>;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Import tracks from a YouTube playlist.
 *
 * - Deduplicates against existing variants (skips already-present items).
 * - Continues on partial failures and reports them in `failed`.
 * - Returns a structured summary: { added, skipped_existing, failed }.
 */
export async function importPlaylistTracks(
  playlistInfo: YouTubePlaylistInfo,
  deps: PlaylistImportDeps,
): Promise<PlaylistImportResult> {
  const added: Track[] = [];
  const skipped_existing: SkippedExistingItem[] = [];
  const failed: FailedItem[] = [];

  for (const item of playlistInfo.items) {
    try {
      // Deduplicate: check if this video already exists as a variant
      const existing = await deps.findExistingByVideoId(item.videoId);
      if (existing) {
        skipped_existing.push({
          videoId: item.videoId,
          title: item.title ?? null,
          existingTrackId: existing.trackId,
        });
        continue;
      }

      // Attempt to create the track
      const track = await deps.createTrackForItem(item);
      added.push(track);
    } catch (err) {
      // Continue on partial failure — record but don't abort
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({
        videoId: item.videoId,
        title: item.title ?? null,
        reason: msg,
      });
    }
  }

  return {
    added,
    skipped_existing,
    failed,
    total: playlistInfo.items.length,
    playlistTitle: playlistInfo.playlistTitle,
    truncated: playlistInfo.truncated,
    limit: playlistInfo.limit,
  };
}
