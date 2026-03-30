/**
 * Playback State API — cross-device sync for user playback position, queue, and history.
 *
 * GET  /api/playback/state         — fetch current user's playback state
 * POST /api/playback/state         — update current user's playback state
 * GET  /api/playback/next          — get next recommended track (Last.fm-based)
 * GET  /api/playback/next?prefetch — also trigger background download if not cached
 */

import { Router, Request, Response } from 'express';
import * as store from '../store';
import type { UpdatePlaybackStateInput, PlayHistoryEntry } from '../types';
import { getNextTrack } from '../services/auto-next';
import { downloadTrackAudio } from '../downloader';

const router = Router();

const MAX_HISTORY = 50;   // cap play_history length
const MAX_QUEUE = 500;    // cap queue length

function getActorId(req: Request): string {
  return req.headers['x-user-id'] as string || '00000000-0000-0000-0000-000000000001';
}

// ============================================================
// GET /api/playback/state — fetch user's playback state
// ============================================================
router.get('/state', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const state = await store.getPlaybackState(userId);

    if (!state) {
      // Return empty default state (user hasn't played anything yet)
      return res.json({
        userId,
        currentTrackId: null,
        positionSec: 0,
        isPlaying: false,
        queue: [],
        playHistory: [],
        updatedAt: new Date().toISOString(),
        currentTrack: null,
        queueTracks: [],
        historyTracks: [],
      });
    }

    // Hydrate track details for currentTrack, queue, and history
    const [currentTrack, queueTracks, historyTracks] = await Promise.all([
      state.currentTrackId ? store.getTrack(state.currentTrackId).then(t => t ?? null) : Promise.resolve(null),
      Promise.all(state.queue.slice(0, 50).map(id => store.getTrack(id))).then(tracks => tracks.filter(Boolean)),
      Promise.all(state.playHistory.slice(0, 20).map(entry => store.getTrack(entry.trackId))).then(tracks => tracks.filter(Boolean)),
    ]);

    res.json({
      ...state,
      currentTrack,
      queueTracks,
      historyTracks,
    });
  } catch (err) {
    console.error('[playback] GET /state error:', err);
    res.status(500).json({ error: 'Failed to fetch playback state' });
  }
});

// ============================================================
// POST /api/playback/state — update user's playback state
// Body: { currentTrackId?, positionSec?, isPlaying?, queue?, addToHistory?: trackId }
// ============================================================
router.post('/state', async (req: Request, res: Response) => {
  try {
    const userId = getActorId(req);
    const { currentTrackId, positionSec, isPlaying, queue, addToHistory } = req.body as {
      currentTrackId?: string | null;
      positionSec?: number;
      isPlaying?: boolean;
      queue?: string[];
      addToHistory?: string;  // track ID to prepend to history
    };

    const update: UpdatePlaybackStateInput = {};

    if (currentTrackId !== undefined) update.currentTrackId = currentTrackId;
    if (positionSec !== undefined) update.positionSec = positionSec;
    if (isPlaying !== undefined) update.isPlaying = isPlaying;
    if (queue !== undefined) update.queue = queue.slice(0, MAX_QUEUE);

    // If addToHistory is provided, prepend to existing history
    if (addToHistory) {
      const existing = await store.getPlaybackState(userId);
      const history: PlayHistoryEntry[] = existing?.playHistory ?? [];
      const entry: PlayHistoryEntry = {
        trackId: addToHistory,
        playedAt: new Date().toISOString(),
      };
      // Remove duplicate if same track was last played
      const dedupedHistory = history.filter(h => h.trackId !== addToHistory);
      update.playHistory = [entry, ...dedupedHistory].slice(0, MAX_HISTORY);
    }

    const state = await store.upsertPlaybackState(userId, update);

    // Record event for audit trail
    store.recordEvent('playback.state_updated', {
      userId,
      entityType: 'playback',
      metadata: {
        currentTrackId: update.currentTrackId,
        isPlaying: update.isPlaying,
        positionSec: update.positionSec,
      },
    }).catch(() => {});

    res.json(state);
  } catch (err) {
    console.error('[playback] POST /state error:', err);
    res.status(500).json({ error: 'Failed to update playback state' });
  }
});

// ============================================================
// GET /api/playback/next?currentTrackId=<id>[&prefetch=true]
// Returns the next recommended track based on Last.fm similarity.
// When prefetch=true and the track isn't cached, kicks off a background download.
// ============================================================
router.get('/next', async (req: Request, res: Response) => {
  try {
    const currentTrackId = req.query.currentTrackId as string | undefined;
    const prefetch = req.query.prefetch === 'true' || req.query.prefetch === '1';

    if (!currentTrackId) {
      return res.status(400).json({ error: 'currentTrackId query param is required' });
    }

    const result = await getNextTrack(currentTrackId);

    if (!result) {
      return res.status(404).json({ error: 'No recommendation available' });
    }

    // If prefetch requested and the track is in our library but not cached, download it
    const autoPrefetch = process.env.AUTO_NEXT_PREFETCH !== 'false';
    if ((prefetch || autoPrefetch) && result.needsDownload && result.track.id) {
      // Fire-and-forget background download
      downloadTrackAudio(result.track.id).catch((err: unknown) => {
        console.error(`[playback] Background prefetch download failed for ${result.track.id}:`, err);
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[playback] GET /next error:', err);
    res.status(500).json({ error: 'Failed to get next track recommendation' });
  }
});

export default router;
