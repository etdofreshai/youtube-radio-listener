/**
 * usePlaybackSync — cross-device playback state synchronization.
 *
 * Responsibilities:
 * 1) On mount, fetch server playback state. If another device is playing,
 *    offer to resume (auto-resume if this device has nothing playing).
 * 2) Push local state changes (play/pause/seek/skip) to the server.
 * 3) Poll server every ~8s to detect state changes from other devices.
 * 4) Maintain queue and play history arrays synced to server.
 *
 * Design decision: polling (8s interval) instead of WebSocket.
 *   - Simpler to implement & deploy (no WS upgrade, works behind any proxy)
 *   - Acceptable latency for music playback sync (not real-time gaming)
 *   - Future: can add WebSocket/SSE for sub-second sync if needed.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAudioPlayer } from '../components/AudioPlayer';
import { getPlaybackState, updatePlaybackState } from '../api';
import { getEffectiveUserId } from '../api';
import type { Track } from '../types';
import type { PlaybackState, PlayHistoryEntry } from '../types';

const SYNC_INTERVAL_MS = 8_000;
const POSITION_PUSH_INTERVAL_MS = 15_000; // push position less frequently

export interface PlaybackSyncState {
  /** Server-synced queue (track IDs) */
  queue: string[];
  /** Server-synced play history entries */
  playHistory: PlayHistoryEntry[];
  /** Hydrated queue tracks from last server fetch */
  queueTracks: Track[];
  /** Hydrated history tracks from last server fetch */
  historyTracks: Track[];
  /** Whether we're currently synced with server */
  isSynced: boolean;
  /** Last sync time */
  lastSyncAt: string | null;
  /** Update the queue (local + push to server) */
  setQueue: (trackIds: string[]) => void;
  /** Jump to a track in the queue */
  jumpToQueueTrack: (trackId: string) => void;
  /** Play a track from history */
  replayFromHistory: (trackId: string) => void;
}

