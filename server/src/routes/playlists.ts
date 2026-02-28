import { Router } from 'express';
import * as store from '../store/memory';
import type { CreatePlaylistInput, UpdatePlaylistInput } from '../types';

const router = Router();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /api/playlists
router.get('/', (_req, res) => {
  res.json(store.getAllPlaylists());
});

// GET /api/playlists/:id
router.get('/:id', (req, res) => {
  const playlist = store.getPlaylist(paramId(req.params.id));
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }
  res.json(playlist);
});

// POST /api/playlists
router.post('/', (req, res) => {
  const { name, description, trackIds } = req.body as CreatePlaylistInput;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const playlist = store.createPlaylist({ name, description, trackIds });
  res.status(201).json(playlist);
});

// PUT /api/playlists/:id
router.put('/:id', (req, res) => {
  const input = req.body as UpdatePlaylistInput;
  const playlist = store.updatePlaylist(paramId(req.params.id), input);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }
  res.json(playlist);
});

// DELETE /api/playlists/:id
router.delete('/:id', (req, res) => {
  const deleted = store.deletePlaylist(paramId(req.params.id));
  if (!deleted) { res.status(404).json({ error: 'Playlist not found' }); return; }
  res.status(204).send();
});

export default router;
