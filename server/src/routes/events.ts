import { Router } from 'express';
import * as store from '../store';

const router = Router();

function getActorId(req: any): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

/**
 * GET /api/events — paginated event log
 *
 * Query params:
 *   page        (default 1)
 *   pageSize    (default 50, max 200)
 *   userId      (filter by user)
 *   eventType   (filter by event type, e.g. 'track.created')
 *   entityType  (filter by entity type, e.g. 'track', 'playlist')
 *   entityId    (filter by specific entity)
 *   mine        (if 'true', filters to current user)
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string, 10) || 50));

    let userId = req.query.userId as string | undefined;
    if (req.query.mine === 'true') {
      userId = getActorId(req);
    }

    const result = await store.getEvents({
      userId,
      eventType: req.query.eventType as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
      page,
      pageSize,
    });

    res.json(result);
  } catch (err) {
    console.error('[events] GET / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/events/my — current user's event history (convenience endpoint)
 */
router.get('/my', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string, 10) || 50));
    const userId = getActorId(req);

    const result = await store.getEvents({
      userId,
      eventType: req.query.eventType as string | undefined,
      page,
      pageSize,
    });

    res.json(result);
  } catch (err) {
    console.error('[events] GET /my error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
