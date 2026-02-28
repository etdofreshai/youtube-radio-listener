/**
 * Lyrics fetching service.
 *
 * Strategies (tried in order):
 * 1. YouTube auto-generated subtitles via yt-dlp (most reliable for music videos)
 * 2. YouTube video description (sometimes contains lyrics)
 *
 * Returns plain text lyrics (no timestamps for now — timestamps would require
 * a more complex subtitle parsing pipeline).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ytDlpAvailable, ytDlpBin } from '../deps';
import * as store from '../store';

const execFileAsync = promisify(execFile);

export interface LyricsResult {
  lyrics: string;
  source: string; // 'youtube-subtitles' | 'youtube-description'
}

/**
 * Try to extract lyrics from YouTube subtitles (auto-generated captions).
 * yt-dlp can download subtitle tracks in various formats.
 */
async function fetchFromYouTubeSubtitles(youtubeUrl: string): Promise<string | null> {
  if (!ytDlpAvailable()) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-lyrics-'));
  const outputTemplate = path.join(tmpDir, 'subs');

  try {
    // Try to download auto-generated English subtitles
    const args = [
      '--no-playlist',
      '--skip-download',
      '--write-auto-subs',
      '--sub-lang', 'en',
      '--sub-format', 'vtt',
      '--output', outputTemplate,
      '--no-warnings',
      youtubeUrl,
    ];

    await execFileAsync(ytDlpBin(), args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Find the downloaded subtitle file
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vtt'));
    if (files.length === 0) return null;

    const vttContent = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8');
    return parseVttToPlainText(vttContent);
  } catch {
    return null;
  } finally {
    // Cleanup temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

/**
 * Parse VTT subtitle content into plain-text lyrics.
 * Removes timestamps, deduplicates repeated lines, strips HTML tags.
 */
function parseVttToPlainText(vtt: string): string | null {
  const lines = vtt.split('\n');
  const textLines: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip VTT header, timestamps, and empty lines
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT') continue;
    if (trimmed.startsWith('Kind:') || trimmed.startsWith('Language:')) continue;
    if (trimmed.startsWith('NOTE')) continue;
    if (/^\d{2}:\d{2}/.test(trimmed)) continue; // timestamp lines
    if (/^[0-9]+$/.test(trimmed)) continue; // cue index numbers
    if (trimmed.startsWith('align:') || trimmed.startsWith('position:')) continue;

    // Strip HTML tags (e.g., <c>, </c>, <00:01:23.456>)
    let clean = trimmed
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();

    if (!clean) continue;

    // Deduplicate (YouTube auto-subs often repeat lines)
    if (!seen.has(clean)) {
      seen.add(clean);
      textLines.push(clean);
    }
  }

  if (textLines.length < 3) return null; // Too few lines to be real lyrics
  return textLines.join('\n');
}

/**
 * Try to extract lyrics from YouTube video description.
 * Some uploads include full lyrics in the description.
 */
async function fetchFromDescription(trackId: string): Promise<string | null> {
  const track = await store.getTrack(trackId);
  if (!track?.ytDescription) return null;

  const desc = track.ytDescription;

  // Look for lyrics-like content in description
  // Common patterns: "Lyrics:" or "[Lyrics]" followed by verse text
  const lyricsMarkers = [
    /lyrics?\s*[:：]\s*\n/i,
    /\[lyrics?\]\s*\n/i,
    /\(lyrics?\)\s*\n/i,
  ];

  for (const marker of lyricsMarkers) {
    const match = desc.match(marker);
    if (match && match.index !== undefined) {
      const afterMarker = desc.slice(match.index + match[0].length).trim();
      // Take text until we hit a clearly non-lyric section
      const endMarkers = [/\n\s*(?:follow|subscribe|listen|stream|available|copyright|℗|©)/i, /\n\s*https?:\/\//];
      let lyricsText = afterMarker;
      for (const endMarker of endMarkers) {
        const endMatch = lyricsText.match(endMarker);
        if (endMatch && endMatch.index !== undefined) {
          lyricsText = lyricsText.slice(0, endMatch.index);
        }
      }
      lyricsText = lyricsText.trim();
      if (lyricsText.split('\n').length >= 4) {
        return lyricsText;
      }
    }
  }

  return null;
}

/**
 * Fetch lyrics for a track. Tries multiple sources.
 * Returns null if no lyrics found.
 */
export async function fetchLyrics(trackId: string): Promise<LyricsResult | null> {
  const track = await store.getTrack(trackId);
  if (!track) return null;

  // 1. Try YouTube description first (fast, no external calls if already enriched)
  const descLyrics = await fetchFromDescription(trackId);
  if (descLyrics) {
    return { lyrics: descLyrics, source: 'youtube-description' };
  }

  // 2. Try YouTube auto-subtitles
  const subLyrics = await fetchFromYouTubeSubtitles(track.youtubeUrl);
  if (subLyrics) {
    return { lyrics: subLyrics, source: 'youtube-subtitles' };
  }

  return null;
}

// Export for testing
export { parseVttToPlainText };
