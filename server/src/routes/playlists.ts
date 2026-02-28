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
  if (!name || !name.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  // Validate trackIds exist if provided
  if (trackIds && trackIds.length > 0) {
    for (const tid of trackIds) {
      if (!store.getTrack(tid)) {
        res.status(400).json({ error: `Track ${tid} not found` });
        return;
      }
    }
  }
  const playlist = store.createPlaylist({ name: name.trim(), description, trackIds });
  res.status(201).json(playlist);
});

// PUT /api/playlists/:id
router.put('/:id', (req, res) => {
  const input = req.body as UpdatePlaylistInput;
  // Validate name if provided
  if (input.name !== undefined && !input.name.trim()) {
    res.status(400).json({ error: 'name cannot be empty' });
    return;
  }
  if (input.name) input.name = input.name.trim();
  // Validate trackIds exist if provided
  if (input.trackIds && input.trackIds.length > 0) {
    for (const tid of input.trackIds) {
      if (!store.getTrack(tid)) {
        res.status(400).json({ error: `Track ${tid} not found` });
        return;
      }
    }
  }
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

// --- Track management within playlist ---

// POST /api/playlists/:id/tracks — add a track to the playlist
router.post('/:id/tracks', (req, res) => {
  const playlistId = paramId(req.params.id);
  const { trackId, position } = req.body as { trackId: string; position?: number };
  if (!trackId) { res.status(400).json({ error: 'trackId is required' }); return; }

  const playlist = store.getPlaylist(playlistId);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }

  const track = store.getTrack(trackId);
  if (!track) { res.status(404).json({ error: 'Track not found' }); return; }

  // Avoid duplicates
  if (playlist.trackIds.includes(trackId)) {
    res.status(409).json({ error: 'Track already in playlist' });
    return;
  }

  const newTrackIds = [...playlist.trackIds];
  if (position !== undefined && position >= 0 && position <= newTrackIds.length) {
    newTrackIds.splice(position, 0, trackId);
  } else {
    newTrackIds.push(trackId);
  }

  const updated = store.updatePlaylist(playlistId, { trackIds: newTrackIds });
  res.json(updated);
});

// DELETE /api/playlists/:id/tracks/:trackId — remove a track from the playlist
router.delete('/:id/tracks/:trackId', (req, res) => {
  const playlistId = paramId(req.params.id);
  const trackId = paramId(req.params.trackId);

  const playlist = store.getPlaylist(playlistId);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }

  const idx = playlist.trackIds.indexOf(trackId);
  if (idx === -1) { res.status(404).json({ error: 'Track not in playlist' }); return; }

  const newTrackIds = playlist.trackIds.filter(id => id !== trackId);
  const updated = store.updatePlaylist(playlistId, { trackIds: newTrackIds });
  res.json(updated);
});

// PUT /api/playlists/:id/reorder — reorder tracks in the playlist
router.put('/:id/reorder', (req, res) => {
  const playlistId = paramId(req.params.id);
  const { trackIds } = req.body as { trackIds: string[] };
  if (!Array.isArray(trackIds)) {
    res.status(400).json({ error: 'trackIds array is required' });
    return;
  }

  const playlist = store.getPlaylist(playlistId);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }

  // Validate: same set of tracks (just reordered)
  const currentSet = new Set(playlist.trackIds);
  const newSet = new Set(trackIds);
  if (currentSet.size !== newSet.size || ![...currentSet].every(id => newSet.has(id))) {
    res.status(400).json({ error: 'trackIds must contain the same tracks as the current playlist' });
    return;
  }

  const updated = store.updatePlaylist(playlistId, { trackIds });
  res.json(updated);
});

export default router;
