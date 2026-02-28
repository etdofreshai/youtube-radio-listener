/**
 * Track Metadata Enrichment Service — Two-Stage Pipeline
 *
 * Stage A (deterministic "dumb" pass):
 *   - YouTube metadata via yt-dlp --dump-json
 *   - Rule-based title/artist parsing
 *   - Always free, always available
 *
 * Stage B (AI "deep" pass):
 *   - Web research for album/year/artist disambiguation
 *   - Artwork retrieval
 *   - Alternate links discovery
 *   - Budget-limited, only when Stage A confidence is low/incomplete
 *
 * Architecture:
 *   - EnrichmentProvider interface for pluggable providers
 *   - Concurrency-limited queue with retry + exponential backoff
 *   - Budget guardrails (max AI enriches per hour/day)
 *   - Idempotent: safe to enrich same track multiple times
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as store from '../store/memory';
import type { Track, EnrichmentStatus, FieldConfidence } from '../types';

const execFileAsync = promisify(execFile);
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

// ============================================================
// Provider Interface
// ============================================================

export interface EnrichmentResult {
  // YouTube-sourced
  ytChannel?: string | null;
  ytChannelId?: string | null;
  ytUploadDate?: string | null;
  ytDescription?: string | null;
  ytThumbnailUrl?: string | null;
  ytViewCount?: number | null;
  ytLikeCount?: number | null;
  // Music metadata
  album?: string | null;
  releaseYear?: number | null;
  genre?: string | null;
  label?: string | null;
  isrc?: string | null;
  bpm?: number | null;
  // Artwork
  artworkUrl?: string | null;
  artworkSource?: string | null;
  // Alternate links
  alternateLinks?: Record<string, string> | null;
  // Duration (may update existing)
  duration?: number | null;
  // Per-field confidence annotations from this provider
  fieldAnnotations?: Array<{ field: string; confidence: 'high' | 'medium' | 'low'; }>;
}

export interface EnrichmentProvider {
  name: string;
  stage: 'A' | 'B';
  confidence: 'high' | 'medium' | 'low';
  priority: number;
  isAvailable(): boolean;
  enrich(track: Track): Promise<EnrichmentResult>;
}

// ============================================================
// Stage A Providers
// ============================================================

/**
 * YouTube Provider — uses yt-dlp --dump-json.
 * Always available. Extracts everything YouTube knows about the video.
 */
class YouTubeProvider implements EnrichmentProvider {
  name = 'youtube';
  stage: 'A' = 'A';
  confidence: 'high' = 'high';
  priority = 10;

  isAvailable(): boolean { return true; }

  async enrich(track: Track): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {};
    const annotations: EnrichmentResult['fieldAnnotations'] = [];

    try {
      const { stdout } = await execFileAsync(YT_DLP, [
        '--dump-json',
        '--no-playlist',
        '--no-download',
        '--no-warnings',
        track.youtubeUrl,
      ], { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });

      const info = JSON.parse(stdout);

      result.ytChannel = info.channel || info.uploader || null;
      result.ytChannelId = info.channel_id || info.uploader_id || null;
      result.ytDescription = info.description ? info.description.slice(0, 2000) : null;
      result.ytThumbnailUrl = info.thumbnail || null;
      result.ytViewCount = typeof info.view_count === 'number' ? info.view_count : null;
      result.ytLikeCount = typeof info.like_count === 'number' ? info.like_count : null;

      // Upload date: yt-dlp returns YYYYMMDD
      if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
        const d = info.upload_date;
        result.ytUploadDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        annotations.push({ field: 'ytUploadDate', confidence: 'high' });
      }

      if (typeof info.duration === 'number' && info.duration > 0) {
        result.duration = Math.round(info.duration);
      }

      // YouTube Music tracks sometimes carry structured metadata
      if (info.album) {
        result.album = info.album;
        annotations.push({ field: 'album', confidence: 'high' });
      }
      if (info.release_year) {
        result.releaseYear = info.release_year;
        annotations.push({ field: 'releaseYear', confidence: 'high' });
      }
      if (info.genre) {
        result.genre = info.genre;
        annotations.push({ field: 'genre', confidence: 'medium' });
      }

