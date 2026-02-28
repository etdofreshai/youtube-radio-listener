/**
 * YouTube URL Detection and Parsing Utilities
 *
 * Provides robust detection of YouTube URL types (single video, playlist, etc.)
 * and extraction of video/playlist IDs from various YouTube URL formats.
 */

export enum YouTubeUrlType {
  /** Single video URL (watch, youtu.be, embed, live) */
  SINGLE_VIDEO = 'single_video',
  /** Playlist URL (playlist?list=...) */
  PLAYLIST = 'playlist',
  /** Video URL that's part of a playlist (watch?v=...&list=...) */
  VIDEO_WITH_PLAYLIST = 'video_with_playlist',
  /** Unsupported URL type (channel, user, etc.) */
  NOT_SUPPORTED = 'not_supported',
  /** Not a valid YouTube URL */
  INVALID = 'invalid',
}

export interface YouTubeUrlInfo {
  type: YouTubeUrlType;
  videoId: string | null;
  playlistId: string | null;
  originalUrl: string;
}

const VALID_YOUTUBE_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
];

/**
 * Check if a hostname is a valid YouTube domain
 */
function isValidYouTubeHost(hostname: string): boolean {
  return VALID_YOUTUBE_HOSTS.includes(hostname.toLowerCase());
}

/**
 * Extract video ID from a YouTube URL.
 * Supports multiple URL formats:
 * - youtube.com/watch?v=VIDEO_ID
 * - youtu.be/VIDEO_ID
 * - youtube.com/embed/VIDEO_ID
 * - youtube.com/live/VIDEO_ID
 * - youtube.com/shorts/VIDEO_ID
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (!isValidYouTubeHost(parsed.hostname)) {
      return null;
    }

    // youtu.be short URLs
    if (parsed.hostname === 'youtu.be') {
      const pathId = parsed.pathname.slice(1).split('/')[0];
      if (pathId && /^[a-zA-Z0-9_-]{6,}$/.test(pathId)) {
        return pathId;
      }
      return null;
    }

    // Standard watch URL
    const vParam = parsed.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{6,}$/.test(vParam)) {
      return vParam;
    }

    // Embed URL: /embed/VIDEO_ID
    const embedMatch = parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,})/);
    if (embedMatch) {
      return embedMatch[1];
    }

    // Live URL: /live/VIDEO_ID
    const liveMatch = parsed.pathname.match(/^\/live\/([a-zA-Z0-9_-]{6,})/);
    if (liveMatch) {
      return liveMatch[1];
    }

    // Shorts URL: /shorts/VIDEO_ID
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
    if (shortsMatch) {
      return shortsMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract playlist ID from a YouTube URL.
 * Supports:
 * - youtube.com/playlist?list=PLAYLIST_ID
 * - youtube.com/watch?v=...&list=PLAYLIST_ID
 */
export function extractPlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (!isValidYouTubeHost(parsed.hostname)) {
      return null;
    }

    const listParam = parsed.searchParams.get('list');
    if (listParam) {
      // YouTube playlist IDs typically start with PL, UU, LL, RD, etc.
      // But we'll accept any alphanumeric string with underscores and hyphens
      if (/^[a-zA-Z0-9_-]+$/.test(listParam)) {
        return listParam;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the type of YouTube URL and extract relevant IDs.
 * This is the main entry point for URL classification.
 */
export function detectYouTubeUrlType(url: string): YouTubeUrlInfo {
  const trimmedUrl = url.trim();

  // Basic validation
  if (!trimmedUrl) {
    return {
      type: YouTubeUrlType.INVALID,
      videoId: null,
      playlistId: null,
      originalUrl: url,
    };
  }

  try {
    const parsed = new URL(trimmedUrl);

    if (!isValidYouTubeHost(parsed.hostname)) {
      return {
        type: YouTubeUrlType.INVALID,
        videoId: null,
        playlistId: null,
        originalUrl: url,
      };
    }

    // Check for unsupported URL types first
    // Channel URLs: /@channelname or /channel/CHANNEL_ID
    if (parsed.pathname.match(/^\/@/) || parsed.pathname.match(/^\/channel\//)) {
      return {
        type: YouTubeUrlType.NOT_SUPPORTED,
        videoId: null,
        playlistId: null,
        originalUrl: url,
      };
    }

    // User URLs: /user/username
    if (parsed.pathname.match(/^\/user\//)) {
      return {
        type: YouTubeUrlType.NOT_SUPPORTED,
        videoId: null,
        playlistId: null,
        originalUrl: url,
      };
    }

    // Extract both video and playlist IDs
    const videoId = extractVideoId(trimmedUrl);
    const playlistId = extractPlaylistId(trimmedUrl);

    // Classify based on what we found
    if (videoId && playlistId) {
      // URL contains both video and playlist
      return {
        type: YouTubeUrlType.VIDEO_WITH_PLAYLIST,
        videoId,
        playlistId,
        originalUrl: url,
      };
    }

    if (playlistId) {
      // Pure playlist URL (no specific video)
      // This handles /playlist?list=... URLs
      if (parsed.pathname === '/playlist' || parsed.pathname.startsWith('/playlist/')) {
        return {
          type: YouTubeUrlType.PLAYLIST,
          videoId: null,
          playlistId,
          originalUrl: url,
        };
      }

      // Watch URL with playlist - prefer playlist interpretation for batch import
      return {
        type: YouTubeUrlType.PLAYLIST,
        videoId: null,
        playlistId,
        originalUrl: url,
      };
    }

    if (videoId) {
      // Single video URL
      return {
        type: YouTubeUrlType.SINGLE_VIDEO,
        videoId,
        playlistId: null,
        originalUrl: url,
      };
    }

    // YouTube URL but couldn't extract meaningful IDs
    return {
      type: YouTubeUrlType.NOT_SUPPORTED,
      videoId: null,
      playlistId: null,
      originalUrl: url,
    };
  } catch {
    return {
      type: YouTubeUrlType.INVALID,
      videoId: null,
      playlistId: null,
      originalUrl: url,
    };
  }
}

/**
 * Type guard to check if a URL is a valid single video URL
 */
export function isSingleVideoUrl(url: string): boolean {
  const info = detectYouTubeUrlType(url);
  return info.type === YouTubeUrlType.SINGLE_VIDEO;
}

/**
 * Type guard to check if a URL is a playlist URL (including video-with-playlist)
 */
export function isPlaylistUrl(url: string): boolean {
  const info = detectYouTubeUrlType(url);
  return info.type === YouTubeUrlType.PLAYLIST || info.type === YouTubeUrlType.VIDEO_WITH_PLAYLIST;
}

/**
 * Build a canonical YouTube watch URL from a video ID
 */
export function buildWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Build a canonical YouTube playlist URL from a playlist ID
 */
export function buildPlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}
