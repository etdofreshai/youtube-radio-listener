/**
 * Mock YouTube adapter for dry-run mode.
 * Returns plausible fake data so the pipeline can be tested end-to-end
 * without any API key or network calls.
 */
import type { YouTubeAdapter, YouTubeSearchResult } from '../types.js';
import { log } from '../utils/logger.js';

const MOCK_POOL: YouTubeSearchResult[] = [
  {
    videoId: 'abc123def45',
    title: 'Dreamy Synths - Midnight Run (Official Video)',
    channelName: 'Dreamy Synths',
    channelId: 'UC_mock_dreamy',
    durationSeconds: 245,
    publishedAt: '2025-06-15T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/abc123def45/hqdefault.jpg',
  },
  {
    videoId: 'xyz789ghi01',
    title: 'Lo-Fi Chill Beats to Study To - 1 Hour Mix',
    channelName: 'ChillBeats Radio',
    channelId: 'UC_mock_chill',
    durationSeconds: 3600,
    publishedAt: '2025-09-01T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/xyz789ghi01/hqdefault.jpg',
  },
  {
    videoId: 'mno234pqr56',
    title: 'Indie Rock Band - New Single 2025',
    channelName: 'Indie Rock Band',
    channelId: 'UC_mock_indie',
    durationSeconds: 198,
    publishedAt: '2025-11-20T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/mno234pqr56/hqdefault.jpg',
  },
  {
    videoId: 'stu567vwx89',
    title: 'Guitar Tutorial - How to Play Wonderwall (NOT MUSIC)',
    channelName: 'Guitar Lessons 101',
    channelId: 'UC_mock_tutorial',
    durationSeconds: 900,
    publishedAt: '2025-03-10T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/stu567vwx89/hqdefault.jpg',
  },
  {
    videoId: 'jkl012mno34',
    title: 'Ambient Electronica - Deep Space Voyage',
    channelName: 'Ambient Voyager',
    channelId: 'UC_mock_ambient',
    durationSeconds: 320,
    publishedAt: '2025-08-05T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/jkl012mno34/hqdefault.jpg',
  },
  {
    videoId: 'pqr345stu67',
    title: 'Top 10 Worst Songs Ever (Compilation)',
    channelName: 'ListBuzz',
    channelId: 'UC_mock_listbuzz',
    durationSeconds: 720,
    publishedAt: '2025-07-22T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/pqr345stu67/hqdefault.jpg',
  },
  {
    videoId: 'vwx678yza90',
    title: 'Jazz Fusion - Late Night Sessions ft. Marcus',
    channelName: 'Jazz Collective',
    channelId: 'UC_mock_jazz',
    durationSeconds: 410,
    publishedAt: '2025-10-12T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/vwx678yza90/hqdefault.jpg',
  },
  {
    videoId: 'bcd901efg23',
    title: '30 Second Jingle - Ad Music',
    channelName: 'Ad Tunes',
    channelId: 'UC_mock_adtunes',
    durationSeconds: 30,
    publishedAt: '2025-04-01T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/bcd901efg23/hqdefault.jpg',
  },
  {
    videoId: 'hij456klm78',
    title: 'Synthwave Retro Drive - Neon Nights',
    channelName: 'RetroSynth',
    channelId: 'UC_mock_retro',
    durationSeconds: 275,
    publishedAt: '2026-01-05T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/hij456klm78/hqdefault.jpg',
  },
  {
    videoId: 'nop789qrs01',
    title: 'Classical Piano - Chopin Nocturne Op. 9 No. 2',
    channelName: 'Classical Masters',
    channelId: 'UC_mock_classical',
    durationSeconds: 280,
    publishedAt: '2024-12-01T00:00:00Z',
    thumbnailUrl: 'https://i.ytimg.com/vi/nop789qrs01/hqdefault.jpg',
  },
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export class MockYouTubeAdapter implements YouTubeAdapter {
  async searchVideos(query: string, maxResults = 5): Promise<YouTubeSearchResult[]> {
    log.debug(`[mock] searchVideos("${query}", ${maxResults})`);
    return pickRandom(MOCK_POOL, Math.min(maxResults, MOCK_POOL.length));
  }

  async getRelatedVideos(videoId: string, maxResults = 5): Promise<YouTubeSearchResult[]> {
    log.debug(`[mock] getRelatedVideos("${videoId}", ${maxResults})`);
    return pickRandom(MOCK_POOL, Math.min(maxResults, MOCK_POOL.length));
  }

  async getChannelVideos(channelId: string, maxResults = 5): Promise<YouTubeSearchResult[]> {
    log.debug(`[mock] getChannelVideos("${channelId}", ${maxResults})`);
    return pickRandom(MOCK_POOL, Math.min(maxResults, 3));
  }

  async getVideoDetails(videoId: string): Promise<YouTubeSearchResult | null> {
    log.debug(`[mock] getVideoDetails("${videoId}")`);
    return MOCK_POOL.find(v => v.videoId === videoId) ?? MOCK_POOL[0];
  }
}
