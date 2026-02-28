import { config as loadEnv } from 'dotenv';
import { AppConfig, RecommendationConfig } from './types.js';

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

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

export function loadConfig(): AppConfig {
  const recommendationConfig: RecommendationConfig = {
    enabled: envBool('RECOMMENDATION_ENABLED', true),
    intervalMinutes: envInt('RECOMMENDATION_INTERVAL_MINUTES', 60),
    addPerRunCap: envInt('RECOMMENDATION_ADD_PER_RUN', 5),
    claudeCodeOAuthToken: envStr('CLAUDE_CODE_OAUTH_TOKEN', ''),
    model: envStr('CLAUDE_CODE_RECOMMENDATION_MODEL', 'haiku'),
  };

  return {
    mode: envStr('SONG_EXPLORATIONS_MODE', 'dry-run') as AppConfig['mode'],
    youtubeApiKey: envStr('SONG_EXPLORATIONS_YOUTUBE_API_KEY', ''),
    dataDir: envStr('SONG_EXPLORATIONS_DATA_DIR', './data/song-explorations'),
    // Changed from 20 to 60 minutes (hourly cadence per ET request)
    discoveryIntervalMinutes: envInt('SONG_EXPLORATIONS_DISCOVERY_INTERVAL_MINUTES', 60),
    // Changed from 20 to 5 tracks per hour (per ET request)
    hourlyImportCap: envInt('SONG_EXPLORATIONS_HOURLY_IMPORT_CAP', 5),
    minConfidenceScore: envFloat('SONG_EXPLORATIONS_MIN_CONFIDENCE_SCORE', 0.5),
    minDurationSeconds: envInt('SONG_EXPLORATIONS_MIN_DURATION_SECONDS', 90),
    maxDurationSeconds: envInt('SONG_EXPLORATIONS_MAX_DURATION_SECONDS', 600),
    logLevel: envStr('SONG_EXPLORATIONS_LOG_LEVEL', 'info') as AppConfig['logLevel'],
    recommendation: recommendationConfig,
  };
}
