import { Router, Request, Response } from 'express';
import * as store from '../store';

const router = Router();

function p(v: string | string[]): string { return Array.isArray(v) ? v[0] : v; }

function getActorId(req: Request): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

// ============================================================
// POST /api/sessions — create a new play session
// ============================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const { name, playlistId, queue } = req.body as { name?: string; playlistId?: string; queue?: string[] };

    // If playlistId provided, load its tracks as the queue
    let sessionQueue = queue ?? [];
    if (playlistId && sessionQueue.length === 0) {
      const playlist = await store.getPlaylist(playlistId);
      if (playlist) sessionQueue = playlist.trackIds;
    }

    const result = await store.createSession({
      name,
      ownerId: userId,
      playlistId,
      queue: sessionQueue,
    });

    store.recordEvent('session.created', {
      userId,
      entityType: 'session',
      entityId: result.session.id,
      metadata: { token: result.session.token, name: result.session.name },
    }).catch(() => {});

    res.status(201).json(result);
  } catch (err) {
    console.error('[sessions] POST / error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// ============================================================
// GET /api/sessions/mine — list current user's sessions
// ============================================================
router.get('/mine', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const sessions = await store.getUserSessions(userId);
    res.json(sessions);
  } catch (err) {
    console.error('[sessions] GET /mine error:', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ============================================================
// GET /api/sessions/:token — get session by shareable token
// ============================================================
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const [state, members] = await Promise.all([
      store.getSessionState(session.id),
      store.getSessionMembers(session.id),
    ]);

    res.json({ session, state, members });
  } catch (err) {
    console.error('[sessions] GET /:token error:', err);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// ============================================================
// POST /api/sessions/:token/join — join session
// ============================================================
router.post('/:token/join', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (!session.isActive) { res.status(410).json({ error: 'Session has ended' }); return; }

    const member = await store.joinSession(session.id, userId);

    store.recordEvent('session.joined', {
      userId,
      entityType: 'session',
      entityId: session.id,
      metadata: { token: session.token },
    }).catch(() => {});

    const [state, members] = await Promise.all([
      store.getSessionState(session.id),
      store.getSessionMembers(session.id),
    ]);

    res.json({ session, state, members, member });
  } catch (err) {
    console.error('[sessions] POST /:token/join error:', err);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// ============================================================
// POST /api/sessions/:token/leave — leave session
// ============================================================
router.post('/:token/leave', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const left = await store.leaveSession(session.id, userId);
    if (!left) { res.status(404).json({ error: 'Not a member of this session' }); return; }

    store.recordEvent('session.left', {
      userId,
      entityType: 'session',
      entityId: session.id,
    }).catch(() => {});

    res.json({ message: 'Left session' });
  } catch (err) {
    console.error('[sessions] POST /:token/leave error:', err);
    res.status(500).json({ error: 'Failed to leave session' });
  }
});

// ============================================================
// GET /api/sessions/:token/state — get current playback state
// ============================================================
router.get('/:token/state', async (req: Request, res: Response) => {
  try {
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const state = await store.getSessionState(session.id);
    if (!state) { res.status(404).json({ error: 'Session state not found' }); return; }

    // Include current track details if available
    let currentTrack = null;
    if (state.currentTrackId) {
      currentTrack = await store.getTrack(state.currentTrackId) ?? null;
    }

    res.json({ state, currentTrack });
  } catch (err) {
    console.error('[sessions] GET /:token/state error:', err);
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

// ============================================================
// PUT /api/sessions/:token/state — update shared playback state
// Body: { action: 'play' | 'pause' | 'seek' | 'set_track' | 'next' | 'previous' | 'update_queue', ... }
// ============================================================
router.put('/:token/state', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (!session.isActive) { res.status(410).json({ error: 'Session has ended' }); return; }

    const { action, trackId, positionSec, queue } = req.body as {
      action: string;
      trackId?: string;
      positionSec?: number;
      queue?: string[];
    };

    if (!action) { res.status(400).json({ error: 'action is required' }); return; }

    const currentState = await store.getSessionState(session.id);
    if (!currentState) { res.status(404).json({ error: 'Session state not found' }); return; }

    const stateUpdate: Parameters<typeof store.updateSessionState>[2] = {};

    switch (action) {
      case 'play':
        stateUpdate.isPlaying = true;
        if (trackId) stateUpdate.currentTrackId = trackId;
        if (positionSec !== undefined) stateUpdate.positionSec = positionSec;
        break;

      case 'pause':
        stateUpdate.isPlaying = false;
        if (positionSec !== undefined) stateUpdate.positionSec = positionSec;
        break;

      case 'seek':
        if (positionSec === undefined) { res.status(400).json({ error: 'positionSec required for seek' }); return; }
        stateUpdate.positionSec = positionSec;
        break;

      case 'set_track':
        if (!trackId) { res.status(400).json({ error: 'trackId required for set_track' }); return; }
        stateUpdate.currentTrackId = trackId;
        stateUpdate.positionSec = positionSec ?? 0;
        stateUpdate.isPlaying = true;
        break;

      case 'next': {
        const q = currentState.queue;
        const curIdx = q.indexOf(currentState.currentTrackId ?? '');
        if (curIdx >= 0 && curIdx < q.length - 1) {
          stateUpdate.currentTrackId = q[curIdx + 1];
          stateUpdate.positionSec = 0;
          stateUpdate.isPlaying = true;
        }
        break;
      }

      case 'previous': {
        const q = currentState.queue;
        const curIdx = q.indexOf(currentState.currentTrackId ?? '');
        if (curIdx > 0) {
          stateUpdate.currentTrackId = q[curIdx - 1];
          stateUpdate.positionSec = 0;
          stateUpdate.isPlaying = true;
        }
        break;
      }

      case 'update_queue':
        if (!queue) { res.status(400).json({ error: 'queue required for update_queue' }); return; }
        stateUpdate.queue = queue;
        break;

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }

    const updated = await store.updateSessionState(session.id, userId, stateUpdate);

    // Record session event
    store.recordSessionEvent(session.id, userId, action, {
      trackId: stateUpdate.currentTrackId,
      positionSec: stateUpdate.positionSec,
    }).catch(() => {});

    // Also record in global event log
    store.recordEvent(`session.${action}`, {
      userId,
      entityType: 'session',
      entityId: session.id,
      metadata: { action, trackId: stateUpdate.currentTrackId },
    }).catch(() => {});

    // Include current track details
    let currentTrack = null;
    if (updated?.currentTrackId) {
      currentTrack = await store.getTrack(updated.currentTrackId) ?? null;
    }

    res.json({ state: updated, currentTrack });
  } catch (err) {
    console.error('[sessions] PUT /:token/state error:', err);
    res.status(500).json({ error: 'Failed to update state' });
  }
});

// ============================================================
// POST /api/sessions/:token/regenerate — get new shareable token
// ============================================================
router.post('/:token/regenerate', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.ownerId !== userId) { res.status(403).json({ error: 'Only the session owner can regenerate the token' }); return; }

    const newToken = await store.regenerateSessionToken(session.id, userId);
    if (!newToken) { res.status(500).json({ error: 'Failed to regenerate token' }); return; }

    res.json({ token: newToken, message: 'Token regenerated. Old links are now invalid.' });
  } catch (err) {
    console.error('[sessions] POST /:token/regenerate error:', err);
    res.status(500).json({ error: 'Failed to regenerate token' });
  }
});

// ============================================================
// POST /api/sessions/:token/end — end session (owner only)
// ============================================================
router.post('/:token/end', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.ownerId !== userId) { res.status(403).json({ error: 'Only the session owner can end it' }); return; }

    await store.endSession(session.id, userId);

    store.recordEvent('session.ended', {
      userId,
      entityType: 'session',
      entityId: session.id,
    }).catch(() => {});

    res.json({ message: 'Session ended' });
  } catch (err) {
    console.error('[sessions] POST /:token/end error:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// ============================================================
// GET /api/sessions/:token/events — session event history
// ============================================================
router.get('/:token/events', async (req: Request, res: Response) => {
  try {
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string, 10) || 50));

    const result = await store.getSessionEvents(session.id, { page, pageSize });
    res.json(result);
  } catch (err) {
    console.error('[sessions] GET /:token/events error:', err);
    res.status(500).json({ error: 'Failed to fetch session events' });
  }
});

// ============================================================
// GET /api/sessions/:token/members — list session members
// ============================================================
router.get('/:token/members', async (req: Request, res: Response) => {
  try {
    const session = await store.getSession(p(req.params.token));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const members = await store.getSessionMembers(session.id);
    res.json(members);
  } catch (err) {
    console.error('[sessions] GET /:token/members error:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

export default router;
