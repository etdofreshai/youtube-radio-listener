import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import * as store from './store/memory';

const execFileAsync = promisify(execFile);

// Audio files directory
export const AUDIO_DIR = path.join(__dirname, '../../audio');

// Ensure audio dir exists
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

// Active downloads to prevent duplicates
const activeDownloads = new Set<string>();

/**
 * Download audio for a track using yt-dlp.
 * Runs in background (fire-and-forget from route handler).
 */
export async function downloadTrackAudio(trackId: string): Promise<void> {
  const track = store.getTrack(trackId);
  if (!track) throw new Error('Track not found');
  if (activeDownloads.has(trackId)) {
    console.log(`[downloader] Already downloading ${trackId}, skipping`);
    return;
  }

  activeDownloads.add(trackId);

  // Mark as downloading
  store.updateTrackAudio(trackId, {
    audioStatus: 'downloading',
    audioError: null,
  });

  try {
    const outputTemplate = path.join(AUDIO_DIR, `${trackId}.%(ext)s`);

    // Use yt-dlp to extract best audio and convert to opus (small, good quality)
    const args = [
      '--no-playlist',
      '--extract-audio',
      '--audio-format', 'opus',
      '--audio-quality', '128K',
      '--output', outputTemplate,
      '--no-overwrites',
      '--print', 'after_move:filepath',  // print final path after conversion
      '--print', 'duration',             // print duration in seconds
      '--restrict-filenames',
      '--no-warnings',
      track.youtubeUrl,
    ];

    console.log(`[downloader] Starting download for ${trackId}: ${track.youtubeUrl}`);
    const { stdout, stderr } = await execFileAsync(YT_DLP, args, {
      timeout: 300_000, // 5 min timeout
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr) {
      console.log(`[downloader] yt-dlp stderr for ${trackId}:`, stderr);
    }

    // Parse output: first line is duration (or NA), second is filepath
    const lines = stdout.trim().split('\n').filter(l => l.trim());
    let finalPath: string | null = null;
    let duration: number | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(AUDIO_DIR) || trimmed.startsWith('/')) {
        finalPath = trimmed;
      } else {
        const num = parseFloat(trimmed);
        if (!isNaN(num) && num > 0) {
          duration = Math.round(num);
        }
      }
    }

    // Also check if the file exists with expected name pattern
    if (!finalPath) {
      const candidates = fs.readdirSync(AUDIO_DIR).filter(f => f.startsWith(trackId + '.'));
      if (candidates.length > 0) {
        finalPath = path.join(AUDIO_DIR, candidates[0]);
      }
    }

    if (!finalPath || !fs.existsSync(finalPath)) {
      throw new Error('Download completed but audio file not found');
    }

    const filename = path.basename(finalPath);

    // If yt-dlp didn't give us duration, try ffprobe
    if (duration === null) {
      try {
        const { stdout: probeOut } = await execFileAsync('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'csv=p=0',
          finalPath,
        ], { timeout: 15_000 });
        const d = parseFloat(probeOut.trim());
        if (!isNaN(d) && d > 0) duration = Math.round(d);
      } catch {
        // duration remains null, that's fine
      }
    }

    console.log(`[downloader] ✅ Downloaded ${trackId}: ${filename} (${duration}s)`);

    store.updateTrackAudio(trackId, {
      audioStatus: 'ready',
      audioFilename: filename,
      duration,
      lastDownloadAt: new Date().toISOString(),
      audioError: null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[downloader] ❌ Failed ${trackId}:`, message);
    store.updateTrackAudio(trackId, {
      audioStatus: 'error',
      audioError: message.slice(0, 500),
    });
  } finally {
    activeDownloads.delete(trackId);
  }
}

/**
 * Re-download: remove existing file first, then download fresh.
 */
export async function refreshTrackAudio(trackId: string): Promise<void> {
  const track = store.getTrack(trackId);
  if (!track) throw new Error('Track not found');

  // Remove existing audio file if any
  if (track.audioFilename) {
    const filePath = path.join(AUDIO_DIR, track.audioFilename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }

  // Also remove any files matching this track id
  try {
    const candidates = fs.readdirSync(AUDIO_DIR).filter(f => f.startsWith(trackId + '.'));
    for (const f of candidates) {
      fs.unlinkSync(path.join(AUDIO_DIR, f));
    }
  } catch {
    // ignore
  }

  // Reset audio fields
  store.updateTrackAudio(trackId, {
    audioStatus: 'pending',
    audioFilename: null,
    audioError: null,
    duration: null,
    lastDownloadAt: null,
  });

  // Start fresh download
  return downloadTrackAudio(trackId);
}

/**
 * Delete audio files for a track (called on track deletion).
 */
export function deleteTrackAudio(trackId: string): void {
  try {
    const candidates = fs.readdirSync(AUDIO_DIR).filter(f => f.startsWith(trackId + '.'));
    for (const f of candidates) {
      fs.unlinkSync(path.join(AUDIO_DIR, f));
      console.log(`[downloader] 🗑 Deleted audio file: ${f}`);
    }
  } catch {
    // ignore — file may not exist
  }
}

/**
 * Get the full file path for a track's audio, with validation.
 */
export function getAudioFilePath(trackId: string): string | null {
  const track = store.getTrack(trackId);
  if (!track || !track.audioFilename) return null;

  // Validate filename doesn't escape audio dir
  const filename = path.basename(track.audioFilename);
  const filePath = path.join(AUDIO_DIR, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(AUDIO_DIR))) return null;

  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
