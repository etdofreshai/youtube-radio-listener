/**
 * YouTube metadata fetcher — extracts video info via yt-dlp.
 *
 * Reuses the same yt-dlp --dump-json approach as the enrichment pipeline,
 * but exposed as a standalone utility for use at track creation time.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { ytDlpAvailable, ytDlpBin } from '../deps';

const execFileAsync = promisify(execFile);

export interface YouTubeVideoInfo {
  videoTitle: string;
  channel: string | null;
  channelId: string | null;
  uploadDate: string | null;   // YYYY-MM-DD
  description: string | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  duration: number | null;     // seconds
  album: string | null;
  genre: string | null;
  releaseYear: number | null;
}

export interface ParsedTrackInfo {
  title: string;
  artist: string;
}

// Known "noise" suffixes to strip from YouTube titles
const NOISE_PATTERNS = [
  /\s*[\(\[]\s*(?:official\s+)?(?:music\s+)?video\s*[\)\]]/gi,
  /\s*[\(\[]\s*(?:official\s+)?audio\s*[\)\]]/gi,
  /\s*[\(\[]\s*(?:official\s+)?lyric(?:s)?\s*(?:video)?\s*[\)\]]/gi,
  /\s*[\(\[]\s*(?:official\s+)?visuali[sz]er\s*[\)\]]/gi,
  /\s*[\(\[]\s*(?:hd|hq|4k|1080p|720p)\s*[\)\]]/gi,
  /\s*[\(\[]\s*explicit\s*[\)\]]/gi,
  /\s*[\(\[]\s*prod\.?\s+(?:by\s+)?.+?[\)\]]/gi,
  /\s*\|\s*official\s+.*$/gi,
];

/**
 * Heuristically parse "Artist - Title" from a YouTube video title + channel.
 *
 * Common patterns:
 *   "Artist - Title"
 *   "Artist — Title"
 *   "Artist : Title"
 *   "Title" (channel used as artist)
 */
export function parseArtistTitle(videoTitle: string, channel: string | null): ParsedTrackInfo {
  let cleaned = videoTitle.trim();

  // Strip known noise
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.trim();

  // Try "Artist - Title" pattern (hyphen, en-dash, em-dash)
  const separators = [' - ', ' – ', ' — ', ' // '];
  for (const sep of separators) {
    const idx = cleaned.indexOf(sep);
    if (idx > 0 && idx < cleaned.length - sep.length) {
      const artist = cleaned.slice(0, idx).trim();
      const title = cleaned.slice(idx + sep.length).trim();
      if (artist.length > 0 && title.length > 0) {
        return { artist, title };
      }
    }
  }

  // Try "Artist: Title" (only if colon is not part of time code like "1:30")
  const colonIdx = cleaned.indexOf(': ');
  if (colonIdx > 2 && colonIdx < cleaned.length - 2) {
    const beforeColon = cleaned.slice(0, colonIdx);
    // Ensure it's not a time code
    if (!/^\d+$/.test(beforeColon) && !/\d:\d/.test(beforeColon)) {
      const artist = beforeColon.trim();
      const title = cleaned.slice(colonIdx + 2).trim();
      if (artist.length > 0 && title.length > 0) {
        return { artist, title };
      }
    }
  }

  // No separator found — use channel as artist, video title as title
  return {
    artist: channel || 'Unknown Artist',
    title: cleaned || videoTitle.trim(),
  };
}

/**
 * Validate that a string looks like a YouTube URL.
 */
export function isValidYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const validHosts = [
      'www.youtube.com', 'youtube.com', 'm.youtube.com',
      'youtu.be', 'music.youtube.com',
      'www.youtube-nocookie.com',
    ];
    return validHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Fetch video metadata from YouTube via yt-dlp --dump-json.
 * Throws on failure (invalid URL, network issues, etc.).
 */
export async function fetchYouTubeMetadata(youtubeUrl: string): Promise<YouTubeVideoInfo> {
  if (!isValidYouTubeUrl(youtubeUrl)) {
    throw new Error(`Invalid YouTube URL: ${youtubeUrl}`);
  }

  if (!ytDlpAvailable()) {
    throw new Error('yt-dlp is not available. Cannot fetch YouTube metadata.');
  }

  const { stdout } = await execFileAsync(ytDlpBin(), [
    '--dump-json',
    '--no-playlist',
    '--no-download',
    '--no-warnings',
    youtubeUrl,
  ], { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });

  const info = JSON.parse(stdout);

  let uploadDate: string | null = null;
  if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
    const d = info.upload_date;
    uploadDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }

  return {
    videoTitle: info.title || info.fulltitle || '',
    channel: info.channel || info.uploader || null,
    channelId: info.channel_id || info.uploader_id || null,
    uploadDate,
    description: info.description ? info.description.slice(0, 2000) : null,
    thumbnailUrl: info.thumbnail || null,
    viewCount: typeof info.view_count === 'number' ? info.view_count : null,
    likeCount: typeof info.like_count === 'number' ? info.like_count : null,
    duration: typeof info.duration === 'number' && info.duration > 0 ? Math.round(info.duration) : null,
    album: info.album || null,
    genre: info.genre || null,
    releaseYear: info.release_year || null,
  };
}
