import { Router } from 'express';
import * as store from '../store/memory';

const router = Router();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /api/favorites
router.get('/', (_req, res) => {
  const favs = store.getAllFavorites();
  const enriched = favs.map(fav => ({
    ...fav,
    track: store.getTrack(fav.trackId) ?? null,
  }));
  res.json(enriched);
});

// POST /api/favorites
router.post('/', (req, res) => {
  const { trackId } = req.body as { trackId: string };
  if (!trackId) { res.status(400).json({ error: 'trackId is required' }); return; }
  const fav = store.addFavorite(trackId);
  if (!fav) { res.status(404).json({ error: 'Track not found' }); return; }
  res.status(201).json(fav);
});

// DELETE /api/favorites/:trackId
router.delete('/:trackId', (req, res) => {
  const removed = store.removeFavorite(paramId(req.params.trackId));
  if (!removed) { res.status(404).json({ error: 'Favorite not found' }); return; }
  res.status(204).send();
});

export default router;
