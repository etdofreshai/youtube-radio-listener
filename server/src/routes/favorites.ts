import { Router } from 'express';
import * as store from '../store';

const router = Router();

function getActorId(req: any): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /api/favorites
router.get('/', async (_req, res) => {
  const favs = await store.getAllFavorites();
  const enriched = await Promise.all(
    favs.map(async fav => ({
      ...fav,
      track: (await store.getTrack(fav.trackId)) ?? null,
    }))
  );
  res.json(enriched);
});

// POST /api/favorites
router.post('/', async (req, res) => {
  const { trackId } = req.body as { trackId: string };
  if (!trackId) { res.status(400).json({ error: 'trackId is required' }); return; }
  const fav = await store.addFavorite(trackId);
  if (!fav) { res.status(404).json({ error: 'Track not found' }); return; }

  store.recordEvent('favorite.added', {
    userId: getActorId(req),
    entityType: 'favorite',
    entityId: trackId,
    metadata: { trackId },
  }).catch(() => {});

  res.status(201).json(fav);
});

// DELETE /api/favorites/:trackId
router.delete('/:trackId', async (req, res) => {
  const trackId = paramId(req.params.trackId);
  const removed = await store.removeFavorite(trackId);
  if (!removed) { res.status(404).json({ error: 'Favorite not found' }); return; }

  store.recordEvent('favorite.removed', {
    userId: getActorId(req),
    entityType: 'favorite',
    entityId: trackId,
    metadata: { trackId },
  }).catch(() => {});

  res.status(204).send();
});

export default router;
