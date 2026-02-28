import { Router } from 'express';
import * as store from '../store/memory';
import { downloadTrackAudio, refreshTrackAudio } from '../downloader';
import { enrichTrack, enrichTrackSync, enrichAllTracks, listProviders, budgetTracker } from '../services/enrichment';
import { getSchedulerStatus, forceTick, startScheduler, stopScheduler } from '../services/scheduler';
import type { CreateTrackInput, UpdateTrackInput, SortableTrackField, SortDirection } from '../types';

const router = Router();

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
router.get('/enrichment/status', (_req, res) => {
  res.json(getSchedulerStatus());
});

// POST /api/tracks/enrichment/tick — force a scheduler tick
router.post('/enrichment/tick', (_req, res) => {
  forceTick();
  res.json({ message: 'Tick executed', status: getSchedulerStatus() });
});

// POST /api/tracks/enrichment/start — start scheduler
router.post('/enrichment/start', (_req, res) => {
  startScheduler();
  res.json({ message: 'Scheduler started', status: getSchedulerStatus() });
});

// POST /api/tracks/enrichment/stop — stop scheduler
router.post('/enrichment/stop', (_req, res) => {
  stopScheduler();
  res.json({ message: 'Scheduler stopped', status: getSchedulerStatus() });
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

router.get('/', (req, res) => {
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

  res.json(store.getTracksPaginated({ page, pageSize, sortBy, sortDir, search, verified }));
});

// ============================================================
// Single track CRUD
// ============================================================

// GET /api/tracks/:id
router.get('/:id', (req, res) => {
  const track = store.getTrack(paramId(req.params.id));
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  res.json(track);
});

// POST /api/tracks
router.post('/', (req, res) => {
  const { youtubeUrl, title, artist, startTimeSec, endTimeSec, volume, notes } = req.body as CreateTrackInput;
  if (!youtubeUrl || !title || !artist) {
    res.status(400).json({ error: 'youtubeUrl, title, and artist are required' });
    return;
  }
  if (volume != null && (volume < 0 || volume > 200)) {
    res.status(400).json({ error: 'volume must be between 0 and 200' });
    return;
  }
  const track = store.createTrack({ youtubeUrl, title, artist, startTimeSec, endTimeSec, volume, notes });

  // Auto-download audio
  downloadTrackAudio(track.id).catch(err => {
    console.error(`[tracks] Auto-download failed for ${track.id}:`, err);
  });

  // Auto-enrich via queue (Stage A)
  enrichTrack(track.id);

  res.status(201).json(track);
});

// PUT /api/tracks/:id
router.put('/:id', (req, res) => {
  const input = req.body as UpdateTrackInput;
  if (input.volume != null && (input.volume < 0 || input.volume > 200)) {
    res.status(400).json({ error: 'volume must be between 0 and 200' });
    return;
  }
  const track = store.updateTrack(paramId(req.params.id), input);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  if (input.youtubeUrl) {
    refreshTrackAudio(track.id).catch(err => {
      console.error(`[tracks] Re-download failed for ${track.id}:`, err);
    });
    // URL changed → re-enrich from scratch
    store.updateTrackMetadata(track.id, {
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
router.delete('/:id', (req, res) => {
  const deleted = store.deleteTrack(paramId(req.params.id));
  if (!deleted) { res.status(404).json({ error: 'Track not found' }); return; }
  res.status(204).send();
});

// ============================================================
// Audio actions
// ============================================================

router.post('/:id/download', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  downloadTrackAudio(id).catch(err => console.error(`[tracks] Download failed for ${id}:`, err));
  res.json(store.getTrack(id));
});

router.post('/:id/refresh', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  refreshTrackAudio(id).catch(err => console.error(`[tracks] Refresh failed for ${id}:`, err));
  res.json(store.getTrack(id));
});

// ============================================================
// Verification
// ============================================================

router.post('/:id/verify', (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  const { verified, verifiedBy } = req.body || {};
  const newVerified = typeof verified === 'boolean' ? verified : !track.verified;

  const updated = store.verifyTrack(id, newVerified, verifiedBy || null);
  if (!updated) { res.status(404).json({ error: 'Track not found' }); return; }
  res.json(updated);
});

// ============================================================
// Enrichment (single track)
// ============================================================

// POST /api/tracks/:id/enrich — synchronous enrichment (waits for result)
router.post('/:id/enrich', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  try {
    const enriched = await enrichTrackSync(id);
    res.json(enriched);
  } catch (err) {
    console.error(`[tracks] Enrichment failed for ${id}:`, err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

export default router;
