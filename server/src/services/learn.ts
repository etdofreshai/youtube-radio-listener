/**
 * Learning Resources Service
 *
 * Searches for guitar tabs, chords, piano sheets, and tutorials for tracks.
 * Uses web search to find publicly available learning resources.
 * Caches results to avoid repeated searches.
 *
 * Safety: Only stores links and metadata — user opens external sources.
 */

import * as store from '../store';
import type {
  Track,
  LearningResource,
  LearningResourceType,
  LearningResourceConfidence,
  LearningResourceGrouped,
  SearchLearningResourcesResult,
} from '../types';

// Known safe providers (whitelist for confidence boosting)
const TRUSTED_PROVIDERS = new Set([
  'ultimate-guitar.com',
  'tabs.ultimate-guitar.com',
  'songsterr.com',
  'chords-and-tabs.net',
  'azchords.com',
  'e-chords.com',
  'musescore.com',
  'musicnotes.com',
  'sheetmusic-plus.com',
  '8notes.com',
  'pianote.com',
  'flowkey.com',
  'youtube.com',
  'youtu.be',
  'justinguitar.com',
  'martyzsongs.com',
  'andyguitar.co.uk',
]);

// Search query templates by type
const SEARCH_QUERIES: Record<LearningResourceType, string[]> = {
  'guitar-tabs': ['{title} {artist} guitar tab', '{title} {artist} guitar tablature'],
  'guitar-chords': ['{title} {artist} chords', '{title} {artist} guitar chords', '{title} {artist} lyrics chords'],
  'piano-keys': ['{title} {artist} piano chords', '{title} {artist} piano tutorial', '{title} {artist} keyboard'],
  'sheet-music': ['{title} {artist} sheet music', '{title} {artist} piano sheet', '{title} {artist} score'],
  'tutorial': ['{title} {artist} guitar tutorial', '{title} {artist} how to play', '{title} {artist} lesson'],
};

// Extract domain from URL for provider name
function extractProvider(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    return host;
  } catch {
    return 'unknown';
  }
}

// Determine confidence based on URL patterns and provider
function calculateConfidence(url: string, title: string, query: string): LearningResourceConfidence {
  const provider = extractProvider(url);
  const lowerTitle = title.toLowerCase();
  const lowerUrl = url.toLowerCase();

  // Boost trusted providers
  if (TRUSTED_PROVIDERS.has(provider)) {
    return 'high';
  }

  // Check for relevant keywords in title/URL
  const relevantKeywords = ['tab', 'chord', 'sheet', 'tutorial', 'lesson', 'how to play', 'cover'];
  const hasRelevantKeyword = relevantKeywords.some(k => lowerTitle.includes(k) || lowerUrl.includes(k));

  // Check for "official" in title
  const isOfficial = lowerTitle.includes('official');

  if (hasRelevantKeyword && isOfficial) {
    return 'high';
  } else if (hasRelevantKeyword) {
    return 'medium';
  }

  return 'low';
}

