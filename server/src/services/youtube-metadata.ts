/**
 * YouTube metadata fetcher — extracts video info via yt-dlp.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { ytDlpAvailable, ytDlpBin } from '../deps';

const execFileAsync = promisify(execFile);

export interface YouTubeVideoInfo {
  videoTitle: string;
  channel: string | null;
  channelId: string | null;
  uploadDate: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  duration: number | null;
  album: string | null;
  genre: string | null;
  releaseYear: number | null;
  isLive: boolean;
}

export interface ParsedTrackInfo {
  title: string;
  artist: string;
}

export type YouTubeUrlKind = 'video' | 'playlist' | 'invalid';

export interface YouTubeUrlAnalysis {
  kind: YouTubeUrlKind;
  inputUrl: string;
  normalizedUrl: string | null;
  videoId: string | null;
  playlistId: string | null;
  hasVideo: boolean;
  hasPlaylist: boolean;
}

export interface YouTubePlaylistItem {
  videoId: string;
  youtubeUrl: string;
  title: string;
  channel: string | null;
  position: number;
}

export interface YouTubePlaylistInfo {
  sourceUrl: string;
  playlistId: string | null;
  playlistTitle: string | null;
  totalAvailable: number;
  truncated: boolean;
  limit: number;
  items: YouTubePlaylistItem[];
}

const VALID_YOUTUBE_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
  'www.youtube-nocookie.com',
] as const;

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

export function parseArtistTitle(videoTitle: string, channel: string | null): ParsedTrackInfo {
  let cleaned = videoTitle.trim();

  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.trim();

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

  const colonIdx = cleaned.indexOf(': ');
  if (colonIdx > 2 && colonIdx < cleaned.length - 2) {
    const beforeColon = cleaned.slice(0, colonIdx);
    if (!/^\d+$/.test(beforeColon) && !/\d:\d/.test(beforeColon)) {
      const artist = beforeColon.trim();
      const title = cleaned.slice(colonIdx + 2).trim();
      if (artist.length > 0 && title.length > 0) {
        return { artist, title };
      }
    }
  }

  return {
    artist: channel || 'Unknown Artist',
    title: cleaned || videoTitle.trim(),
  };
}

export function isValidYouTubeUrl(url: string): boolean {
  return analyzeYouTubeUrl(url).kind !== 'invalid';
}

export function extractYouTubeVideoId(parsed: URL): string | null {
  if (parsed.hostname === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0] || null;
    return id || null;
  }

  const fromQuery = parsed.searchParams.get('v');
  if (fromQuery) return fromQuery;

  const pathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
  if (pathMatch?.[1]) return pathMatch[1];

  return null;
}

export function analyzeYouTubeUrl(inputUrl: string): YouTubeUrlAnalysis {
  const trimmed = (inputUrl || '').trim();

  if (!trimmed) {
    return {
      kind: 'invalid',
      inputUrl,
      normalizedUrl: null,
      videoId: null,
      playlistId: null,
      hasVideo: false,
      hasPlaylist: false,
    };
  }

  try {
    const parsed = new URL(trimmed);

    if (!VALID_YOUTUBE_HOSTS.includes(parsed.hostname as any)) {
      return {
        kind: 'invalid',
        inputUrl,
        normalizedUrl: null,
        videoId: null,
        playlistId: null,
        hasVideo: false,
        hasPlaylist: false,
      };
    }

    const playlistId = parsed.searchParams.get('list');
    const videoId = extractYouTubeVideoId(parsed);

    const hasPlaylist = !!(playlistId && playlistId.trim().length > 0);
    const hasVideo = !!(videoId && videoId.trim().length > 0);

    if (hasPlaylist) {
      return {
        kind: 'playlist',
        inputUrl,
        normalizedUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId!)}`,
        videoId: videoId || null,
        playlistId: playlistId || null,
        hasVideo,
        hasPlaylist,
      };
    }

    if (hasVideo) {
      return {
        kind: 'video',
        inputUrl,
        normalizedUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId!)}`,
        videoId: videoId || null,
        playlistId: null,
        hasVideo,
        hasPlaylist,
      };
    }

    return {
      kind: 'invalid',
      inputUrl,
      normalizedUrl: null,
      videoId: null,
      playlistId: playlistId || null,
      hasVideo,
      hasPlaylist,
    };
  } catch {
    return {
      kind: 'invalid',
      inputUrl,
      normalizedUrl: null,
      videoId: null,
      playlistId: null,
      hasVideo: false,
      hasPlaylist: false,
    };
  }
}

export interface YouTubeSearchResultItem {
  videoId: string;
  title: string;
  channel: string;
  channelId: string | null;
  duration: number | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  youtubeUrl: string;
}

export async function searchYouTube(query: string, maxResults = 10): Promise<YouTubeSearchResultItem[]> {
  if (!query || !query.trim()) {
    throw new Error('Search query is required');
  }

  if (!ytDlpAvailable()) {
    throw new Error('yt-dlp is not available. Cannot search YouTube.');
  }

  const count = Math.min(Math.max(1, maxResults), 20);

  const { stdout } = await execFileAsync(ytDlpBin(), [
    `ytsearch${count}:${query.trim()}`,
    '--dump-json',
    '--no-download',
    '--flat-playlist',
    '--no-warnings',
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });

  const lines = stdout.trim().split('\n').filter(Boolean);
  const results: YouTubeSearchResultItem[] = [];

  for (const line of lines) {
    try {
      const info = JSON.parse(line);
      const videoId = info.id;
      if (!videoId) continue;

      results.push({
        videoId,
        title: info.title || '',
        channel: info.channel || info.uploader || '',
        channelId: info.channel_id || null,
        duration: typeof info.duration === 'number' && info.duration > 0 ? Math.round(info.duration) : null,
        thumbnailUrl: pickBestThumbnail(info.thumbnails) || null,
        viewCount: typeof info.view_count === 'number' ? info.view_count : null,
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      });
    } catch {
      // skip malformed lines
    }
  }

  return results;
}

export async function fetchYouTubePlaylistItems(
  youtubeUrl: string,
  options?: { maxItems?: number },
): Promise<YouTubePlaylistInfo> {
  const analysis = analyzeYouTubeUrl(youtubeUrl);
  if (analysis.kind !== 'playlist') {
    throw new Error(`Not a YouTube playlist URL: ${youtubeUrl}`);
  }

  if (!ytDlpAvailable()) {
    throw new Error('yt-dlp is not available. Cannot fetch YouTube playlist.');
  }

  const limit = Math.max(1, Math.min(500, options?.maxItems ?? 500));

  const { stdout } = await execFileAsync(ytDlpBin(), [
    '--dump-single-json',
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    '--playlist-end', String(limit),
    youtubeUrl,
  ], { timeout: 60_000, maxBuffer: 25 * 1024 * 1024 });

  const info = JSON.parse(stdout || '{}');
  const entries = Array.isArray(info.entries) ? info.entries : [];

  const seenVideoIds = new Set<string>();
  const items: YouTubePlaylistItem[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const videoIdRaw = entry?.id;

    if (typeof videoIdRaw !== 'string' || !videoIdRaw.trim()) continue;
    const videoId = videoIdRaw.trim();

    if (seenVideoIds.has(videoId)) continue;
    seenVideoIds.add(videoId);

    items.push({
      videoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: typeof entry?.title === 'string' ? entry.title : '',
      channel:
        typeof entry?.channel === 'string'
          ? entry.channel
          : typeof entry?.uploader === 'string'
            ? entry.uploader
            : null,
      position: items.length + 1,
    });
  }

  const playlistCount =
    typeof info.playlist_count === 'number' && info.playlist_count > 0
      ? info.playlist_count
      : typeof info.n_entries === 'number' && info.n_entries > 0
        ? info.n_entries
        : items.length;

  return {
    sourceUrl: youtubeUrl,
    playlistId: analysis.playlistId,
    playlistTitle: typeof info.title === 'string' ? info.title : null,
    totalAvailable: playlistCount,
    truncated: playlistCount > items.length,
    limit,
    items,
  };
}

function pickBestThumbnail(thumbnails: any): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const sorted = [...thumbnails]
    .filter((t: any) => t.url)
    .sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || thumbnails[0]?.url || null;
}

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
    isLive: !!(info.is_live || info.was_live),
  };
}
