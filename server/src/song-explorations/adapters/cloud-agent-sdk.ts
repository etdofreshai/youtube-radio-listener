/**
 * Cloud Agent SDK adapter for AI-powered music recommendations.
 *
 * Uses a one-shot prompt flow with strict JSON output schema for reliable parsing.
 * Designed to be adapter-based so real OAuth-backed calls can be plugged in cleanly.
 */
import type { Track } from '../types.js';
import { z } from 'zod';

// ─── JSON Schema for Recommendations ───

/**
 * Schema for a single recommended track from the AI.
 */
export const RecommendedTrackSchema = z.object({
  /** YouTube video ID */
  videoId: z.string().min(11).max(11),
  /** Track title as it appears on YouTube */
  title: z.string().min(1).max(500),
  /** Channel/uploader name */
  channelName: z.string().min(1).max(200),
  /** Channel ID (optional but helpful for deduplication) */
  channelId: z.string().optional(),
  /** Duration in seconds (approximate) */
  durationSeconds: z.number().int().min(60).max(1800).optional(),
  /** Confidence score 0-1 indicating how well this matches the user's taste */
  confidence: z.number().min(0).max(1),
  /** Brief explanation of why this track was recommended */
  reason: z.string().min(1).max(500),
});

/**
 * Schema for the full AI response.
 */
export const RecommendationResponseSchema = z.object({
  /** Array of recommended tracks (0-N) */
  recommendations: z.array(RecommendedTrackSchema),
  /** AI model used for generation */
  model: z.string().optional(),
  /** Timestamp of generation */
  generatedAt: z.string().datetime().optional(),
  /** Any warnings or notes from the AI */
  notes: z.string().optional(),
});

export type RecommendedTrack = z.infer<typeof RecommendedTrackSchema>;
export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;

// ─── Prompt Template ───

/**
 * Build the recommendation prompt using existing tracks as seed context.
 */
export function buildRecommendationPrompt(
  existingTracks: Track[],
  maxRecommendations: number,
): string {
  // Build context from top-played tracks (seed context)
  const topTracks = [...existingTracks]
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 20);

  const recentTracks = [...existingTracks]
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    .slice(0, 10);

  const uniqueSeeds = new Map<string, Track>();
  [...topTracks, ...recentTracks].forEach(t => uniqueSeeds.set(t.videoId, t));
  const seedList = [...uniqueSeeds.values()].slice(0, 25);

  const seedContext = seedList.map(t =>
    `- "${t.title}" by ${t.channelName} (plays: ${t.plays})`
  ).join('\n');

  return `You are a music recommendation engine. Based on the user's existing music library, recommend ${maxRecommendations} new YouTube music tracks that would fit their taste.

## User's Current Library (seed context)
${seedContext}

## Task
Recommend up to ${maxRecommendations} tracks that:
1. Match the style/genre/era of the user's existing tracks
2. Are NOT already in their library (avoid duplicates)
3. Are actual music (not tutorials, reactions, podcasts, etc.)
4. Have high-quality official or well-produced uploads
5. Would complement their listening patterns

## Output Format
Respond with ONLY valid JSON matching this exact schema:
{
  "recommendations": [
    {
      "videoId": "11-char-youtube-id",
      "title": "Track Title",
      "channelName": "Artist/Channel Name",
      "channelId": "UC...",
      "durationSeconds": 240,
      "confidence": 0.85,
      "reason": "Brief explanation of why this fits"
    }
  ],
  "model": "optional-model-name",
  "generatedAt": "2024-01-15T10:30:00Z",
  "notes": "optional notes about the recommendations"
}

## Rules
- videoId MUST be exactly 11 characters (standard YouTube ID format)
- confidence MUST be between 0 and 1
- Only include real music tracks, no mixes longer than 30 minutes
- If you cannot find good recommendations, return an empty recommendations array
- Do NOT include any text outside the JSON object
- Ensure all JSON is valid and parseable`;
}

// ─── Adapter Interface ───

