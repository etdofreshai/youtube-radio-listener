/**
 * Compute effective (trimmed) duration for a track.
 *
 * Priority:
 *   1. If both startTimeSec and endTimeSec exist → end - start
 *   2. If only endTimeSec exists → endTimeSec  (plays from 0 to end)
 *   3. If only startTimeSec exists and original duration is known → duration - start
 *   4. Fallback to original duration
 *
 * Returns null when the effective duration cannot be determined.
 * Returns null for invalid trim states (e.g. start >= end).
 */

export interface DurationInfo {
  /** The effective (possibly trimmed) duration in seconds, or null if unknown */
  effective: number | null;
  /** The original full-track duration in seconds, or null if unknown */
  original: number | null;
  /** Whether the effective duration differs from the original due to trim */
  isTrimmed: boolean;
}

export function getEffectiveDuration(
  duration: number | null,
  startTimeSec: number | null,
  endTimeSec: number | null,
): DurationInfo {
  const original = duration;
  const hasStart = startTimeSec != null && startTimeSec > 0;
  const hasEnd = endTimeSec != null && endTimeSec > 0;

  // No trim at all → original duration
  if (!hasStart && !hasEnd) {
    return { effective: original, original, isTrimmed: false };
  }

  // Both start and end
  if (hasStart && hasEnd) {
    // Invalid: start >= end
    if (startTimeSec! >= endTimeSec!) {
      return { effective: null, original, isTrimmed: false };
    }
    const eff = endTimeSec! - startTimeSec!;
    const trimmed = original == null || Math.abs(eff - original) > 0.5;
    return { effective: eff, original, isTrimmed: trimmed };
  }

  // Only end → plays from 0 to end
  if (hasEnd && !hasStart) {
    const eff = endTimeSec!;
    const trimmed = original == null || Math.abs(eff - original) > 0.5;
    return { effective: eff, original, isTrimmed: trimmed };
  }

  // Only start → plays from start to end of track
  if (hasStart && !hasEnd) {
    if (original != null && original > startTimeSec!) {
      const eff = original - startTimeSec!;
      return { effective: eff, original, isTrimmed: true };
    }
    // Can't compute without knowing total duration, or start >= duration
    // Still trimmed because a start offset is set
    return { effective: null, original, isTrimmed: true };
  }

  // Shouldn't reach here
  return { effective: original, original, isTrimmed: false };
}

/**
 * Compute effective duration from editable string fields (edit mode).
 * Parses start/end from time strings, then delegates to getEffectiveDuration.
 */
export function getEffectiveDurationFromStrings(
  originalDuration: number | null,
  startTimeStr: string,
  endTimeStr: string,
  parseTimeFn: (s: string) => { ok: true; value: number } | { ok: false; error: string } | null,
): DurationInfo {
  let startSec: number | null = null;
  let endSec: number | null = null;

  if (startTimeStr.trim()) {
    const parsed = parseTimeFn(startTimeStr);
    if (parsed && parsed.ok) startSec = parsed.value;
  }

  if (endTimeStr.trim()) {
    const parsed = parseTimeFn(endTimeStr);
    if (parsed && parsed.ok) endSec = parsed.value;
  }

  return getEffectiveDuration(originalDuration, startSec, endSec);
}