// Normalize and deduplicate resources by URL
function dedupeResources(resources: LearningResource[]): LearningResource[] {
  const seen = new Map<string, LearningResource>();
  for (const r of resources) {
    const key = r.url;
    if (!seen.has(key)) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}

// Filter out junk/low-quality results
function filterJunk(resources: LearningResource[]): LearningResource[] {
  return resources.filter(r => {
    const lowerTitle = r.title.toLowerCase();
    const lowerUrl = r.url.toLowerCase();

    // Filter out obviously irrelevant results
    const junkPatterns = [
      /buy\s+mp3/i,
      /stream\s+on\s+spotify/i,
      /download\s+ringtone/i,
      /free\s+download$/i,
      /mp3\s+download/i,
    ];

    if (junkPatterns.some(p => p.test(lowerTitle))) {
      return false;
    }

    // Keep results with learning-related keywords or from trusted providers
    const learningKeywords = ['tab', 'chord', 'sheet', 'tutorial', 'lesson', 'how to', 'play', 'learn', 'cover', 'score'];
    const hasLearningKeyword = learningKeywords.some(k => lowerTitle.includes(k) || lowerUrl.includes(k));
    const isTrustedProvider = TRUSTED_PROVIDERS.has(r.provider);

    return hasLearningKeyword || isTrustedProvider;
  });
}

// Sort resources by confidence then by saved status
function sortResources(resources: LearningResource[]): LearningResource[] {
  const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return resources.sort((a, b) => {
    // Saved items first
    if (a.isSaved !== b.isSaved) return a.isSaved ? -1 : 1;
    // Then by confidence
    const aConf = a.confidence || 'low';
    const bConf = b.confidence || 'low';
    return confidenceOrder[aConf] - confidenceOrder[bConf];
  });
}

// Group resources by type
function groupResources(resources: LearningResource[]): LearningResourceGrouped {
  const grouped: LearningResourceGrouped = {
    guitarTabs: [],
    guitarChords: [],
    pianoKeys: [],
    sheetMusic: [],
    tutorials: [],
  };

  for (const r of resources) {
    switch (r.resourceType) {
      case 'guitar-tabs':
        grouped.guitarTabs.push(r);
        break;
      case 'guitar-chords':
        grouped.guitarChords.push(r);
        break;
      case 'piano-keys':
        grouped.pianoKeys.push(r);
        break;
      case 'sheet-music':
        grouped.sheetMusic.push(r);
        break;
      case 'tutorial':
        grouped.tutorials.push(r);
        break;
    }
  }

  // Sort each group
  grouped.guitarTabs = sortResources(grouped.guitarTabs);
  grouped.guitarChords = sortResources(grouped.guitarChords);
  grouped.pianoKeys = sortResources(grouped.pianoKeys);
  grouped.sheetMusic = sortResources(grouped.sheetMusic);
  grouped.tutorials = sortResources(grouped.tutorials);

  return grouped;
}

/**
 * Generate search queries for a track
 */
export function generateSearchQueries(track: Track): Map<LearningResourceType, string[]> {
  const queries = new Map<LearningResourceType, string[]>();
  const title = track.title || '';
  const artist = track.artist || '';

  for (const [type, templates] of Object.entries(SEARCH_QUERIES)) {
    const typeQueries = templates.map(t =>
      t.replace('{title}', title).replace('{artist}', artist).trim()
    ).filter(q => q.length > 3);
    queries.set(type as LearningResourceType, typeQueries);
  }

  return queries;
}

/**
 * Search for learning resources for a track.
 * First checks cache, then searches if needed.
 */
export async function searchLearningResources(trackId: string): Promise<SearchLearningResourcesResult> {
  const track = await store.getTrack(trackId);
  if (!track) {
    throw new Error('Track not found');
  }

  // Check for cached resources (within TTL)
  const cachedResources = await store.getCachedLearningResources(trackId);
  const now = new Date();
  const cacheTtlMs = 24 * 60 * 60 * 1000; // 24 hours

  // Check if we have fresh cached results
  let isCacheFresh = false;
  if (cachedResources.length > 0) {
    const newestCached = cachedResources.reduce((a, b) =>
      new Date(a.createdAt) > new Date(b.createdAt) ? a : b
    );
    const cachedAt = new Date(newestCached.createdAt);
    isCacheFresh = (now.getTime() - cachedAt.getTime()) < cacheTtlMs;
  }

  if (isCacheFresh) {
    // Return cached results
    const grouped = groupResources(cachedResources);
    return {
      trackId,
      searchQuery: cachedResources[0]?.searchQuery || `${track.title} ${track.artist}`,
      cached: true,
      searchedAt: cachedResources[0]?.createdAt || now.toISOString(),
      resources: grouped,
    };
  }

  // Perform actual search via web search
  const queries = generateSearchQueries(track);
  const primaryQuery = `${track.title} ${track.artist} guitar chords tabs`;
  const allResources: LearningResource[] = [];

  try {
    // Search for learning resources using a combined query
    const searchResults = await performWebSearch(primaryQuery);

    for (const result of searchResults) {
      // Determine resource type from URL/title
      const resourceType = inferResourceType(result.title, result.url);

      const resource: LearningResource = {
        id: '', // Will be assigned by store
        trackId,
        resourceType,
        title: result.title,
        provider: extractProvider(result.url),
        url: result.url,
        snippet: result.snippet || null,
        confidence: calculateConfidence(result.url, result.title, primaryQuery),
        isSaved: false,
        searchQuery: primaryQuery,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      allResources.push(resource);
    }

    // Filter and dedupe
    const filtered = filterJunk(dedupeResources(allResources));

    // Clear old cached results and store new ones
    await store.clearCachedLearningResources(trackId);
    const savedResources = await store.createLearningResources(trackId, filtered, primaryQuery);

    const grouped = groupResources(savedResources);

    return {
      trackId,
      searchQuery: primaryQuery,
      cached: false,
      searchedAt: now.toISOString(),
      resources: grouped,
    };
  } catch (err) {
    console.error(`[learn] Search failed for track ${trackId}:`, err);

    // If we have stale cached results, return those
    if (cachedResources.length > 0) {
      const grouped = groupResources(cachedResources);
      return {
        trackId,
        searchQuery: cachedResources[0]?.searchQuery || primaryQuery,
        cached: true,
        searchedAt: cachedResources[0]?.createdAt || now.toISOString(),
        resources: grouped,
      };
    }

    throw err;
  }
}

/**
 * Infer resource type from title and URL
 */
function inferResourceType(title: string, url: string): LearningResourceType {
  const lowerTitle = title.toLowerCase();
  const lowerUrl = url.toLowerCase();
  const combined = `${lowerTitle} ${lowerUrl}`;

  // Check for tab-specific patterns
  if (/\btab\b/.test(combined) && !/chord/.test(combined)) {
    return 'guitar-tabs';
  }

  // Check for sheet music
  if (/sheet\s*music|score|notation/.test(combined)) {
    return 'sheet-music';
  }

  // Check for piano/keyboard
  if (/piano|keyboard|keys\b/.test(combined)) {
    return 'piano-keys';
  }

  // Check for tutorials
  if (/tutorial|lesson|how to play|learn to play|cover lesson/.test(combined)) {
    return 'tutorial';
  }

  // Default to guitar chords (most common)
  return 'guitar-chords';
}

/**
 * Perform a web search for learning resources.
 * Uses Brave Search API via the openclaw stack.
 */
interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function performWebSearch(query: string): Promise<WebSearchResult[]> {
  // Try to use the internal search capability
  // For now, return empty - will be enhanced when web search is available
  // In production, this would call Brave Search API or similar

  // Use mock results for development/testing
  if (process.env.NODE_ENV === 'test' || process.env.MOCK_LEARN_SEARCH === 'true') {
    return getMockSearchResults(query);
  }

  // Try to fetch from a search endpoint if configured
  const searchApiUrl = process.env.SEARCH_API_URL;
  const searchApiKey = process.env.SEARCH_API_KEY;

  if (!searchApiUrl) {
    console.warn('[learn] No SEARCH_API_URL configured, returning empty results');
    return [];
  }

  try {
    const response = await fetch(`${searchApiUrl}?q=${encodeURIComponent(query)}&count=20`, {
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': searchApiKey || '',
      },
    });

    if (!response.ok) {
      throw new Error(`Search API returned ${response.status}`);
    }

    const data: any = await response.json();

    // Handle Brave Search API format
    if (data.web?.results) {
      return data.web.results.map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || '',
      }));
    }

    // Handle generic format
    if (Array.isArray(data.results)) {
      return data.results.map((r: any) => ({
        title: r.title || '',
        url: r.url || r.link || '',
        snippet: r.snippet || r.description || '',
      }));
    }

    return [];
  } catch (err) {
    console.error('[learn] Web search failed:', err);
    return [];
  }
}

