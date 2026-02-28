import { Router } from 'express';
import * as store from '../store/memory';
import { downloadTrackAudio, refreshTrackAudio } from '../downloader';
import { enrichTrack, enrichAllTracks, listProviders } from '../services/enrichment';
import type { CreateTrackInput, UpdateTrackInput, SortableTrackField, SortDirection } from '../types';

const router = Router();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// Valid sortable fields
const SORTABLE_FIELDS: SortableTrackField[] = [
  'artist', 'title', 'youtubeUrl', 'createdAt', 'updatedAt',
  'duration', 'verified', 'album', 'genre', 'releaseYear',
];

// ---------- GET /api/tracks/enrichment/providers — list providers ----------
// (Must be before /:id to avoid param capture)
router.get('/enrichment/providers', (_req, res) => {
  res.json(listProviders());
});

// ---------- POST /api/tracks/enrich-all — batch enrichment ----------
// (Must be before /:id to avoid param capture)
router.post('/enrich-all', async (req, res) => {
  const force = req.query.force === 'true';

  enrichAllTracks({ force }).then(count => {
    console.log(`[tracks] Batch enrichment complete: ${count} tracks enriched`);
  }).catch(err => {
    console.error('[tracks] Batch enrichment failed:', err);
  });

  res.json({ message: 'Batch enrichment started', force });
});

// ---------- GET /api/tracks — paginated + sorted ----------
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string, 10) || 25));

  let sortBy: SortableTrackField = 'createdAt';
  if (req.query.sortBy && SORTABLE_FIELDS.includes(req.query.sortBy as SortableTrackField)) {
    sortBy = req.query.sortBy as SortableTrackField;
  }

  let sortDir: SortDirection = 'desc'; // newest first by default
  if (req.query.sortDir === 'asc' || req.query.sortDir === 'desc') {
    sortDir = req.query.sortDir as SortDirection;
  }

  const search = (req.query.search as string) || undefined;

  let verified: boolean | undefined;
  if (req.query.verified === 'true') verified = true;
  else if (req.query.verified === 'false') verified = false;

  const result = store.getTracksPaginated({
    page,
    pageSize,
    sortBy,
    sortDir,
    search,
    verified,
  });

  res.json(result);
});

// ---------- GET /api/tracks/:id ----------
router.get('/:id', (req, res) => {
  const track = store.getTrack(paramId(req.params.id));
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  res.json(track);
});

// ---------- POST /api/tracks ----------
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

  // Auto-download audio in background
  downloadTrackAudio(track.id).catch(err => {
    console.error(`[tracks] Auto-download failed for ${track.id}:`, err);
  });

  // Auto-enrich metadata in background
  enrichTrack(track.id).catch(err => {
    console.error(`[tracks] Auto-enrich failed for ${track.id}:`, err);
  });

  res.status(201).json(track);
});

// ---------- PUT /api/tracks/:id ----------
router.put('/:id', (req, res) => {
  const input = req.body as UpdateTrackInput;
  if (input.volume != null && (input.volume < 0 || input.volume > 200)) {
    res.status(400).json({ error: 'volume must be between 0 and 200' });
    return;
  }
  const track = store.updateTrack(paramId(req.params.id), input);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // If youtubeUrl changed, re-download and re-enrich
  if (input.youtubeUrl) {
    refreshTrackAudio(track.id).catch(err => {
      console.error(`[tracks] Re-download failed for ${track.id}:`, err);
    });
    enrichTrack(track.id).catch(err => {
      console.error(`[tracks] Re-enrich failed for ${track.id}:`, err);
    });
  }

  res.json(track);
});

// ---------- DELETE /api/tracks/:id ----------
router.delete('/:id', (req, res) => {
  const deleted = store.deleteTrack(paramId(req.params.id));
  if (!deleted) { res.status(404).json({ error: 'Track not found' }); return; }
  res.status(204).send();
});

// ---------- POST /api/tracks/:id/download ----------
router.post('/:id/download', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  downloadTrackAudio(id).catch(err => {
    console.error(`[tracks] Manual download failed for ${id}:`, err);
  });

  res.json(store.getTrack(id));
});

// ---------- POST /api/tracks/:id/refresh ----------
router.post('/:id/refresh', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  refreshTrackAudio(id).catch(err => {
    console.error(`[tracks] Refresh failed for ${id}:`, err);
  });

  res.json(store.getTrack(id));
});

// ---------- POST /api/tracks/:id/verify — toggle verification ----------
router.post('/:id/verify', (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // Toggle current state, or set explicitly via body
  const { verified, verifiedBy } = req.body || {};
  const newVerified = typeof verified === 'boolean' ? verified : !track.verified;

  const updated = store.verifyTrack(id, newVerified, verifiedBy || null);
  if (!updated) { res.status(404).json({ error: 'Track not found' }); return; }

  res.json(updated);
});

// ---------- POST /api/tracks/:id/enrich — trigger metadata enrichment ----------
router.post('/:id/enrich', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // Fire enrichment (fast for YouTube, might take a few seconds)
  try {
    const enriched = await enrichTrack(id);
    res.json(enriched);
  } catch (err) {
    console.error(`[tracks] Enrichment failed for ${id}:`, err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

export default router;
