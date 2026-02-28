import { Router } from 'express';
import * as store from '../store';
import type { CreateRadioStationInput, UpdateRadioStationInput } from '../types';

const router = Router();

/**
 * Resolve a stream URL — if the URL points to an M3U/M3U8 playlist file,
 * fetch it and extract the first actual stream URL.
 * This is necessary because some radio stations (e.g. Rainwave) provide
 * .mp3 URLs that actually return M3U playlist files (audio/x-mpegurl).
 */
async function resolveStreamUrl(url: string): Promise<{ streamUrl: string; resolved: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Nightwave/1.0' },
    });
    clearTimeout(timeout);

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    // M3U / M3U8 playlist — parse and return first stream URL
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('x-mpegurl') ||
      contentType.includes('audio/x-scpls') ||
      url.endsWith('.m3u') ||
      url.endsWith('.m3u8')
    ) {
      const body = await res.text();
      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      // Find first URL line (skip #EXTINF and other comments)
      const streamLine = lines.find(l => l.startsWith('http://') || l.startsWith('https://'));
      if (streamLine) {
        // Prefer HTTPS if available
        const httpsLine = lines.find(l => l.startsWith('https://'));
        return { streamUrl: httpsLine || streamLine, resolved: true };
      }
      return { streamUrl: url, resolved: false, error: 'M3U playlist contained no stream URLs' };
    }

    // If content-type is audio/mpeg or similar — the URL IS the stream
    if (contentType.includes('audio/')) {
      // Cancel the body download — we just needed headers
      res.body?.cancel?.();
      return { streamUrl: url, resolved: false };
    }

    // Unknown content type — try to use it as-is
    res.body?.cancel?.();
    return { streamUrl: url, resolved: false };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { streamUrl: url, resolved: false, error: 'Stream URL timed out' };
    }
    return { streamUrl: url, resolved: false, error: err.message || 'Failed to resolve stream' };
  }
}

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /api/radios — list all active stations (use ?all=true for including inactive)
router.get('/', async (req, res) => {
  const includeInactive = req.query.all === 'true';
  const stations = await store.getAllRadioStations(includeInactive);
  res.json(stations);
});

// GET /api/radios/:idOrSlug — get a single station
router.get('/:idOrSlug', async (req, res) => {
  const station = await store.getRadioStation(paramId(req.params.idOrSlug));
  if (!station) { res.status(404).json({ error: 'Radio station not found' }); return; }
  res.json(station);
});

// POST /api/radios — create a new station
router.post('/', async (req, res) => {
  const input = req.body as CreateRadioStationInput;
  if (!input.name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (!input.streamUrl?.trim()) { res.status(400).json({ error: 'streamUrl is required' }); return; }

  try {
    const station = await store.createRadioStation({
      ...input,
      name: input.name.trim(),
      streamUrl: input.streamUrl.trim(),
    });
    res.status(201).json(station);
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A station with this name/slug already exists' });
    } else {
      console.error('[radios] create error:', err);
      res.status(500).json({ error: 'Failed to create radio station' });
    }
  }
});

// PUT /api/radios/:idOrSlug — update a station
router.put('/:idOrSlug', async (req, res) => {
  const idOrSlug = paramId(req.params.idOrSlug);
  const input = req.body as UpdateRadioStationInput;

  if (input.name !== undefined && !input.name.trim()) {
    res.status(400).json({ error: 'name cannot be empty' });
    return;
  }
  if (input.streamUrl !== undefined && !input.streamUrl.trim()) {
    res.status(400).json({ error: 'streamUrl cannot be empty' });
    return;
  }

  const station = await store.updateRadioStation(idOrSlug, input);
  if (!station) { res.status(404).json({ error: 'Radio station not found' }); return; }
  res.json(station);
});

// DELETE /api/radios/:idOrSlug — delete a station
router.delete('/:idOrSlug', async (req, res) => {
  const deleted = await store.deleteRadioStation(paramId(req.params.idOrSlug));
  if (!deleted) { res.status(404).json({ error: 'Radio station not found' }); return; }
  res.status(204).send();
});

// GET /api/radios/:idOrSlug/resolve-stream — resolve M3U/playlist URLs to actual stream URLs
router.get('/:idOrSlug/resolve-stream', async (req, res) => {
  const idOrSlug = paramId(req.params.idOrSlug);
  const station = await store.getRadioStation(idOrSlug);
  if (!station) { res.status(404).json({ error: 'Radio station not found' }); return; }

  const result = await resolveStreamUrl(station.streamUrl);
  res.json({
    originalUrl: station.streamUrl,
    streamUrl: result.streamUrl,
    resolved: result.resolved,
    error: result.error ?? null,
  });
});

// POST /api/radios/:idOrSlug/toggle — toggle active status
router.post('/:idOrSlug/toggle', async (req, res) => {
  const idOrSlug = paramId(req.params.idOrSlug);
  const station = await store.getRadioStation(idOrSlug);
  if (!station) { res.status(404).json({ error: 'Radio station not found' }); return; }

  const updated = await store.updateRadioStation(idOrSlug, { active: !station.active });
  res.json(updated);
});

export default router;
