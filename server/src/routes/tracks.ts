import { Router } from 'express';
import * as store from '../store/memory';
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
  const track = store.createTrack({ youtubeUrl, title, artist, startTimeSec, endTimeSec, volume, notes });
  res.status(201).json(track);
});

// PUT /api/tracks/:id
router.put('/:id', (req, res) => {
  const input = req.body as UpdateTrackInput;
  const track = store.updateTrack(paramId(req.params.id), input);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }
  res.json(track);
});

// DELETE /api/tracks/:id
router.delete('/:id', (req, res) => {
  const deleted = store.deleteTrack(paramId(req.params.id));
  if (!deleted) { res.status(404).json({ error: 'Track not found' }); return; }
  res.status(204).send();
});

export default router;