export interface CloudAgentAdapter {
  /**
   * Get track recommendations based on existing library.
   * Returns parsed and validated recommendations.
   */
  getRecommendations(existingTracks: Track[], maxRecommendations: number): Promise<RecommendationResponse>;
}

/**
 * Configuration for the Claude Code recommendation adapter.
 */
export interface CloudAgentConfig {
  /** Whether recommendations are enabled */
  enabled: boolean;
  /** OAuth token for Claude Code authentication */
  oauthToken: string;
  /** Model to use for recommendations (e.g., 'haiku', 'sonnet', 'opus'). Default: haiku */
  model: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
}

// ─── Mock Adapter (for development/testing) ───

export class MockCloudAgentAdapter implements CloudAgentAdapter {
  async getRecommendations(existingTracks: Track[], maxRecommendations: number): Promise<RecommendationResponse> {
    // Return mock recommendations for testing
    const mockTracks: RecommendedTrack[] = [
      {
        videoId: 'mockrec001aa',
        title: 'Mock Recommendation Track 1',
        channelName: 'Mock Artist',
        confidence: 0.75,
        reason: 'Similar style to your top tracks',
      },
      {
        videoId: 'mockrec002bb',
        title: 'Mock Recommendation Track 2',
        channelName: 'Another Mock Artist',
        confidence: 0.70,
        reason: 'Matches genre preferences',
      },
    ].slice(0, maxRecommendations);

    return {
      recommendations: mockTracks,
      model: 'mock-model',
      generatedAt: new Date().toISOString(),
      notes: 'Mock adapter - for testing only',
    };
  }
}

// ─── Live Adapter (OAuth-backed) ───

export class LiveCloudAgentAdapter implements CloudAgentAdapter {
  private config: CloudAgentConfig;

  constructor(config: CloudAgentConfig) {
    this.config = config;
  }

  async getRecommendations(existingTracks: Track[], maxRecommendations: number): Promise<RecommendationResponse> {
    if (!this.config.enabled) {
      return { recommendations: [], notes: 'Recommendations disabled' };
    }

    if (!this.config.oauthToken) {
      throw new Error('Claude Code OAuth token not configured (set CLAUDE_CODE_OAUTH_TOKEN)');
    }

    // Claude Code API endpoint
    const endpoint = 'https://api.anthropic.com/v1/messages';
    const prompt = buildRecommendationPrompt(existingTracks, maxRecommendations);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.oauthToken}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Claude Code API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      // Extract content from Anthropic response format
      const rawContent = data.content?.[0]?.text
        || data.choices?.[0]?.message?.content 
        || data.content 
        || data.response 
        || JSON.stringify(data);

      // Parse and validate the response
      return parseAndValidateResponse(rawContent);
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error('Claude Code API request timed out');
      }
      throw err;
    }
  }
}

// ─── Response Parsing & Validation ───

/**
 * Parse and validate AI response with graceful failure handling.
 */
export function parseAndValidateResponse(rawContent: string): RecommendationResponse {
  try {
    // Attempt to parse JSON
    const parsed = JSON.parse(rawContent);

    // Validate against schema
    const result = RecommendationResponseSchema.safeParse(parsed);

    if (!result.success) {
      console.error('Schema validation failed:', result.error.issues);
      // Return empty response with error note rather than throwing
      return {
        recommendations: [],
        notes: `Validation failed: ${result.error.issues.map(i => i.message).join(', ')}`,
      };
    }

    return result.data;
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error('JSON parse error:', err.message);
      return {
        recommendations: [],
        notes: `Failed to parse AI response as JSON: ${err.message}`,
      };
    }
    throw err;
  }
}

// ─── Factory Function ───

/**
 * Create the appropriate adapter based on configuration.
 */
export function createCloudAgentAdapter(config: CloudAgentConfig): CloudAgentAdapter {
  if (!config.enabled || !config.oauthToken) {
    return new MockCloudAgentAdapter();
  }
  return new LiveCloudAgentAdapter(config);
}
