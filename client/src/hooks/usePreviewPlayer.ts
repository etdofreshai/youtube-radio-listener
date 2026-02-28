/**
 * usePreviewPlayer — lightweight audio preview for YouTube search results.
 *
 * Manages a single HTMLAudioElement for preview playback.
 * Only one preview can play at a time across all search results.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { getPreviewUrl } from '../api';
import { derivePreviewState } from './previewState';
export type { PreviewState } from './previewState';

export interface UsePreviewPlayerReturn {
  /** Start or resume preview for a video. Stops any other active preview. */
  play: (videoId: string) => void;
  /** Pause the currently playing preview. */
  pause: () => void;
  /** Stop and reset the current preview to idle. */
  stop: () => void;
  /** Get the preview state for a specific videoId */
  getState: (videoId: string) => import('./previewState').PreviewState;
  /** Get error message for the active preview (null if no error) */
  errorMessage: string | null;
  /** The videoId currently being previewed (or null) */
  activeVideoId: string | null;
}

export function usePreviewPlayer(): UsePreviewPlayerReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<import('./previewState').PreviewState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audio.volume = 0.7; // Preview at moderate volume
    audioRef.current = audio;

    const onPlaying = () => setActiveState('playing');
    const onPause = () => {
      // Only set paused if we didn't trigger a stop
      setActiveState(prev => (prev === 'idle' ? 'idle' : 'paused'));
    };
    const onError = () => {
      setActiveState('error');
      setErrorMessage('Preview unavailable for this video');
    };
    const onEnded = () => {
      setActiveState('idle');
      setActiveVideoId(null);
    };

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
      audio.src = '';
    };
  }, []);

  const play = useCallback((videoId: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    // If same video is paused, resume
    if (activeVideoId === videoId && activeState === 'paused') {
      audio.play().catch(() => {
        setActiveState('error');
        setErrorMessage('Failed to resume preview');
      });
      return;
    }

    // Stop current preview, start new one
    audio.pause();
    audio.currentTime = 0;
    setErrorMessage(null);
    setActiveVideoId(videoId);
    setActiveState('loading');

    audio.src = getPreviewUrl(videoId);
    audio.load();
    audio.play().catch(() => {
      setActiveState('error');
      setErrorMessage('Preview unavailable for this video');
    });
  }, [activeVideoId, activeState]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || activeState !== 'playing') return;
    audio.pause();
  }, [activeState]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
    setActiveVideoId(null);
    setActiveState('idle');
    setErrorMessage(null);
  }, []);

  const getState = useCallback(
    (videoId: string) => derivePreviewState(videoId, activeVideoId, activeState),
    [activeVideoId, activeState],
  );

  return { play, pause, stop, getState, errorMessage, activeVideoId };
}
