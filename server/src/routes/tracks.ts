import { Router } from 'express';
import * as store from '../store';
import { downloadTrackAudio, refreshTrackAudio } from '../downloader';
import { enrichTrack, enrichTrackSync, enrichAllTracks, listProviders, budgetTracker } from '../services/enrichment';
import { getSchedulerStatus, forceTick, startScheduler, stopScheduler } from '../services/scheduler';
import { fetchYouTubeMetadata, parseArtistTitle, isValidYouTubeUrl } from '../services/youtube-metadata';
import type { CreateTrackInput, UpdateTrackInput, SortableTrackField, SortDirection } from '../types';

const router = Router();

/** Resolve actor user ID from request (header or default) */
function getActorId(req: any): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

const SORTABLE_FIELDS: SortableTrackField[] = [
  'artist', 'title', 'youtubeUrl', 'createdAt', 'updatedAt',
  'duration', 'verified', 'album', 'genre', 'releaseYear',
];

// ============================================================
// Static routes (before /:id to avoid param capture)
// ============================================================

// GET /api/tracks/enrichment/providers
router.get('/enrichment/providers', (_req, res) => {
  res.json(listProviders());
});

// GET /api/tracks/enrichment/status — scheduler + queue status
router.get('/enrichment/status', async (_req, res) => {
  res.json(await getSchedulerStatus());
});

// POST /api/tracks/enrichment/tick — force a scheduler tick
router.post('/enrichment/tick', async (_req, res) => {
  await forceTick();
  res.json({ message: 'Tick executed', status: await getSchedulerStatus() });
});

// POST /api/tracks/enrichment/start — start scheduler
router.post('/enrichment/start', async (_req, res) => {
  startScheduler();
  res.json({ message: 'Scheduler started', status: await getSchedulerStatus() });
});

// POST /api/tracks/enrichment/stop — stop scheduler
router.post('/enrichment/stop', async (_req, res) => {
  stopScheduler();
  res.json({ message: 'Scheduler stopped', status: await getSchedulerStatus() });
});

// POST /api/tracks/enrich-all — batch enqueue
router.post('/enrich-all', async (req, res) => {
  const force = req.query.force === 'true';
  const queued = await enrichAllTracks({ force });
  res.json({ message: `Queued ${queued} tracks for enrichment`, queued, force });
});

