/**
 * Tests for song-explorations config defaults and recommendation schema validation.
 *
 * Run: node --import tsx --test server/src/song-explorations/config.test.ts
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';
import {
  RecommendationResponseSchema,
  RecommendedTrackSchema,
  parseAndValidateResponse,
  buildRecommendationPrompt,
  type RecommendedTrack,
  type RecommendationResponse,
} from './adapters/cloud-agent-sdk.js';
import { loadDbSeedTracks } from './utils/db-seeds.js';

// Store original env
const originalEnv = { ...process.env };

describe('loadConfig', () => {
  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('uses default discovery interval of 60 minutes (hourly)', () => {
    delete process.env.SONG_EXPLORATIONS_DISCOVERY_INTERVAL_MINUTES;
    const config = loadConfig();
    assert.equal(config.discoveryIntervalMinutes, 60, 'Default interval should be 60 minutes');
  });

  it('uses default hourly import cap of 5 tracks', () => {
    delete process.env.SONG_EXPLORATIONS_HOURLY_IMPORT_CAP;
    const config = loadConfig();
    assert.equal(config.hourlyImportCap, 5, 'Default cap should be 5 tracks per hour');
  });

  it('uses default recommendation settings', () => {
    delete process.env.RECOMMENDATION_ENABLED;
    delete process.env.RECOMMENDATION_INTERVAL_MINUTES;
    delete process.env.RECOMMENDATION_ADD_PER_RUN;
    delete process.env.RECOMMENDATION_MODEL;
    
    const config = loadConfig();
    assert.equal(config.recommendation.enabled, true, 'Recommendations should be enabled by default');
    assert.equal(config.recommendation.intervalMinutes, 60, 'Recommendation interval should be 60 minutes');
    assert.equal(config.recommendation.addPerRunCap, 5, 'Should add 5 tracks per run by default');
    assert.equal(config.recommendation.model, 'gpt-4o', 'Default model should be gpt-4o');
  });

  it('allows overriding recommendation settings via env', () => {
    process.env.RECOMMENDATION_ENABLED = 'false';
    process.env.RECOMMENDATION_INTERVAL_MINUTES = '120';
    process.env.RECOMMENDATION_ADD_PER_RUN = '10';
    process.env.RECOMMENDATION_MODEL = 'gpt-4o-mini';
    
    const config = loadConfig();
    assert.equal(config.recommendation.enabled, false);
    assert.equal(config.recommendation.intervalMinutes, 120);
    assert.equal(config.recommendation.addPerRunCap, 10);
    assert.equal(config.recommendation.model, 'gpt-4o-mini');
  });

  it('loads Cloud Agent OAuth token from env', () => {
    process.env.CLOUD_AGENT_OAUTH_TOKEN = 'test-token-12345';
    const config = loadConfig();
    assert.equal(config.recommendation.cloudAgentOAuthToken, 'test-token-12345');
  });
});

describe('RecommendationResponseSchema', () => {
  it('validates a valid response', () => {
    const valid: RecommendationResponse = {
      recommendations: [
        {
          videoId: 'abc123defgh',
          title: 'Test Track',
          channelName: 'Test Artist',
          confidence: 0.85,
          reason: 'Similar to your taste',
        },
      ],
    };
    
    const result = RecommendationResponseSchema.safeParse(valid);
    assert.ok(result.success, 'Should parse valid response');
  });

  it('rejects videoId not exactly 11 chars', () => {
    const invalid = {
      recommendations: [
        {
          videoId: 'too-short',
          title: 'Test Track',
          channelName: 'Test Artist',
          confidence: 0.85,
          reason: 'Test',
        },
      ],
    };
    
    const result = RecommendationResponseSchema.safeParse(invalid);
    assert.ok(!result.success, 'Should reject invalid videoId length');
  });

  it('rejects confidence outside 0-1 range', () => {
    const invalid = {
      recommendations: [
        {
          videoId: 'abc123defgh',
          title: 'Test Track',
          channelName: 'Test Artist',
          confidence: 1.5,
          reason: 'Test',
        },
      ],
    };
    
    const result = RecommendationResponseSchema.safeParse(invalid);
    assert.ok(!result.success, 'Should reject confidence > 1');
  });

  it('accepts empty recommendations array', () => {
    const valid: RecommendationResponse = {
      recommendations: [],
      notes: 'No matches found',
    };
    
    const result = RecommendationResponseSchema.safeParse(valid);
    assert.ok(result.success, 'Should accept empty recommendations');
  });

  it('validates optional fields', () => {
    const valid = {
      recommendations: [],
      model: 'gpt-4o',
      generatedAt: '2024-01-15T10:30:00Z',
      notes: 'Test notes',
    };
    
    const result = RecommendationResponseSchema.safeParse(valid);
    assert.ok(result.success, 'Should accept optional fields');
  });
});

describe('RecommendedTrackSchema', () => {
  it('requires videoId, title, channelName, confidence, reason', () => {
    const valid: RecommendedTrack = {
      videoId: 'abc123defgh',
      title: 'Track Title',
      channelName: 'Artist Name',
      confidence: 0.75,
      reason: 'Matches your library',
    };
    
    const result = RecommendedTrackSchema.safeParse(valid);
    assert.ok(result.success);
  });

  it('accepts optional channelId and durationSeconds', () => {
    const valid = {
      videoId: 'abc123defgh',
      title: 'Track',
      channelName: 'Artist',
      channelId: 'UC1234567890',
      durationSeconds: 240,
      confidence: 0.8,
      reason: 'Test',
    };
    
    const result = RecommendedTrackSchema.safeParse(valid);
    assert.ok(result.success);
  });

  it('rejects duration outside valid range', () => {
    const tooShort = {
      videoId: 'abc123defgh',
      title: 'Track',
      channelName: 'Artist',
      durationSeconds: 30, // Below 60 min
      confidence: 0.8,
      reason: 'Test',
    };
    
    const result = RecommendedTrackSchema.safeParse(tooShort);
    assert.ok(!result.success, 'Should reject duration < 60');
  });
});

describe('parseAndValidateResponse', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      recommendations: [
        {
          videoId: 'abc123defgh',
          title: 'Test',
          channelName: 'Artist',
          confidence: 0.9,
          reason: 'Good match',
        },
      ],
    });
    
    const result = parseAndValidateResponse(json);
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].videoId, 'abc123defgh');
  });

  it('returns empty array with error note for invalid JSON', () => {
    const invalidJson = 'not valid json {';
    
    const result = parseAndValidateResponse(invalidJson);
    assert.equal(result.recommendations.length, 0);
    assert.ok(result.notes?.includes('Failed to parse'));
  });

  it('returns empty array with error note for schema validation failure', () => {
    const invalidSchema = JSON.stringify({
      recommendations: [
        {
          videoId: 'bad', // Too short
          title: 'Test',
          channelName: 'Artist',
          confidence: 5, // Out of range
          reason: 'Test',
        },
      ],
    });
    
    const result = parseAndValidateResponse(invalidSchema);
    assert.equal(result.recommendations.length, 0);
    assert.ok(result.notes?.includes('Validation failed'));
  });
});

describe('loadDbSeedTracks', () => {
  it('returns empty array when DATABASE_URL is not set', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const seeds = await loadDbSeedTracks(10);
    assert.equal(Array.isArray(seeds), true);
    assert.equal(seeds.length, 0, 'Should return [] without DATABASE_URL');

    if (saved !== undefined) process.env.DATABASE_URL = saved;
  });
});

describe('buildRecommendationPrompt', () => {
  it('includes seed tracks in prompt', () => {
    const tracks = [
      { videoId: 'aaa11111111', title: 'Track A', channelName: 'Artist A', channelId: 'UC1', durationSeconds: 180, addedAt: '2024-01-01T00:00:00Z', source: { type: 'seed' } as const, confidence: 0.9, plays: 100, lastPlayedAt: null },
      { videoId: 'bbb22222222', title: 'Track B', channelName: 'Artist B', channelId: 'UC2', durationSeconds: 200, addedAt: '2024-01-02T00:00:00Z', source: { type: 'seed' } as const, confidence: 0.8, plays: 50, lastPlayedAt: null },
    ];
    
    const prompt = buildRecommendationPrompt(tracks, 5);
    
    assert.ok(prompt.includes('Track A'));
    assert.ok(prompt.includes('Artist A'));
    assert.ok(prompt.includes('Track B'));
    assert.ok(prompt.includes('Artist B'));
  });

  it('respects maxRecommendations parameter', () => {
    const tracks = [
      { videoId: 'aaa11111111', title: 'Track', channelName: 'Artist', channelId: 'UC1', durationSeconds: 180, addedAt: '2024-01-01T00:00:00Z', source: { type: 'seed' } as const, confidence: 0.9, plays: 100, lastPlayedAt: null },
    ];
    
    const prompt = buildRecommendationPrompt(tracks, 3);
    assert.ok(prompt.includes('recommend 3'));
    assert.ok(prompt.includes('up to 3'));
  });

  it('includes JSON schema in prompt', () => {
    const tracks: any[] = [];
    const prompt = buildRecommendationPrompt(tracks, 5);
    
    assert.ok(prompt.includes('"videoId"'));
    assert.ok(prompt.includes('"confidence"'));
    assert.ok(prompt.includes('"recommendations"'));
  });
});