      // Use thumbnail as artwork if no better source
      if (info.thumbnail) {
        result.artworkUrl = info.thumbnail;
        result.artworkSource = 'youtube-thumbnail';
        annotations.push({ field: 'artworkUrl', confidence: 'medium' });
      }

    } catch (err) {
      console.error(`[enrichment:youtube] Failed for ${track.id}:`, err instanceof Error ? err.message : err);
    }

    result.fieldAnnotations = annotations;
    return result;
  }
}

/**
 * Title Parser Provider — rule-based extraction from video title/description.
 * Attempts to parse "Artist - Title (Album)" patterns, year from description, etc.
 */
class TitleParserProvider implements EnrichmentProvider {
  name = 'title-parser';
  stage: 'A' = 'A';
  confidence: 'medium' = 'medium';
  priority = 15;

  isAvailable(): boolean { return true; }

  async enrich(track: Track): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {};
    const annotations: EnrichmentResult['fieldAnnotations'] = [];

    // Try to extract year from YouTube description or title
    const desc = track.ytDescription || '';
    const title = track.title || '';

    // Year patterns: "Released: 2019", "(2019)", "℗ 2019"
    const yearPatterns = [
      /(?:released|©|℗|ⓒ)\s*(?:in\s+)?(\d{4})/i,
      /\((\d{4})\)/,
      /\b((?:19|20)\d{2})\b/,  // last resort: any 4-digit year
    ];

    if (!track.releaseYear) {
      for (const pattern of yearPatterns) {
        const m = (desc + ' ' + title).match(pattern);
        if (m) {
          const year = parseInt(m[1], 10);
          if (year >= 1900 && year <= new Date().getFullYear() + 1) {
            result.releaseYear = year;
            annotations.push({ field: 'releaseYear', confidence: pattern === yearPatterns[2] ? 'low' : 'medium' });
            break;
          }
        }
      }
    }

    // Try to extract album from description
    if (!track.album && desc) {
      const albumPatterns = [
        /(?:album|from)\s*[:\-–]\s*["""]?(.+?)["""]?\s*(?:\n|$)/i,
        /(?:provided to youtube by|auto-generated)[\s\S]*?\n\n(.+?)\n/i,
      ];
      for (const pattern of albumPatterns) {
        const m = desc.match(pattern);
        if (m && m[1].trim().length > 1 && m[1].trim().length < 100) {
          result.album = m[1].trim();
          annotations.push({ field: 'album', confidence: 'medium' });
          break;
        }
      }
    }

    // Try to extract label from description
    if (!track.label && desc) {
      const labelPatterns = [
        /(?:℗|©|ⓒ)\s*\d{4}\s+(.+?)(?:\n|$)/i,
        /(?:label|record)\s*[:\-–]\s*(.+?)(?:\n|$)/i,
      ];
      for (const pattern of labelPatterns) {
        const m = desc.match(pattern);
        if (m && m[1].trim().length > 1 && m[1].trim().length < 80) {
          result.label = m[1].trim();
          annotations.push({ field: 'label', confidence: 'low' });
          break;
        }
      }
    }

    // Genre heuristics from description or channel name
    if (!track.genre && desc) {
      const genreKeywords = [
        'hip hop', 'hip-hop', 'rap', 'r&b', 'rock', 'pop', 'jazz', 'blues',
        'electronic', 'edm', 'house', 'techno', 'classical', 'metal', 'punk',
        'folk', 'country', 'soul', 'funk', 'reggae', 'latin', 'indie',
        'ambient', 'lo-fi', 'lofi', 'synthwave', 'drum and bass', 'dnb',
      ];
      const lowerDesc = desc.toLowerCase();
      for (const g of genreKeywords) {
        if (lowerDesc.includes(g)) {
          result.genre = g.charAt(0).toUpperCase() + g.slice(1);
          annotations.push({ field: 'genre', confidence: 'low' });
          break;
        }
      }
    }

