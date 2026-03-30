/**
 * Last.fm API Adapter
 *
 * Provides similar track/artist recommendations via Last.fm's free API.
 * Requires LASTFM_API_KEY environment variable.
 */

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';

export interface LastFmTrackMatch {
  artist: string;
  track: string;
  matchScore: number;
}

interface LastFmSimilarTrackResponse {
  similartracks?: {
    track?: Array<{
      name: string;
      match: string | number;
      artist: { name: string };
    }>;
  };
  error?: number;
  message?: string;
}

interface LastFmSimilarArtistResponse {
  similarartists?: {
    artist?: Array<{
      name: string;
      match: string | number;
    }>;
  };
  error?: number;
  message?: string;
}

function getApiKey(): string | undefined {
  return process.env.LASTFM_API_KEY;
}

/**
 * Get similar tracks from Last.fm for a given artist + track.
 * Returns an empty array on failure.
 */
export async function getSimilarTracks(
  artist: string,
  track: string,
  limit = 20
): Promise<LastFmTrackMatch[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[lastfm] LASTFM_API_KEY not set — skipping similar tracks lookup');
    return [];
  }

  try {
    const params = new URLSearchParams({
      method: 'track.getSimilar',
      artist,
      track,
      limit: String(limit),
      api_key: apiKey,
      format: 'json',
    });

    const url = `${LASTFM_API_BASE}?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`[lastfm] HTTP error ${res.status} for track.getSimilar`);
      return [];
    }

    const data = (await res.json()) as LastFmSimilarTrackResponse;

    if (data.error) {
      console.error(`[lastfm] API error ${data.error}: ${data.message}`);
      return [];
    }

    return (data.similartracks?.track ?? []).map((t) => ({
      artist: t.artist.name,
      track: t.name,
      matchScore: typeof t.match === 'string' ? parseFloat(t.match) : t.match,
    }));
  } catch (err) {
    console.error('[lastfm] getSimilarTracks error:', err);
    return [];
  }
}

/**
 * Get similar artists from Last.fm.
 * Returns an empty array on failure.
 */
export async function getSimilarArtists(
  artist: string,
  limit = 10
): Promise<LastFmTrackMatch[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[lastfm] LASTFM_API_KEY not set — skipping similar artists lookup');
    return [];
  }

  try {
    const params = new URLSearchParams({
      method: 'artist.getSimilar',
      artist,
      limit: String(limit),
      api_key: apiKey,
      format: 'json',
    });

    const url = `${LASTFM_API_BASE}?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`[lastfm] HTTP error ${res.status} for artist.getSimilar`);
      return [];
    }

    const data = (await res.json()) as LastFmSimilarArtistResponse;

    if (data.error) {
      console.error(`[lastfm] API error ${data.error}: ${data.message}`);
      return [];
    }

    return (data.similarartists?.artist ?? []).map((a) => ({
      artist: a.name,
      track: '',
      matchScore: typeof a.match === 'string' ? parseFloat(a.match) : a.match,
    }));
  } catch (err) {
    console.error('[lastfm] getSimilarArtists error:', err);
    return [];
  }
}
