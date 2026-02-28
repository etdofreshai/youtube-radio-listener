/**
 * Pure state logic for preview player — no browser/framework dependencies.
 * Extracted for testability.
 */

export type PreviewState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/**
 * Derive the display state for a given videoId based on the
 * active player state.
 */
export function derivePreviewState(
  videoId: string,
  activeVideoId: string | null,
  activeState: PreviewState,
): PreviewState {
  if (activeVideoId !== videoId) return 'idle';
  return activeState;
}

/**
 * Compute the next player state after a play action.
 * Returns [nextActiveVideoId, nextActiveState].
 */
export function computePlayTransition(
  targetVideoId: string,
  currentActiveVideoId: string | null,
  currentActiveState: PreviewState,
): [string, PreviewState] {
  // If resuming a paused preview of the same video
  if (currentActiveVideoId === targetVideoId && currentActiveState === 'paused') {
    return [targetVideoId, 'playing'];
  }
  // Starting a new preview (or restarting after error/idle)
  return [targetVideoId, 'loading'];
}

/**
 * Compute the next player state after a pause action.
 */
export function computePauseTransition(
  currentActiveVideoId: string | null,
  currentActiveState: PreviewState,
): [string | null, PreviewState] {
  if (!currentActiveVideoId || currentActiveState !== 'playing') {
    return [currentActiveVideoId, currentActiveState];
  }
  return [currentActiveVideoId, 'paused'];
}

/**
 * Compute the next player state after a stop action.
 */
export function computeStopTransition(): [null, PreviewState] {
  return [null, 'idle'];
}
