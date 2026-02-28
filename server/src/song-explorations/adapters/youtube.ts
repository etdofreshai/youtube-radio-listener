/**
 * Real YouTube Data API v3 adapter.
 *
 * Abstracted so it can be swapped for Cloud Code OAuth + Agent SDK later.
 * Requires YOUTUBE_API_KEY in env.
 */
import type { YouTubeAdapter, YouTubeSearchResult } from '../types.js';
import { log } from '../utils/logger.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export class LiveYouTubeAdapter implements YouTubeAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('YOUTUBE_API_KEY is required for live mode');
    this.apiKey = apiKey;
  }

  private async fetchApi(endpoint: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`${API_BASE}/${endpoint}`);
    url.searchParams.set('key', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    log.debug(`[youtube] GET ${endpoint}`, Object.keys(params));
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API ${res.status}: ${body}`);
    }
    return res.json();
  }

  private parseItems(items: any[]): YouTubeSearchResult[] {
    return items
      .filter((item: any) => item.id?.videoId || item.id?.kind === 'youtube#video' || typeof item.id === 'string')
      .map((item: any) => {
        const videoId = typeof item.id === 'string' ? item.id : item.id.videoId;
        const snippet = item.snippet ?? {};
        return {
          videoId,
          title: snippet.title ?? '',
          channelName: snippet.channelTitle ?? '',
          channelId: snippet.channelId ?? '',
          durationSeconds: 0, // Will be filled by getVideoDetails if needed
          publishedAt: snippet.publishedAt ?? '',
          thumbnailUrl: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? '',
        };
      });
  }

  async searchVideos(query: string, maxResults = 5): Promise<YouTubeSearchResult[]> {
    const data = await this.fetchApi('search', {
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10', // Music category
      maxResults: String(maxResults),
    });
    return this.parseItems(data.items ?? []);
  }

  async getRelatedVideos(videoId: string, maxResults = 5): Promise<YouTubeSearchResult[]> {
    // Note: relatedToVideoId was deprecated in Aug 2023.
    // Fallback: search with the video's title as query.
    const details = await this.getVideoDetails(videoId);
    if (!details) return [];
    return this.searchVideos(details.title, maxResults);
  }

  async getChannelVideos(channelId: string, maxResults = 5): Promise<YouTubeSearchResult[]> {
    const data = await this.fetchApi('search', {
      part: 'snippet',
      channelId,
      type: 'video',
      order: 'date',
      maxResults: String(maxResults),
    });
    return this.parseItems(data.items ?? []);
  }

  async getVideoDetails(videoId: string): Promise<YouTubeSearchResult | null> {
    const data = await this.fetchApi('videos', {
      part: 'snippet,contentDetails',
      id: videoId,
    });
    const item = data.items?.[0];
    if (!item) return null;

    const snippet = item.snippet ?? {};
    const duration = parseDuration(item.contentDetails?.duration ?? 'PT0S');

    return {
      videoId: item.id,
      title: snippet.title ?? '',
      channelName: snippet.channelTitle ?? '',
      channelId: snippet.channelId ?? '',
      durationSeconds: duration,
      publishedAt: snippet.publishedAt ?? '',
      thumbnailUrl: snippet.thumbnails?.high?.url ?? '',
    };
  }
}

/** Parse ISO 8601 duration (PT1H2M3S) to seconds */
function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] ?? '0', 10);
  const m = parseInt(match[2] ?? '0', 10);
  const s = parseInt(match[3] ?? '0', 10);
  return h * 3600 + m * 60 + s;
}
