/**
 * Playlist import service.
 * Handles importing tracks from YouTube playlists.
 */

import type { YouTubePlaylistItem, YouTubePlaylistInfo } from './youtube-metadata';
import type { Track } from '../types';

export interface PlaylistImportResult {
  imported: Track[];
  skipped: { videoId: string; reason: string }[];
  total: number;
  playlistTitle: string | null;
}

export interface PlaylistImportDeps {
  findExistingByVideoId: (videoId: string) => Promise<{ trackId: string } | undefined>;
  createTrackForItem: (item: YouTubePlaylistItem) => Promise<Track>;
}

/**
 * Import tracks from a YouTube playlist.
 * Skips items that already exist as variants.
 */
export async function importPlaylistTracks(
  playlistInfo: YouTubePlaylistInfo,
  deps: PlaylistImportDeps
): Promise<PlaylistImportResult> {
  const imported: Track[] = [];
  const skipped: { videoId: string; reason: string }[] = [];

  for (const item of playlistInfo.items) {
    try {
      // Check if this video already exists
      const existing = await deps.findExistingByVideoId(item.videoId);
      if (existing) {
        skipped.push({ videoId: item.videoId, reason: 'Already exists as variant' });
        continue;
      }

      // Create the track
      const track = await deps.createTrackForItem(item);
      imported.push(track);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ videoId: item.videoId, reason: msg });
    }
  }

  return {
    imported,
    skipped,
    total: playlistInfo.items.length,
    playlistTitle: playlistInfo.playlistTitle,
  };
}
