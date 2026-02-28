/**
 * db-seeds — Load tracks from the main PostgreSQL DB as seed context
 * for AI recommendations when the song-explorations JSON store is empty.
 *
 * This lets the recommendation engine bootstrap from the user's existing
 * music library on first run, rather than returning nothing.
 *
 * Only runs when DATABASE_URL is set; silently returns [] otherwise.
 */
import { extractVideoId } from '../../utils/youtube-url.js';
import type { Track } from '../types.js';
import { log } from './logger.js';

interface MainDbTrackRow {
  youtube_url: string;
  title: string;
  artist: string | null;
  yt_channel: string | null;
  yt_channel_id: string | null;
  duration: number | null;
  created_at: string;
}

/**
 * Load up to `limit` tracks from the main PostgreSQL DB as seed Tracks.
 * Converts from the main DB schema (youtubeUrl, artist, etc.) to the
 * song-explorations Track format (videoId, channelName, etc.).
 *
 * Returns [] if DATABASE_URL is not set or DB is unreachable.
 */
export async function loadDbSeedTracks(limit = 50): Promise<Track[]> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log.debug('DATABASE_URL not set — skipping DB seed load');
    return [];
  }

  try {
    // Dynamic import avoids loading pg when not needed
    const { getPool } = await import('../../db/pool.js');
    const pool = getPool();

    const result = await pool.query<MainDbTrackRow>(`
      SELECT
        youtube_url,
        title,
        artist,
        yt_channel,
        yt_channel_id,
        duration,
        created_at
      FROM tracks
      WHERE youtube_url IS NOT NULL
        AND youtube_url <> ''
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const seeds: Track[] = [];
    for (const row of result.rows) {
      const videoId = extractVideoId(row.youtube_url);
      if (!videoId) continue;

      seeds.push({
        videoId,
        title: row.title || 'Unknown',
        channelName: row.yt_channel || row.artist || 'Unknown',
        channelId: row.yt_channel_id || '',
        durationSeconds: row.duration ? Math.round(row.duration) : 0,
        addedAt: row.created_at instanceof Date
          ? (row.created_at as unknown as Date).toISOString()
          : row.created_at || new Date().toISOString(),
        source: { type: 'seed' },
        confidence: 1.0,
        plays: 0,
        lastPlayedAt: null,
      });
    }

    log.info(`Loaded ${seeds.length} seed tracks from main DB (out of ${result.rows.length} rows)`);
    return seeds;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Could not load DB seeds (non-fatal): ${msg}`);
    return [];
  }
}
