import { Router } from 'express';
import * as store from '../store';
import type { FavoriteType } from '../types';

const router = Router();

const VALID_TYPES: FavoriteType[] = ['track', 'artist', 'album', 'radio_station', 'playlist'];

function getActorId(req: any): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

function isValidType(t: string): t is FavoriteType {
  return VALID_TYPES.includes(t as FavoriteType);
}

// GET /api/favorites — list all user's favorites (optionally filtered by type)
router.get('/', async (req, res) => {
  const userId = getActorId(req);
  const typeFilter = req.query.type as string | undefined;

  if (typeFilter && !isValidType(typeFilter)) {
    res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }

  const favs = await store.getUserFavorites(userId, typeFilter as FavoriteType | undefined);
  res.json(favs);
});

// GET /api/favorites/ids — get all favorited entity IDs (for client cache)
router.get('/ids', async (req, res) => {
  const userId = getActorId(req);
  const ids = await store.getAllUserFavoriteIds(userId);
  res.json(ids);
});

// GET /api/favorites/check — check if specific entity is favorited
router.get('/check', async (req, res) => {
  const userId = getActorId(req);
  const type = req.query.type as string;
  const entityId = req.query.id as string;

  if (!type || !isValidType(type)) {
    res.status(400).json({ error: `type is required and must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  if (!entityId) {
    res.status(400).json({ error: 'id query param is required' });
    return;
  }

  const isFav = await store.isUserFavorite(userId, type, entityId);
  res.json({ favorited: isFav });
});

// POST /api/favorites — add favorite
router.post('/', async (req, res) => {
  const userId = getActorId(req);
  const { type, entityId } = req.body as { type?: string; entityId?: string };

  // Backward compat: if body has trackId but no type, treat as track favorite
  const trackId = (req.body as any).trackId;
  const effectiveType = type || (trackId ? 'track' : undefined);
  const effectiveEntityId = entityId || trackId;

  if (!effectiveType || !isValidType(effectiveType)) {
    res.status(400).json({ error: `type is required and must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  if (!effectiveEntityId) {
    res.status(400).json({ error: 'entityId is required' });
    return;
  }

  try {
    const fav = await store.addUserFavorite(userId, effectiveType, effectiveEntityId);

    store.recordEvent('favorite.added', {
      userId,
      entityType: effectiveType,
      entityId: effectiveEntityId,
      metadata: { favoriteType: effectiveType },
    }).catch(() => {});

    res.status(201).json(fav);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to add favorite' });
  }
});

// DELETE /api/favorites/:type/:entityId — remove favorite
router.delete('/:type/:entityId', async (req, res) => {
  const userId = getActorId(req);
  const { type, entityId } = req.params;

  if (!isValidType(type)) {
    res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }

  const removed = await store.removeUserFavorite(userId, type, entityId);
  if (!removed) {
    res.status(404).json({ error: 'Favorite not found' });
    return;
  }

  store.recordEvent('favorite.removed', {
    userId,
    entityType: type,
    entityId,
    metadata: { favoriteType: type },
  }).catch(() => {});

  res.status(204).send();
});

// Backward compat: DELETE /api/favorites/:trackId (legacy — treat as track type)
router.delete('/:trackId', async (req, res, next) => {
  const trackId = req.params.trackId;
  // If it contains a slash-separated type, let the :type/:entityId route handle it
  if (VALID_TYPES.includes(trackId as FavoriteType)) {
    return next();
  }

  const userId = getActorId(req);
  const removed = await store.removeUserFavorite(userId, 'track', trackId);
  if (!removed) {
    // Try old favorites table as fallback
    const removedLegacy = await store.removeFavorite(trackId);
    if (!removedLegacy) {
      res.status(404).json({ error: 'Favorite not found' });
      return;
    }
  }

  store.recordEvent('favorite.removed', {
    userId,
    entityType: 'track',
    entityId: trackId,
    metadata: { favoriteType: 'track', legacy: true },
  }).catch(() => {});

  res.status(204).send();
});

export default router;