// ============================================================
// GET /api/tracks — paginated + sorted
// ============================================================

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string, 10) || 25));

    let sortBy: SortableTrackField = 'createdAt';
    if (req.query.sortBy && SORTABLE_FIELDS.includes(req.query.sortBy as SortableTrackField)) {
      sortBy = req.query.sortBy as SortableTrackField;
    }

    let sortDir: SortDirection = 'desc';
    if (req.query.sortDir === 'asc' || req.query.sortDir === 'desc') {
      sortDir = req.query.sortDir as SortDirection;
    }

    const search = (req.query.search as string) || undefined;
    let verified: boolean | undefined;
    if (req.query.verified === 'true') verified = true;
    else if (req.query.verified === 'false') verified = false;

    res.json(await store.getTracksPaginated({ page, pageSize, sortBy, sortDir, search, verified }));
  } catch (err) {
    console.error('[tracks] GET / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Single track CRUD
// ============================================================

// GET /api/tracks/:id
router.get('/:id', async (req, res) => {
  const track = await store.getTrack(paramId(req.params.id));
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  res.json(track);
});

// POST /api/tracks
router.post('/', async (req, res) => {
  const { youtubeUrl, title, artist, startTimeSec, endTimeSec, volume, notes } = req.body as CreateTrackInput;
  if (!youtubeUrl) {
    res.status(400).json({ error: 'youtubeUrl is required' });
    return;
  }
  if (volume != null && (volume < 0 || volume > 200)) {
    res.status(400).json({ error: 'volume must be between 0 and 200' });
    return;
  }

  // Determine title and artist — prefer user-provided, fall back to YouTube metadata
  let resolvedTitle = title?.trim() || '';
  let resolvedArtist = artist?.trim() || '';

  if (!resolvedTitle || !resolvedArtist) {
    // Need to fetch metadata from YouTube
    if (!isValidYouTubeUrl(youtubeUrl)) {
      res.status(400).json({ error: 'Invalid YouTube URL. Provide a valid URL or supply title and artist manually.' });
      return;
    }

    try {
      const ytInfo = await fetchYouTubeMetadata(youtubeUrl);
      const parsed = parseArtistTitle(ytInfo.videoTitle, ytInfo.channel);

      if (!resolvedTitle) resolvedTitle = parsed.title;
      if (!resolvedArtist) resolvedArtist = parsed.artist;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tracks] YouTube metadata fetch failed:`, msg);
      res.status(422).json({
        error: `Could not extract metadata from YouTube URL. Provide title and artist manually.`,
        detail: msg,
      });
      return;
    }
  }

  const track = await store.createTrack({
    youtubeUrl,
    title: resolvedTitle,
    artist: resolvedArtist,
    startTimeSec,
    endTimeSec,
    volume,
    notes,
  });

  // Record event
  const userId = getActorId(req);
  store.recordEvent('track.created', {
    userId,
    entityType: 'track',
    entityId: track.id,
    metadata: { title: track.title, artist: track.artist, youtubeUrl: track.youtubeUrl },
  }).catch(() => {});

  // Auto-download audio
  downloadTrackAudio(track.id).catch(err => {
    console.error(`[tracks] Auto-download failed for ${track.id}:`, err);
  });

  // Auto-enrich via queue (Stage A)
  enrichTrack(track.id);

  res.status(201).json(track);
});

// PUT /api/tracks/:id
router.put('/:id', async (req, res) => {
  const input = req.body as UpdateTrackInput;
  if (input.volume != null && (input.volume < 0 || input.volume > 200)) {
    res.status(400).json({ error: 'volume must be between 0 and 200' });
    return;
  }
  const track = await store.updateTrack(paramId(req.params.id), input);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // Record event
  const userId = getActorId(req);
  store.recordEvent('track.updated', {
    userId,
    entityType: 'track',
    entityId: track.id,
    metadata: { changes: Object.keys(input) },
  }).catch(() => {});

  if (input.youtubeUrl) {
    refreshTrackAudio(track.id).catch(err => {
      console.error(`[tracks] Re-download failed for ${track.id}:`, err);
    });
    // URL changed → re-enrich from scratch
    await store.updateTrackMetadata(track.id, {
      enrichmentStatus: 'none',
      stageACompletedAt: null,
      stageBCompletedAt: null,
      enrichmentAttempts: 0,
    });
    enrichTrack(track.id);
  }

  res.json(track);
});

// DELETE /api/tracks/:id
router.delete('/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  const deleted = await store.deleteTrack(id);
  if (!deleted) { res.status(404).json({ error: 'Track not found' }); return; }

  // Record event
  const userId = getActorId(req);
  store.recordEvent('track.deleted', {
    userId,
    entityType: 'track',
    entityId: id,
    metadata: { title: track?.title, artist: track?.artist },
  }).catch(() => {});

  res.status(204).send();
});

// ============================================================
// Audio actions
// ============================================================

router.post('/:id/download', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent('track.download_started', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
  }).catch(() => {});

  downloadTrackAudio(id).catch(err => console.error(`[tracks] Download failed for ${id}:`, err));
  res.json(await store.getTrack(id));
});

router.post('/:id/refresh', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent('track.refresh_started', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
  }).catch(() => {});

  refreshTrackAudio(id).catch(err => console.error(`[tracks] Refresh failed for ${id}:`, err));
  res.json(await store.getTrack(id));
});

// ============================================================
// Verification
// ============================================================

router.post('/:id/verify', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  const { verified, verifiedBy } = req.body || {};
  const newVerified = typeof verified === 'boolean' ? verified : !track.verified;

  const updated = await store.verifyTrack(id, newVerified, verifiedBy || null);
  if (!updated) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent(newVerified ? 'track.verified' : 'track.unverified', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
    metadata: { verifiedBy: verifiedBy || null },
  }).catch(() => {});

  res.json(updated);
});

// ============================================================
// Enrichment (single track)
// ============================================================

// POST /api/tracks/:id/enrich — synchronous enrichment (waits for result)
router.post('/:id/enrich', async (req, res) => {
  const id = paramId(req.params.id);
  const track = await store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent('track.enrich_started', {
    userId: getActorId(req),
    entityType: 'track',
    entityId: id,
  }).catch(() => {});

  try {
    const enriched = await enrichTrackSync(id);
    res.json(enriched);
  } catch (err) {
    console.error(`[tracks] Enrichment failed for ${id}:`, err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

export default router;