    result.fieldAnnotations = annotations;
    return result;
  }
}

// ============================================================
// Stage B Providers (AI / external)
// ============================================================

/**
 * AI Research Provider — uses web search + LLM to fill missing metadata.
 * Budget-limited. Only runs when Stage A leaves gaps.
 *
 * Currently a structured stub that documents the integration points.
 * To activate: set OPENAI_API_KEY or equivalent env var.
 */
class AIResearchProvider implements EnrichmentProvider {
  name = 'ai-research';
  stage: 'B' = 'B';
  confidence: 'medium' = 'medium';
  priority = 50;

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async enrich(track: Track): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {};
    const annotations: EnrichmentResult['fieldAnnotations'] = [];

    // Build a research prompt from what we know
    const known: string[] = [];
    known.push(`Title: ${track.title}`);
    known.push(`Artist: ${track.artist}`);
    if (track.album) known.push(`Album: ${track.album}`);
    if (track.ytChannel) known.push(`YouTube Channel: ${track.ytChannel}`);
    if (track.ytUploadDate) known.push(`Upload Date: ${track.ytUploadDate}`);

    const missing: string[] = [];
    if (!track.album) missing.push('album name');
    if (!track.releaseYear) missing.push('release year');
    if (!track.genre) missing.push('genre');
    if (!track.label) missing.push('record label');
    if (!track.isrc) missing.push('ISRC code');

    if (missing.length === 0) {
      // Nothing to research
      return result;
    }

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return result;

      const prompt = [
        `You are a music metadata researcher. Given what we know about a track, find the missing information.`,
        ``,
        `Known information:`,
        ...known.map(k => `- ${k}`),
        ``,
        `Please find: ${missing.join(', ')}`,
        ``,
        `Respond ONLY with valid JSON. Use null for any field you cannot confidently determine.`,
        `Format: { "album": string|null, "releaseYear": number|null, "genre": string|null, "label": string|null, "isrc": string|null, "alternateLinks": { "spotify"?: string, "appleMusic"?: string } | null }`,
      ].join('\n');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return result;

      const parsed = JSON.parse(content);

      if (parsed.album && typeof parsed.album === 'string' && !track.album) {
        result.album = parsed.album;
        annotations.push({ field: 'album', confidence: 'medium' });
      }
      if (parsed.releaseYear && typeof parsed.releaseYear === 'number' && !track.releaseYear) {
        result.releaseYear = parsed.releaseYear;
        annotations.push({ field: 'releaseYear', confidence: 'medium' });
      }
      if (parsed.genre && typeof parsed.genre === 'string' && !track.genre) {
        result.genre = parsed.genre;
        annotations.push({ field: 'genre', confidence: 'medium' });
      }
      if (parsed.label && typeof parsed.label === 'string' && !track.label) {
        result.label = parsed.label;
        annotations.push({ field: 'label', confidence: 'medium' });
      }
      if (parsed.isrc && typeof parsed.isrc === 'string' && !track.isrc) {
        result.isrc = parsed.isrc;
        annotations.push({ field: 'isrc', confidence: 'low' });
      }
      if (parsed.alternateLinks && typeof parsed.alternateLinks === 'object') {
        result.alternateLinks = parsed.alternateLinks;
      }

      budgetTracker.recordAIEnrich();

    } catch (err) {
      console.error(`[enrichment:ai-research] Failed for ${track.id}:`, err instanceof Error ? err.message : err);
    }

    result.fieldAnnotations = annotations;
    return result;
  }
}

/**
 * Stub: MusicBrainz Provider (future)
 */
class MusicBrainzProvider implements EnrichmentProvider {
  name = 'musicbrainz';
  stage: 'B' = 'B';
  confidence: 'high' = 'high';
  priority = 40;