/**
 * Mock search results for testing
 */
function getMockSearchResults(query: string): WebSearchResult[] {
  const lowerQuery = query.toLowerCase();
  const results: WebSearchResult[] = [];

  // Generate realistic mock results based on query patterns
  if (lowerQuery.includes('tab') || lowerQuery.includes('guitar')) {
    results.push(
      {
        title: `${query} Guitar Tab | Ultimate Guitar`,
        url: `https://tabs.ultimate-guitar.com/tab/${query.replace(/\s+/g, '-').toLowerCase()}`,
        snippet: 'Official guitar tab with accurate transcription. Includes standard notation and tablature.',
      },
      {
        title: `${query} - Songsterr Tabs`,
        url: `https://www.songsterr.com/a/wsa/${query.replace(/\s+/g, '-').toLowerCase()}-tab`,
        snippet: 'Interactive guitar tab with playback. Learn to play with synchronized audio.',
      }
    );
  }

  if (lowerQuery.includes('chord')) {
    results.push(
      {
        title: `${query} Chords | Ultimate Guitar`,
        url: `https://tabs.ultimate-guitar.com/tab/${query.replace(/\s+/g, '-').toLowerCase()}-chords`,
        snippet: 'Chord diagrams with lyrics. Easy to follow chord progression.',
      },
      {
        title: `${query} - E-Chords`,
        url: `https://www.e-chords.com/chords/${query.replace(/\s+/g, '-').toLowerCase()}`,
        snippet: 'Complete chord chart with variations and voicings.',
      }
    );
  }

  if (lowerQuery.includes('piano') || lowerQuery.includes('keyboard')) {
    results.push(
      {
        title: `${query} Piano Chords Tutorial`,
        url: `https://www.flowkey.com/en/s/${query.replace(/\s+/g, '-').toLowerCase()}`,
        snippet: 'Learn to play on piano with interactive lessons.',
      }
    );
  }

  if (lowerQuery.includes('tutorial') || lowerQuery.includes('how to')) {
    results.push(
      {
        title: `How to Play ${query} - Guitar Tutorial`,
        url: `https://www.youtube.com/watch?v=example123`,
        snippet: 'Step by step guitar tutorial with on-screen tabs.',
      }
    );
  }

  return results;
}

// Export for testing
export { extractProvider, calculateConfidence, filterJunk, dedupeResources, groupResources, inferResourceType };
