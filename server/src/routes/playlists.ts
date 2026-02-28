import { Router } from 'express';
import * as store from '../store';
import type { CreatePlaylistInput, UpdatePlaylistInput } from '../types';

const router = Router();

function getActorId(req: any): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /api/playlists
router.get('/', async (_req, res) => {
  res.json(await store.getAllPlaylists());
});

// GET /api/playlists/:id
router.get('/:id', async (req, res) => {
  const playlist = await store.getPlaylist(paramId(req.params.id));
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }
  res.json(playlist);
});

// POST /api/playlists
router.post('/', async (req, res) => {
  const { name, description, trackIds } = req.body as CreatePlaylistInput;
  if (!name || !name.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  // Validate trackIds exist if provided
  if (trackIds && trackIds.length > 0) {
    for (const tid of trackIds) {
      if (!(await store.getTrack(tid))) {
        res.status(400).json({ error: `Track ${tid} not found` });
        return;
      }
    }
  }
  const playlist = await store.createPlaylist({ name: name.trim(), description, trackIds });

  store.recordEvent('playlist.created', {
    userId: getActorId(req),
    entityType: 'playlist',
    entityId: playlist.id,
    metadata: { name: playlist.name, trackCount: playlist.trackIds.length },
  }).catch(() => {});

  res.status(201).json(playlist);
});

// PUT /api/playlists/:id
router.put('/:id', async (req, res) => {
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
      if (!(await store.getTrack(tid))) {
        res.status(400).json({ error: `Track ${tid} not found` });
        return;
      }
    }
  }
  const playlist = await store.updatePlaylist(paramId(req.params.id), input);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }

  store.recordEvent('playlist.updated', {
    userId: getActorId(req),
    entityType: 'playlist',
    entityId: playlist.id,
    metadata: { changes: Object.keys(input) },
  }).catch(() => {});

  res.json(playlist);
});

// DELETE /api/playlists/:id
router.delete('/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const playlist = await store.getPlaylist(id);
  const deleted = await store.deletePlaylist(id);
  if (!deleted) { res.status(404).json({ error: 'Playlist not found' }); return; }

  store.recordEvent('playlist.deleted', {
    userId: getActorId(req),
    entityType: 'playlist',
    entityId: id,
    metadata: { name: playlist?.name },
  }).catch(() => {});

  res.status(204).send();
});

// --- Track management within playlist ---

// POST /api/playlists/:id/tracks — add a track to the playlist
router.post('/:id/tracks', async (req, res) => {
  const playlistId = paramId(req.params.id);
  const { trackId, position } = req.body as { trackId: string; position?: number };
  if (!trackId) { res.status(400).json({ error: 'trackId is required' }); return; }

  const playlist = await store.getPlaylist(playlistId);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }

  const track = await store.getTrack(trackId);
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

  const updated = await store.updatePlaylist(playlistId, { trackIds: newTrackIds });

  store.recordEvent('playlist.track_added', {
    userId: getActorId(req),
    entityType: 'playlist',
    entityId: playlistId,
    metadata: { trackId, trackTitle: track.title, position },
  }).catch(() => {});

  res.json(updated);
});

// DELETE /api/playlists/:id/tracks/:trackId — remove a track from the playlist
router.delete('/:id/tracks/:trackId', async (req, res) => {
  const playlistId = paramId(req.params.id);
  const trackId = paramId(req.params.trackId);

  const playlist = await store.getPlaylist(playlistId);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }

  const idx = playlist.trackIds.indexOf(trackId);
  if (idx === -1) { res.status(404).json({ error: 'Track not in playlist' }); return; }

  const newTrackIds = playlist.trackIds.filter(id => id !== trackId);
  const updated = await store.updatePlaylist(playlistId, { trackIds: newTrackIds });

  store.recordEvent('playlist.track_removed', {
    userId: getActorId(req),
    entityType: 'playlist',
    entityId: playlistId,
    metadata: { trackId },
  }).catch(() => {});

  res.json(updated);
});

// PUT /api/playlists/:id/reorder — reorder tracks in the playlist
router.put('/:id/reorder', async (req, res) => {
  const playlistId = paramId(req.params.id);
  const { trackIds } = req.body as { trackIds: string[] };
  if (!Array.isArray(trackIds)) {
    res.status(400).json({ error: 'trackIds array is required' });
    return;
  }

  const playlist = await store.getPlaylist(playlistId);
  if (!playlist) { res.status(404).json({ error: 'Playlist not found' }); return; }

  // Validate: same set of tracks (just reordered)
  const currentSet = new Set(playlist.trackIds);
  const newSet = new Set(trackIds);
  if (currentSet.size !== newSet.size || ![...currentSet].every(id => newSet.has(id))) {
    res.status(400).json({ error: 'trackIds must contain the same tracks as the current playlist' });
    return;
  }

  const updated = await store.updatePlaylist(playlistId, { trackIds });

  store.recordEvent('playlist.reordered', {
    userId: getActorId(req),
    entityType: 'playlist',
    entityId: playlistId,
  }).catch(() => {});

  res.json(updated);
});

export default router;