  isAvailable(): boolean { return false; }

  async enrich(_track: Track): Promise<EnrichmentResult> {
    return {};
  }
}

// ============================================================
// Provider Registry
// ============================================================

const providers: EnrichmentProvider[] = [
  new YouTubeProvider(),
  new TitleParserProvider(),
  new MusicBrainzProvider(),
  new AIResearchProvider(),
];

export function registerProvider(provider: EnrichmentProvider): void {
  providers.push(provider);
  providers.sort((a, b) => a.priority - b.priority);
}

export function listProviders(): Array<{
  name: string;
  stage: string;
  available: boolean;
  priority: number;
  confidence: string;
}> {
  return providers.map(p => ({
    name: p.name,
    stage: p.stage,
    available: p.isAvailable(),
    priority: p.priority,
    confidence: p.confidence,
  }));
}

// ============================================================
// Budget Tracker
// ============================================================

class BudgetTracker {
  private hourlySlots: number[] = [];   // timestamps of AI enriches this hour
  private dailySlots: number[] = [];    // timestamps of AI enriches today
  readonly maxPerHour: number;
  readonly maxPerDay: number;

  constructor() {
    this.maxPerHour = parseInt(process.env.ENRICH_MAX_AI_PER_HOUR || '10', 10);
    this.maxPerDay = parseInt(process.env.ENRICH_MAX_AI_PER_DAY || '50', 10);
  }

  private pruneSlots(): void {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    this.hourlySlots = this.hourlySlots.filter(t => t > hourAgo);
    this.dailySlots = this.dailySlots.filter(t => t > dayAgo);
  }

  canDoAIEnrich(): boolean {
    this.pruneSlots();
    return this.hourlySlots.length < this.maxPerHour &&
           this.dailySlots.length < this.maxPerDay;
  }

  recordAIEnrich(): void {
    const now = Date.now();
    this.hourlySlots.push(now);
    this.dailySlots.push(now);
  }

  getStatus() {
    this.pruneSlots();
    return {
      aiEnrichesThisHour: this.hourlySlots.length,
      aiEnrichesToday: this.dailySlots.length,
      maxAiPerHour: this.maxPerHour,
      maxAiPerDay: this.maxPerDay,
    };
  }
}

export const budgetTracker = new BudgetTracker();

// ============================================================
// Concurrency-Limited Queue
// ============================================================

interface QueueItem {
  trackId: string;
  stage: 'A' | 'B';
  addedAt: number;
}

class EnrichmentQueue {
  private queue: QueueItem[] = [];
  private active = new Map<string, Promise<void>>();  // trackId -> running promise
  readonly maxConcurrency: number;

  constructor() {
    this.maxConcurrency = parseInt(process.env.ENRICH_MAX_CONCURRENCY || '2', 10);
  }

  get length(): number { return this.queue.length; }
  get activeCount(): number { return this.active.size; }

  /** Add a track to the queue if not already queued or active */
  enqueue(trackId: string, stage: 'A' | 'B'): boolean {
    if (this.active.has(trackId)) return false;
    if (this.queue.some(q => q.trackId === trackId)) return false;
    this.queue.push({ trackId, stage, addedAt: Date.now() });

    // Mark as queued in store
    store.updateTrackMetadata(trackId, { enrichmentStatus: 'queued' });

    this.drain();
    return true;
  }

  /** Force-enqueue for manual "Enrich now" — bypasses dedup */
  forceEnqueue(trackId: string): boolean {
    // Remove from queue if already there
    this.queue = this.queue.filter(q => q.trackId !== trackId);
    // Can't cancel active, but can re-queue for after
    if (this.active.has(trackId)) return false;

    // Determine stage
    const track = store.getTrack(trackId);
    const stage = track?.stageACompletedAt ? 'B' : 'A';
    this.queue.unshift({ trackId, stage, addedAt: Date.now() });
    store.updateTrackMetadata(trackId, { enrichmentStatus: 'queued' });
    this.drain();
    return true;
  }

