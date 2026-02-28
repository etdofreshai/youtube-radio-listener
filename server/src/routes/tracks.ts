import { Router } from 'express';
import * as store from '../store/memory';
import { downloadTrackAudio, refreshTrackAudio } from '../downloader';
import type { CreateTrackInput, UpdateTrackInput } from '../types';

const router = Router();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /api/tracks
router.get('/', (_req, res) => {
  res.json(store.getAllTracks());
});

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

  // Auto-download audio in background
  downloadTrackAudio(track.id).catch(err => {
    console.error(`[tracks] Auto-download failed for ${track.id}:`, err);
  });

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

  // If youtubeUrl changed, re-download
  if (input.youtubeUrl) {
    refreshTrackAudio(track.id).catch(err => {
      console.error(`[tracks] Re-download failed for ${track.id}:`, err);
    });
  }

  res.json(track);
});

// DELETE /api/tracks/:id
router.delete('/:id', (req, res) => {
  const deleted = store.deleteTrack(paramId(req.params.id));
  if (!deleted) { res.status(404).json({ error: 'Track not found' }); return; }
  res.status(204).send();
});

// POST /api/tracks/:id/download — trigger download (or re-download)
router.post('/:id/download', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // Fire and forget the download
  downloadTrackAudio(id).catch(err => {
    console.error(`[tracks] Manual download failed for ${id}:`, err);
  });

  // Return current track state (will be 'downloading')
  res.json(store.getTrack(id));
});

// POST /api/tracks/:id/refresh — force re-download (removes old file)
router.post('/:id/refresh', async (req, res) => {
  const id = paramId(req.params.id);
  const track = store.getTrack(id);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // Fire and forget the refresh
  refreshTrackAudio(id).catch(err => {
    console.error(`[tracks] Refresh failed for ${id}:`, err);
  });

  res.json(store.getTrack(id));
});

export default router;
