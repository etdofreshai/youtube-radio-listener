import { config as loadEnv } from 'dotenv';
import { AppConfig } from './types.js';

loadEnv();

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseFloat(v) : fallback;
}

export function loadConfig(): AppConfig {
  return {
    mode: envStr('SONG_EXPLORATIONS_MODE', 'dry-run') as AppConfig['mode'],
    youtubeApiKey: envStr('SONG_EXPLORATIONS_YOUTUBE_API_KEY', ''),
    dataDir: envStr('SONG_EXPLORATIONS_DATA_DIR', './data/song-explorations'),
    discoveryIntervalMinutes: envInt('SONG_EXPLORATIONS_DISCOVERY_INTERVAL_MINUTES', 20),
    hourlyImportCap: envInt('SONG_EXPLORATIONS_HOURLY_IMPORT_CAP', 20),
    minConfidenceScore: envFloat('SONG_EXPLORATIONS_MIN_CONFIDENCE_SCORE', 0.5),
    minDurationSeconds: envInt('SONG_EXPLORATIONS_MIN_DURATION_SECONDS', 90),
    maxDurationSeconds: envInt('SONG_EXPLORATIONS_MAX_DURATION_SECONDS', 600),
    logLevel: envStr('SONG_EXPLORATIONS_LOG_LEVEL', 'info') as AppConfig['logLevel'],
  };
}