export function usePlaybackSync(): PlaybackSyncState {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    play,
    setPlaylist,
    playlistContext,
    queue: audioQueue,
    playFromQueue,
  } = useAudioPlayer();

  const [queue, setQueueState] = useState<string[]>([]);
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>([]);
  const [queueTracks, setQueueTracks] = useState<Track[]>([]);
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [isSynced, setIsSynced] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Refs to avoid stale closures
  const currentTrackRef = useRef(currentTrack);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const queueRef = useRef(queue);
  const lastPushRef = useRef<number>(0);
  const suppressPollRef = useRef(false); // suppress poll right after a push

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // Push state to server
  const pushState = useCallback(async (extra?: {
    currentTrackId?: string | null;
    isPlaying?: boolean;
    positionSec?: number;
    queue?: string[];
    addToHistory?: string;
  }) => {
    try {
      suppressPollRef.current = true;
      const data: any = { ...extra };
      // Always include current playing state
      if (data.currentTrackId === undefined && currentTrackRef.current) {
        data.currentTrackId = currentTrackRef.current.id;
      }
      if (data.isPlaying === undefined) {
        data.isPlaying = isPlayingRef.current;
      }
      if (data.positionSec === undefined) {
        data.positionSec = currentTimeRef.current;
      }
      if (data.queue === undefined) {
        data.queue = queueRef.current;
      }

      await updatePlaybackState(data);
      lastPushRef.current = Date.now();
      setIsSynced(true);
      setLastSyncAt(new Date().toISOString());

      // Allow polling again after a short delay
      setTimeout(() => { suppressPollRef.current = false; }, 3000);
    } catch (err) {
      console.error('[playbackSync] push failed:', err);
      setIsSynced(false);
    }
  }, []);

  // ── Playlist context watcher ──────────────────────────────────────────────
  // When a playlist starts, push all track IDs as the queue upfront.
  // When the playlist is cleared (user played a track directly), shrink queue.
  const prevPlaylistIdRef = useRef<string | null>(null);
  const playlistContextRef = useRef(playlistContext);
  useEffect(() => { playlistContextRef.current = playlistContext; }, [playlistContext]);

  useEffect(() => {
    const newId = playlistContext?.playlistId ?? null;
    const oldId = prevPlaylistIdRef.current;
    if (newId === oldId) return;
    prevPlaylistIdRef.current = newId;

    if (playlistContext) {
      // New playlist started — set sync queue to all playlist track IDs
      const trackIds = playlistContext.tracks.map(t => t.id);
      setQueueState(trackIds);
      queueRef.current = trackIds;
      // Also update queueTracks for immediate UI display
      setQueueTracks(playlistContext.tracks);
    } else if (oldId !== null) {
      // Playlist was cleared (user played a non-playlist track) — shrink queue
      if (currentTrackRef.current) {
        // Use the audioQueue from AudioPlayer (may contain page tracks)
        const newQueue = audioQueue.length > 0
          ? audioQueue.map(t => t.id)
          : [currentTrackRef.current.id];
        setQueueState(newQueue);
        queueRef.current = newQueue;
        if (audioQueue.length > 0) {
          setQueueTracks(audioQueue);
        }
      }
    }
  }, [playlistContext, audioQueue]);

  // Track changes: when current track changes, push + add to history
  const prevTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.id === prevTrackIdRef.current) return;

    const prevTrackId = prevTrackIdRef.current;
    prevTrackIdRef.current = currentTrack.id;

    // Add previous track to history (if it existed)
    const addToHistory = prevTrackId ?? undefined;

    // If in playlist mode, use the full playlist queue (already set by playlist watcher)
    // Otherwise, update queue incrementally
    if (playlistContextRef.current) {
      // Queue is already the full playlist — just push current state
      pushState({
        currentTrackId: currentTrack.id,
        isPlaying: true,
        positionSec: 0,
        queue: queueRef.current,
        addToHistory,
      });
    } else {
      // Not in playlist mode — add track to queue if not present
      const newQueue = [...queueRef.current];
      if (!newQueue.includes(currentTrack.id)) {
        const idx = newQueue.indexOf(prevTrackId ?? '');
        if (idx >= 0) {
          newQueue.splice(idx + 1, 0, currentTrack.id);
        } else {
          newQueue.push(currentTrack.id);
        }
        setQueueState(newQueue);
      }

      pushState({
        currentTrackId: currentTrack.id,
        isPlaying: true,
        positionSec: 0,
        queue: newQueue.length > 0 ? newQueue : queueRef.current,
        addToHistory,
      });
    }
  }, [currentTrack, pushState]);

  // Play/pause changes
  const prevIsPlayingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevIsPlayingRef.current === null) {
      prevIsPlayingRef.current = isPlaying;
      return;
    }
    if (prevIsPlayingRef.current === isPlaying) return;
    prevIsPlayingRef.current = isPlaying;

    if (currentTrackRef.current) {
      pushState({
        isPlaying,
        positionSec: currentTimeRef.current,
      });
    }
  }, [isPlaying, pushState]);

  // Periodic position push (less frequent to avoid spam)
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;

    const timer = setInterval(() => {
      if (currentTrackRef.current && isPlayingRef.current) {
        pushState({
          positionSec: currentTimeRef.current,
        });
      }
    }, POSITION_PUSH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isPlaying, currentTrack, pushState]);

  // Poll server for state from other devices
  useEffect(() => {
    const userId = getEffectiveUserId();
    if (!userId) return;

    // Initial fetch
    let cancelled = false;
    const fetchState = async () => {
      if (suppressPollRef.current) return;
      try {
        const state = await getPlaybackState();
        if (cancelled) return;

        setLastSyncAt(new Date().toISOString());
        setIsSynced(true);

        // Update hydrated data
        if (state.queueTracks) setQueueTracks(state.queueTracks);
        if (state.historyTracks) setHistoryTracks(state.historyTracks);
        if (state.playHistory) setPlayHistory(state.playHistory);
        if (state.queue) setQueueState(state.queue);

        // If nothing is playing locally but server has state, that's fine —
        // we just show the queue/history from server.
        // We don't auto-resume to avoid hijacking the current device.
      } catch (err) {
        if (!cancelled) setIsSynced(false);
      }
    };

    fetchState();
    const timer = setInterval(fetchState, SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Set queue + push to server
  const setQueue = useCallback((trackIds: string[]) => {
    setQueueState(trackIds);
    pushState({ queue: trackIds });
  }, [pushState]);

  // Jump to a track in the queue (preserves playlist context)
  const jumpToQueueTrack = useCallback((trackId: string) => {
    // Prefer audioQueue (has Track objects immediately) over server-hydrated queueTracks
    const track = audioQueue.find(t => t.id === trackId) ?? queueTracks.find(t => t.id === trackId);
    if (track) {
      playFromQueue(track);
    }
  }, [audioQueue, queueTracks, playFromQueue]);

  // Replay a track from history
  const replayFromHistory = useCallback((trackId: string) => {
    const track = historyTracks.find(t => t.id === trackId);
    if (track) {
      play(track);
    }
  }, [historyTracks, play]);

  return {
    queue,
    playHistory,
    queueTracks,
    historyTracks,
    isSynced,
    lastSyncAt,
    setQueue,
    jumpToQueueTrack,
    replayFromHistory,
  };
}
