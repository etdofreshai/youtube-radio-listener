import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { ytDlpAvailable, ytDlpBin } from '../deps';

const execFileAsync = promisify(execFile);
const router = Router();

// ── URL cache ──────────────────────────────────────────────
// YouTube CDN URLs expire after a few hours; cache for 10 min to avoid
// repeated yt-dlp calls for range requests / replays.
interface CachedUrl { url: string; resolvedAt: number }
const urlCache = new Map<string, CachedUrl>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Active resolutions to avoid duplicate yt-dlp processes for the same video
const pendingResolutions = new Map<string, Promise<string>>();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveAudioUrl(videoId: string): Promise<string> {
  // Check cache
  const cached = urlCache.get(videoId);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return cached.url;
  }

  // Deduplicate concurrent requests for same videoId
  const pending = pendingResolutions.get(videoId);
  if (pending) return pending;

  const resolution = (async () => {
    try {
      const { stdout } = await execFileAsync(ytDlpBin(), [
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
        '-g',
        '--no-playlist',
        '--no-warnings',
        `https://www.youtube.com/watch?v=${videoId}`,
      ], { timeout: 20_000 });

      const url = stdout.trim().split('\n')[0];
      if (!url || !url.startsWith('http')) {
        throw new Error('Could not resolve audio stream URL');
      }
      urlCache.set(videoId, { url, resolvedAt: Date.now() });
      return url;
    } finally {
      pendingResolutions.delete(videoId);
    }
  })();

  pendingResolutions.set(videoId, resolution);
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

// GET /api/preview/:videoId — proxy audio stream for preview playback
router.get('/:videoId', async (req, res) => {
  const videoId = paramId(req.params.videoId);

  // Validate video ID format (standard YouTube 11-char ID)
  if (!/^[a-zA-Z0-9_-]{10,12}$/.test(videoId)) {
    res.status(400).json({ error: 'Invalid video ID' });
    return;
  }

  if (!ytDlpAvailable()) {
    res.status(503).json({ error: 'Preview unavailable — yt-dlp not installed' });
    return;
  }

  try {
    const audioUrl = await resolveAudioUrl(videoId);

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
      urlCache.delete(videoId);
      res.status(502).json({ error: 'Preview stream unavailable' });
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
    urlCache.delete(videoId);

    if (!res.headersSent) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      console.error(`[preview] Error for ${videoId}:`, msg);
      res.status(500).json({ error: 'Preview unavailable' });
    }
  }
});

export default router;
