/**
 * Dependency checker — verifies external binaries (yt-dlp, ffmpeg/ffprobe)
 * are available at startup and provides runtime guards.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DepStatus {
  name: string;
  available: boolean;
  path: string;
  version: string | null;
  required: boolean;
  error: string | null;
}

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/** Cache — filled once by checkAll() */
let cachedStatus: DepStatus[] | null = null;

async function probe(bin: string, versionArgs: string[], required: boolean): Promise<DepStatus> {
  try {
    const { stdout } = await execFileAsync(bin, versionArgs, { timeout: 10_000 });
    const version = stdout.trim().split('\n')[0].slice(0, 120);
    return { name: bin, available: true, path: bin, version, required, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNotFound = msg.includes('ENOENT') || msg.includes('not found');
    return {
      name: bin,
      available: false,
      path: bin,
      version: null,
      required,
      error: isNotFound
        ? `Binary "${bin}" not found in PATH. Install it or set ${envVarFor(bin)} to the full path.`
        : msg.slice(0, 300),
    };
  }
}

function envVarFor(bin: string): string {
  if (bin === YT_DLP || bin === 'yt-dlp') return 'YT_DLP_PATH';
  if (bin === FFMPEG || bin === 'ffmpeg') return 'FFMPEG_PATH';
  if (bin === FFPROBE || bin === 'ffprobe') return 'FFPROBE_PATH';
  return `${bin.toUpperCase().replace(/-/g, '_')}_PATH`;
}

/** Check all dependencies. Caches result. */
export async function checkAll(): Promise<DepStatus[]> {
  const results = await Promise.all([
    probe(YT_DLP, ['--version'], true),
    probe(FFMPEG, ['-version'], true),
    probe(FFPROBE, ['-version'], false),
  ]);
  cachedStatus = results;
  return results;
}

/** Get cached status (or run check if not yet cached). */
export async function getStatus(): Promise<DepStatus[]> {
  if (cachedStatus) return cachedStatus;
  return checkAll();
}

/** Quick boolean: is yt-dlp available? */
export function ytDlpAvailable(): boolean {
  return cachedStatus?.find(d => d.name === YT_DLP)?.available ?? false;
}

/** Quick boolean: is ffmpeg available? */
export function ffmpegAvailable(): boolean {
  return cachedStatus?.find(d => d.name === FFMPEG)?.available ?? false;
}

/** Resolved yt-dlp binary path. */
export function ytDlpBin(): string { return YT_DLP; }

/** Resolved ffmpeg binary path. */
export function ffmpegBin(): string { return FFMPEG; }

/** Resolved ffprobe binary path. */
export function ffprobeBin(): string { return FFPROBE; }

/**
 * Log startup diagnostic banner.
 * Returns true if all required deps are available.
 */
export async function logStartupDiagnostics(): Promise<boolean> {
  const deps = await checkAll();
  let allOk = true;

  console.log('   Dependencies:');
  for (const d of deps) {
    if (d.available) {
      console.log(`     ✅ ${d.name}: ${d.version}`);
    } else if (d.required) {
      console.log(`     ❌ ${d.name}: NOT FOUND — ${d.error}`);
      allOk = false;
    } else {
      console.log(`     ⚠️  ${d.name}: not found (optional)`);
    }
  }

  if (!allOk) {
    console.log('');
    console.log('   ⚠️  Some required dependencies are missing!');
    console.log('   Audio download and enrichment will fail until they are installed.');
    console.log('   Install: pip install yt-dlp  |  apt install ffmpeg  (or brew install on macOS)');
  }

  return allOk;
}
