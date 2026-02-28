/**
 * End-time string parser.
 *
 * Accepted formats (all parts are non-negative integers):
 *   "95"         → 95 seconds
 *   "1:35"       → 95 seconds  (minutes:seconds)
 *   "1:35:250"   → 95.25 secs  (minutes:seconds:milliseconds)
 *
 * Empty / whitespace-only input → null (meaning "no end time").
 */

export interface ParseSuccess {
  ok: true;
  /** Numeric seconds (may include fractional part when ms are given) */
  value: number;
}

export interface ParseError {
  ok: false;
  error: string;
}

export type ParseResult = ParseSuccess | ParseError;

const FORMAT_HINT =
  'Use: seconds (e.g. 95), MM:SS (e.g. 1:35), or MM:SS:mmm (e.g. 1:35:250).';

/** Returns true only for strings that are one or more decimal digits. */
function isNonNegativeInt(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Parse an end-time string.
 *
 * @returns null    – if input is blank (no end time)
 * @returns ParseResult – ParseSuccess or ParseError for non-blank input
 */
export function parseEndTime(raw: string): ParseResult | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split(':');

  if (parts.length === 1) {
    // ── Seconds only ──────────────────────────────────────────────
    const sStr = parts[0];
    if (!isNonNegativeInt(sStr)) {
      return { ok: false, error: `Invalid value "${sStr}". ${FORMAT_HINT}` };
    }
    return { ok: true, value: parseInt(sStr, 10) };
  }

  if (parts.length === 2) {
    // ── MM:SS ────────────────────────────────────────────────────
    const [mStr, sStr] = parts;
    if (!isNonNegativeInt(mStr)) {
      return { ok: false, error: `Invalid minutes "${mStr}". ${FORMAT_HINT}` };
    }
    if (!isNonNegativeInt(sStr)) {
      return { ok: false, error: `Invalid seconds "${sStr}". ${FORMAT_HINT}` };
    }
    const sec = parseInt(sStr, 10);
    if (sec >= 60) {
      return { ok: false, error: `Seconds must be 0–59, got ${sec}. ${FORMAT_HINT}` };
    }
    return { ok: true, value: parseInt(mStr, 10) * 60 + sec };
  }

  if (parts.length === 3) {
    // ── MM:SS:mmm ────────────────────────────────────────────────
    const [mStr, sStr, msStr] = parts;
    if (!isNonNegativeInt(mStr)) {
      return { ok: false, error: `Invalid minutes "${mStr}". ${FORMAT_HINT}` };
    }
    if (!isNonNegativeInt(sStr)) {
      return { ok: false, error: `Invalid seconds "${sStr}". ${FORMAT_HINT}` };
    }
    if (!isNonNegativeInt(msStr)) {
      return { ok: false, error: `Invalid milliseconds "${msStr}". ${FORMAT_HINT}` };
    }
    const sec = parseInt(sStr, 10);
    const ms = parseInt(msStr, 10);
    if (sec >= 60) {
      return { ok: false, error: `Seconds must be 0–59, got ${sec}. ${FORMAT_HINT}` };
    }
    if (ms >= 1000) {
      return { ok: false, error: `Milliseconds must be 0–999, got ${ms}. ${FORMAT_HINT}` };
    }
    return {
      ok: true,
      value: parseInt(mStr, 10) * 60 + sec + ms / 1000,
    };
  }

  return {
    ok: false,
    error: `Too many colons in "${trimmed}". ${FORMAT_HINT}`,
  };
}
