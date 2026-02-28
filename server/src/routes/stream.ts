/**
 * Live stream proxy route — resolves and proxies playable audio URLs for
 * live YouTube streams at play time.
 *
 * Similar to the preview route but designed for live stream tracks stored
 * in the library. Uses yt-dlp to resolve short-lived CDN URLs and proxies
 * the audio stream to the client.
 */

import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { ytDlpAvailable, ytDlpBin } from '../deps';
import * as store from '../store';

const execFileAsync = promisify(execFile);
const router = Router();

// ── URL cache ──────────────────────────────────────────────
// Live stream URLs expire quickly; cache for 5 min to avoid repeated yt-dlp calls
interface CachedUrl { url: string; resolvedAt: number }
const urlCache = new Map<string, CachedUrl>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Active resolutions to avoid duplicate yt-dlp processes for the same track
const pendingResolutions = new Map<string, Promise<string>>();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Resolve a playable stream URL for a live YouTube stream.
 * Returns the direct CDN URL for the audio stream.
 */
async function resolveLiveStreamUrl(youtubeUrl: string, trackId: string): Promise<string> {
  // Check cache
  const cached = urlCache.get(trackId);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return cached.url;
  }

  // Deduplicate concurrent requests for same track
  const pending = pendingResolutions.get(trackId);
  if (pending) return pending;

  const resolution = (async () => {
    try {
      const { stdout } = await execFileAsync(ytDlpBin(), [
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
        '-g',
        '--no-playlist',
        '--no-warnings',
        youtubeUrl,
      ], { timeout: 30_000 });

      const url = stdout.trim().split('\n')[0];
      if (!url || !url.startsWith('http')) {
        throw new Error('Could not resolve live stream URL — stream may be offline');
      }
      urlCache.set(trackId, { url, resolvedAt: Date.now() });
      return url;
    } finally {
      pendingResolutions.delete(trackId);
    }
  })();

  pendingResolutions.set(trackId, resolution);
  return resolution;
}

// Periodically clean stale cache entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of urlCache) {
    if (now - entry.resolvedAt > CACHE_TTL_MS) {
      urlCache.delete(key);
    }
  }
}, 60_000);

// GET /api/stream/:trackId — proxy audio stream for a live stream track
router.get('/:trackId', async (req, res) => {
  const trackId = paramId(req.params.trackId);

  // Look up the track
  const track = await store.getTrack(trackId);
  if (!track) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  if (!track.isLiveStream) {
    res.status(400).json({ error: 'Track is not a live stream. Use /api/audio/:trackId instead.' });
    return;
  }

  if (!ytDlpAvailable()) {
    res.status(503).json({ error: 'Stream unavailable — yt-dlp not installed' });
    return;
  }

  // Record playback event
  const userId = req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
  store.recordEvent('track.played', {
    userId,
    entityType: 'track',
    entityId: trackId,
    metadata: { mode: 'live_stream' },
  }).catch(() => {});

  try {
    const audioUrl = await resolveLiveStreamUrl(track.youtubeUrl, trackId);

    // Forward range headers for seeking support
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0',
    };
    if (req.headers.range) {
      upstreamHeaders['Range'] = req.headers.range as string;
    }

    const upstream = await fetch(audioUrl, { headers: upstreamHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      // URL may have expired — evict cache and fail
      urlCache.delete(trackId);
      res.status(502).json({ error: 'Live stream unavailable — stream may be offline' });
      return;
    }

    // Forward status and relevant headers
    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      const lk = key.toLowerCase();
      if (['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(lk)) {
        res.set(key, value);
      }
    }

    // Pipe body
    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body as never);
      nodeStream.pipe(res);

      // Clean up on client disconnect
      req.on('close', () => {
        nodeStream.destroy();
      });
    } else {
      res.end();
    }
  } catch (err) {
    // Evict from cache on any error
    urlCache.delete(trackId);

    if (!res.headersSent) {
      const msg = err instanceof Error ? err.message : 'Stream failed';
      console.error(`[stream] Error for track ${trackId}:`, msg);
      res.status(500).json({ error: 'Live stream unavailable', detail: msg });
    }
  }
});

// GET /api/stream/:trackId/resolve — return the resolved URL directly (for debugging)
router.get('/:trackId/resolve', async (req, res) => {
  const trackId = paramId(req.params.trackId);

  const track = await store.getTrack(trackId);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  if (!track.isLiveStream) { res.status(400).json({ error: 'Track is not a live stream' }); return; }
  if (!ytDlpAvailable()) { res.status(503).json({ error: 'yt-dlp not available' }); return; }

  try {
    const url = await resolveLiveStreamUrl(track.youtubeUrl, trackId);
    res.json({ url, trackId, youtubeUrl: track.youtubeUrl });
  } catch (err) {
    urlCache.delete(trackId);
    const msg = err instanceof Error ? err.message : 'Resolution failed';
    res.status(500).json({ error: 'Could not resolve live stream URL', detail: msg });
  }
});

export default router;
