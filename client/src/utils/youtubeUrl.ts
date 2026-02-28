/**
 * Client-side YouTube URL detection utilities.
 *
 * Provides robust classification of YouTube URLs into:
 *  - single_video   — standard watch/shorts/embed/live/youtu.be URLs
 *  - playlist       — /playlist?list=... URLs (pure playlist)
 *  - video_with_playlist — watch URLs that carry both v= and list= params
 *  - not_supported  — channel, user, etc.
 *  - invalid        — not a YouTube URL at all
 *
 * URLs containing BOTH v= and list= params are classified as
 * video_with_playlist and treated as playlist-import targets.
 */

export type YouTubeUrlKind =
  | 'single_video'
  | 'playlist'
  | 'video_with_playlist'
  | 'not_supported'
  | 'invalid';

export interface DetectedYouTubeUrl {
  kind: YouTubeUrlKind;
  videoId: string | null;
  playlistId: string | null;
}

const VALID_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);

function isYouTubeHost(hostname: string): boolean {
  return VALID_HOSTS.has(hostname.toLowerCase());
}

function extractVideoId(parsed: URL): string | null {
  const { hostname, pathname, searchParams } = parsed;

  // youtu.be/VIDEO_ID
  if (hostname === 'youtu.be') {
    const id = pathname.slice(1).split('/')[0];
    if (id && /^[a-zA-Z0-9_-]{6,}$/.test(id)) return id;
    return null;
  }

  // ?v=VIDEO_ID
  const v = searchParams.get('v');
  if (v && /^[a-zA-Z0-9_-]{6,}$/.test(v)) return v;

  // /embed/VIDEO_ID, /live/VIDEO_ID, /shorts/VIDEO_ID
  const m = pathname.match(/^\/(embed|live|shorts)\/([a-zA-Z0-9_-]{6,})/);
  if (m) return m[2];

  return null;
}

function extractPlaylistId(parsed: URL): string | null {
  const list = parsed.searchParams.get('list');
  if (list && /^[a-zA-Z0-9_-]+$/.test(list)) return list;
  return null;
}

/**
 * Detect the type of a YouTube URL.
 * Returns the kind plus extracted IDs.
 */
export function detectYouTubeUrl(url: string): DetectedYouTubeUrl {
  const trimmed = url.trim();
  if (!trimmed) return { kind: 'invalid', videoId: null, playlistId: null };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: 'invalid', videoId: null, playlistId: null };
  }

  if (!isYouTubeHost(parsed.hostname)) {
    return { kind: 'invalid', videoId: null, playlistId: null };
  }

  const { pathname } = parsed;

  // Channel / user → not supported
  if (pathname.match(/^\/@/) || pathname.match(/^\/channel\//) || pathname.match(/^\/user\//)) {
    return { kind: 'not_supported', videoId: null, playlistId: null };
  }

  const videoId = extractVideoId(parsed);
  const playlistId = extractPlaylistId(parsed);

  if (videoId && playlistId) {
    return { kind: 'video_with_playlist', videoId, playlistId };
  }

  if (playlistId) {
    return { kind: 'playlist', videoId: null, playlistId };
  }

  if (videoId) {
    return { kind: 'single_video', videoId, playlistId: null };
  }

  return { kind: 'not_supported', videoId: null, playlistId: null };
}

/**
 * Returns true if the URL should trigger playlist-import mode.
 * This includes both pure playlist URLs and watch URLs that carry a list= param.
 */
export function isPlaylistImportUrl(url: string): boolean {
  const { kind } = detectYouTubeUrl(url);
  return kind === 'playlist' || kind === 'video_with_playlist';
}