  /** Process items from queue up to concurrency limit */
  private drain(): void {
    while (this.queue.length > 0 && this.active.size < this.maxConcurrency) {
      const item = this.queue.shift()!;

      // For Stage B, check budget
      if (item.stage === 'B' && !budgetTracker.canDoAIEnrich()) {
        console.log(`[queue] Budget exhausted, deferring Stage B for ${item.trackId}`);
        // Schedule retry — put back at end with backoff
        const backoffMs = 15 * 60 * 1000; // 15 min
        store.updateTrackMetadata(item.trackId, {
          nextEnrichAt: new Date(Date.now() + backoffMs).toISOString(),
          enrichmentStatus: 'stage_a_done',
        });
        continue;
      }

      const promise = this.processItem(item).finally(() => {
        this.active.delete(item.trackId);
        this.drain(); // try to pick up next
      });
      this.active.set(item.trackId, promise);
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    if (item.stage === 'A') {
      await runStageA(item.trackId);
    } else {
      await runStageB(item.trackId);
    }
  }
}

export const enrichmentQueue = new EnrichmentQueue();

// ============================================================
// Backoff Calculator
// ============================================================

function calculateBackoff(attempts: number): number {
  // Exponential backoff: 5min, 15min, 45min, 2h, 6h, 24h
  const base = 5 * 60 * 1000; // 5 minutes
  const maxBackoff = 24 * 60 * 60 * 1000; // 24 hours
  const backoff = Math.min(base * Math.pow(3, attempts), maxBackoff);
  // Add jitter: ±20%
  const jitter = backoff * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

// ============================================================
// Stage A: Deterministic Pass
// ============================================================

async function runStageA(trackId: string): Promise<void> {
  const track = store.getTrack(trackId);
  if (!track) return;

  console.log(`[enrichment] Stage A starting for ${trackId} ("${track.title}" by ${track.artist})`);

  store.updateTrackMetadata(trackId, { enrichmentStatus: 'stage_a' });

  try {
    const stageAProviders = providers
      .filter(p => p.stage === 'A' && p.isAvailable())
      .sort((a, b) => a.priority - b.priority);

    const merged: EnrichmentResult = {};
    const allAnnotations: Array<{ field: string; confidence: 'high' | 'medium' | 'low' }> = [];
    let usedProviders = '';

    for (const provider of stageAProviders) {
      try {
        console.log(`[enrichment]   Running ${provider.name}`);
        const result = await provider.enrich(store.getTrack(trackId)!); // re-read for latest

        // Merge: only fill null fields
        for (const [key, value] of Object.entries(result)) {
          if (key === 'fieldAnnotations') continue;
          if (value != null && (merged as any)[key] == null) {
            (merged as any)[key] = value;
          }
        }

        if (result.fieldAnnotations) {
          allAnnotations.push(...result.fieldAnnotations);
        }

        usedProviders += (usedProviders ? '+' : '') + provider.name;
      } catch (err) {
        console.error(`[enrichment]   ${provider.name} error:`, err);
      }
    }

    // Build field confidences
    const now = new Date().toISOString();
    const fieldConfidences: FieldConfidence[] = allAnnotations.map(a => ({
      field: a.field,
      confidence: a.confidence,
      source: usedProviders,
      updatedAt: now,
    }));

    // Calculate overall confidence
    const filledFields = Object.entries(merged)
      .filter(([k, v]) => v != null && k !== 'fieldAnnotations' && k !== 'duration')
      .length;

    let overallConfidence: 'high' | 'medium' | 'low' = 'low';
    if (filledFields >= 8) overallConfidence = 'high';
    else if (filledFields >= 4) overallConfidence = 'medium';

    // Merge existing field confidences with new ones
    const existing = store.getTrack(trackId);
    const existingConfidences = existing?.fieldConfidences ?? [];
    const mergedConfidences = [...existingConfidences];
    for (const fc of fieldConfidences) {
      const idx = mergedConfidences.findIndex(e => e.field === fc.field);
      if (idx >= 0) mergedConfidences[idx] = fc;
      else mergedConfidences.push(fc);
    }

    // Remove fieldAnnotations before spreading into store
    delete (merged as any).fieldAnnotations;

    store.updateTrackMetadata(trackId, {
      ...merged,
      metadataSource: usedProviders || null,
      metadataConfidence: overallConfidence,
      fieldConfidences: mergedConfidences,
      lastEnrichedAt: now,
      enrichmentStatus: 'stage_a_done',
      enrichmentAttempts: (existing?.enrichmentAttempts ?? 0) + 1,
      enrichmentError: null,
      stageACompletedAt: now,
    });

    console.log(`[enrichment] ✅ Stage A complete for ${trackId}: ${filledFields} fields, confidence=${overallConfidence}`);

    // Auto-promote to Stage B if confidence is low and AI is available
    if (overallConfidence !== 'high' && hasAvailableStageBProviders() && budgetTracker.canDoAIEnrich()) {
      console.log(`[enrichment]   → Auto-promoting to Stage B (confidence=${overallConfidence})`);
      enrichmentQueue.enqueue(trackId, 'B');
    }

    enrichmentStats.stageACompleted++;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[enrichment] ❌ Stage A failed for ${trackId}:`, msg);

    const existing = store.getTrack(trackId);
    const attempts = (existing?.enrichmentAttempts ?? 0) + 1;
    const backoffMs = calculateBackoff(attempts);

    store.updateTrackMetadata(trackId, {
      enrichmentStatus: 'error',
      enrichmentError: msg.slice(0, 500),
      enrichmentAttempts: attempts,
      nextEnrichAt: new Date(Date.now() + backoffMs).toISOString(),
    });

    enrichmentStats.errors++;
  }
}

// ============================================================
// Stage B: AI Deep Pass
// ============================================================

async function runStageB(trackId: string): Promise<void> {
  const track = store.getTrack(trackId);
  if (!track) return;

  console.log(`[enrichment] Stage B starting for ${trackId} ("${track.title}" by ${track.artist})`);

  store.updateTrackMetadata(trackId, { enrichmentStatus: 'stage_b' });

  try {
    const stageBProviders = providers
      .filter(p => p.stage === 'B' && p.isAvailable())
      .sort((a, b) => a.priority - b.priority);

    if (stageBProviders.length === 0) {
      console.log(`[enrichment]   No Stage B providers available, marking complete`);
      store.updateTrackMetadata(trackId, { enrichmentStatus: 'complete' });
      return;
    }

    const merged: EnrichmentResult = {};
    const allAnnotations: Array<{ field: string; confidence: 'high' | 'medium' | 'low' }> = [];
    let usedProviders = track.metadataSource || '';

    for (const provider of stageBProviders) {
      try {
        console.log(`[enrichment]   Running ${provider.name}`);
        const result = await provider.enrich(store.getTrack(trackId)!);

        for (const [key, value] of Object.entries(result)) {
          if (key === 'fieldAnnotations') continue;
          if (value != null && (merged as any)[key] == null) {
            (merged as any)[key] = value;
          }
        }

        if (result.fieldAnnotations) {
          allAnnotations.push(...result.fieldAnnotations);
        }

        usedProviders += (usedProviders ? '+' : '') + provider.name;
      } catch (err) {
        console.error(`[enrichment]   ${provider.name} error:`, err);
      }
    }

    const now = new Date().toISOString();
    const existing = store.getTrack(trackId);

    // Build field confidences
    const newFieldConfidences: FieldConfidence[] = allAnnotations.map(a => ({
      field: a.field,
      confidence: a.confidence,
      source: 'ai-research',
      updatedAt: now,
    }));

    const mergedConfidences = [...(existing?.fieldConfidences ?? [])];
    for (const fc of newFieldConfidences) {
      const idx = mergedConfidences.findIndex(e => e.field === fc.field);
      if (idx >= 0) mergedConfidences[idx] = fc;
      else mergedConfidences.push(fc);
    }

    // Recalculate overall confidence including Stage A data
    const updatedTrack = { ...existing!, ...merged };
    const metaFields = ['ytChannel', 'ytUploadDate', 'album', 'releaseYear', 'genre', 'label', 'isrc', 'artworkUrl', 'alternateLinks'] as const;
    const filledCount = metaFields.filter(f => (updatedTrack as any)[f] != null).length;

    let overallConfidence: 'high' | 'medium' | 'low' = 'low';
    if (filledCount >= 6) overallConfidence = 'high';
    else if (filledCount >= 3) overallConfidence = 'medium';

    delete (merged as any).fieldAnnotations;

    store.updateTrackMetadata(trackId, {
      ...merged,
      metadataSource: usedProviders,
      metadataConfidence: overallConfidence,
      fieldConfidences: mergedConfidences,
      lastEnrichedAt: now,
      enrichmentStatus: 'complete',
      enrichmentAttempts: (existing?.enrichmentAttempts ?? 0) + 1,
      enrichmentError: null,
      stageBCompletedAt: now,
    });

    console.log(`[enrichment] ✅ Stage B complete for ${trackId}: confidence=${overallConfidence}`);
    enrichmentStats.stageBCompleted++;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[enrichment] ❌ Stage B failed for ${trackId}:`, msg);

    const existing = store.getTrack(trackId);
    const attempts = (existing?.enrichmentAttempts ?? 0) + 1;
    const backoffMs = calculateBackoff(attempts);

    store.updateTrackMetadata(trackId, {
      enrichmentStatus: 'error',
      enrichmentError: msg.slice(0, 500),
      enrichmentAttempts: attempts,
      nextEnrichAt: new Date(Date.now() + backoffMs).toISOString(),
    });

    enrichmentStats.errors++;
  }
}

function hasAvailableStageBProviders(): boolean {
  return providers.some(p => p.stage === 'B' && p.isAvailable());
}

// ============================================================
// Public API
// ============================================================

/** Stats for scheduler status endpoint */
export const enrichmentStats = {
  stageACompleted: 0,
  stageBCompleted: 0,
  errors: 0,
};

/**
 * Enrich a single track (manual trigger).
 * Queues Stage A if never enriched, or Stage B if Stage A is done.
 * Returns the track immediately (enrichment runs async).
 */
export function enrichTrack(trackId: string): Track | null {
  const track = store.getTrack(trackId);
  if (!track) return null;

  enrichmentQueue.forceEnqueue(trackId);
  return store.getTrack(trackId) ?? null;
}

/**
 * Synchronous enrichment — waits for completion.
 * Used by the POST /tracks/:id/enrich endpoint.
 */
export async function enrichTrackSync(trackId: string): Promise<Track | null> {
  const track = store.getTrack(trackId);
  if (!track) return null;

  if (!track.stageACompletedAt) {
    await runStageA(trackId);
  }

  // Check if Stage B should run
  const updated = store.getTrack(trackId);
  if (updated && updated.metadataConfidence !== 'high' && hasAvailableStageBProviders() && budgetTracker.canDoAIEnrich()) {
    await runStageB(trackId);
  }

  return store.getTrack(trackId) ?? null;
}

/**
 * Batch enrich all tracks (manual trigger).
 */
export async function enrichAllTracks(options?: { force?: boolean }): Promise<number> {
  const allTracks = store.getAllTracks();
  let queued = 0;

  for (const track of allTracks) {
    const needsWork = options?.force ||
      track.enrichmentStatus === 'none' ||
      (track.enrichmentStatus === 'stage_a_done' && track.metadataConfidence !== 'high');

    if (needsWork) {
      const stage = track.stageACompletedAt && !options?.force ? 'B' : 'A';
      if (enrichmentQueue.enqueue(track.id, stage)) {
        queued++;
      }
    }
  }

  return queued;
}
