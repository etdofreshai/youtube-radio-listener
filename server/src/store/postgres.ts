/**
 * PostgreSQL-backed store — drop-in replacement for memory.ts.
 * All functions match the same signatures as the memory store.
 */

import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/pool';
import type {
  Track, Playlist, Favorite,
  Artist, Album,
  PlaySession, SessionMember, SessionState, SessionEvent,
  CreateTrackInput, UpdateTrackInput,
  CreatePlaylistInput, UpdatePlaylistInput,
  AudioStatus, EnrichmentStatus, FieldConfidence,
  PaginationParams, PaginatedResponse,
  SortableTrackField, SortDirection,
} from '../types';
import { trackSlug, artistSlug, albumSlug, slugify } from '../utils/slug';

// ============================================================
// Row ↔ Object Mapping
// ============================================================

function rowToTrack(row: any): Track {
  return {
    id: row.id,
    slug: row.slug || null,
    youtubeUrl: row.youtube_url,
    title: row.title,
    artist: row.artist,
    artistId: row.artist_id || null,
    albumId: row.album_id || null,
    startTimeSec: row.start_time_sec,
    endTimeSec: row.end_time_sec,
    volume: row.volume,
    notes: row.notes || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    // Audio
    audioStatus: (row.audio_status || 'pending') as AudioStatus,
    audioError: row.audio_error || null,
    audioFilename: row.audio_filename || null,
    duration: row.duration || null,
    lastDownloadAt: row.last_download_at ? (row.last_download_at instanceof Date ? row.last_download_at.toISOString() : row.last_download_at) : null,
    // Verification
    verified: row.verified ?? false,
    verifiedBy: row.verified_by || null,
    verifiedAt: row.verified_at ? (row.verified_at instanceof Date ? row.verified_at.toISOString() : row.verified_at) : null,
    // YouTube metadata
    ytChannel: row.yt_channel || null,
    ytChannelId: row.yt_channel_id || null,
    ytUploadDate: row.yt_upload_date ? (row.yt_upload_date instanceof Date ? row.yt_upload_date.toISOString().slice(0, 10) : String(row.yt_upload_date)) : null,
    ytDescription: row.yt_description || null,
    ytThumbnailUrl: row.yt_thumbnail_url || null,
    ytViewCount: row.yt_view_count != null ? Number(row.yt_view_count) : null,
    ytLikeCount: row.yt_like_count != null ? Number(row.yt_like_count) : null,
    // Music metadata
    album: row.album || null,
    releaseYear: row.release_year || null,
    genre: row.genre || null,
    label: row.label || null,
    isrc: row.isrc || null,
    bpm: row.bpm || null,
    // Artwork
    artworkUrl: row.artwork_url || null,
    artworkSource: row.artwork_source || null,
    // Alternate links
    alternateLinks: row.alternate_links || null,
    // Provenance
    metadataSource: row.metadata_source || null,
    metadataConfidence: row.metadata_confidence || null,
    fieldConfidences: Array.isArray(row.field_confidences) ? row.field_confidences : (row.field_confidences ? JSON.parse(row.field_confidences) : []),
    lastEnrichedAt: row.last_enriched_at ? (row.last_enriched_at instanceof Date ? row.last_enriched_at.toISOString() : row.last_enriched_at) : null,
    // Enrichment pipeline
    enrichmentStatus: (row.enrichment_status || 'none') as EnrichmentStatus,
    enrichmentAttempts: row.enrichment_attempts ?? 0,
    enrichmentError: row.enrichment_error || null,
    nextEnrichAt: row.next_enrich_at ? (row.next_enrich_at instanceof Date ? row.next_enrich_at.toISOString() : row.next_enrich_at) : null,
    stageACompletedAt: row.stage_a_completed_at ? (row.stage_a_completed_at instanceof Date ? row.stage_a_completed_at.toISOString() : row.stage_a_completed_at) : null,
    stageBCompletedAt: row.stage_b_completed_at ? (row.stage_b_completed_at instanceof Date ? row.stage_b_completed_at.toISOString() : row.stage_b_completed_at) : null,
  };
}

function rowToPlaylist(row: any, trackIds: string[]): Playlist {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug || null,
    description: row.description || '',
    trackIds,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function rowToFavorite(row: any): Favorite {
  return {
    id: row.id,
    trackId: row.track_id,
    likedAt: row.liked_at instanceof Date ? row.liked_at.toISOString() : row.liked_at,
  };
}

// Map camelCase sort fields to SQL columns
const SORT_FIELD_MAP: Record<SortableTrackField, string> = {
  artist: 'artist',
  title: 'title',
  youtubeUrl: 'youtube_url',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  duration: 'duration',
  verified: 'verified',
  album: 'album',
  genre: 'genre',
  releaseYear: 'release_year',
};

// ============================================================
// Tracks
// ============================================================

export async function getAllTracks(): Promise<Track[]> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM tracks ORDER BY created_at DESC');
  return rows.map(rowToTrack);
}

export async function getTracksPaginated(params: PaginationParams): Promise<PaginatedResponse<Track>> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  if (params.search) {
    conditions.push(`(title ILIKE $${paramIdx} OR artist ILIKE $${paramIdx} OR album ILIKE $${paramIdx} OR genre ILIKE $${paramIdx})`);
    values.push(`%${params.search}%`);
    paramIdx++;
  }

  if (params.verified !== undefined) {
    conditions.push(`verified = $${paramIdx}`);
    values.push(params.verified);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = SORT_FIELD_MAP[params.sortBy] || 'created_at';
  const sortDir = params.sortDir === 'asc' ? 'ASC' : 'DESC';

  // Count total
  const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM tracks ${whereClause}`, values);
  const total = parseInt(countResult.rows[0].cnt, 10);
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const page = Math.min(params.page, totalPages);
  const offset = (page - 1) * params.pageSize;

  // Fetch page
  const dataResult = await pool.query(
    `SELECT * FROM tracks ${whereClause} ORDER BY ${sortCol} ${sortDir} NULLS LAST LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...values, params.pageSize, offset]
  );

  return {
    data: dataResult.rows.map(rowToTrack),
    total,
    page,
    pageSize: params.pageSize,
    totalPages,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
  };
}

export async function getTracksNeedingEnrichment(limit: number, now: number): Promise<Track[]> {
  const pool = getPool();
  const nowISO = new Date(now).toISOString();

  // Find tracks that need enrichment, ordered by priority
  const { rows } = await pool.query(`
    SELECT * FROM tracks
    WHERE enrichment_status NOT IN ('stage_a', 'stage_b', 'queued')
      AND (next_enrich_at IS NULL OR next_enrich_at <= $1)
      AND (
        enrichment_status = 'none'
        OR (enrichment_status = 'stage_a_done' AND metadata_confidence != 'high')
        OR enrichment_status = 'error'
        OR (enrichment_status = 'complete' AND metadata_confidence != 'high')
      )
    ORDER BY
      CASE
        WHEN enrichment_status = 'none' THEN 0
        WHEN enrichment_status = 'stage_a_done' AND metadata_confidence = 'low' THEN 100
        WHEN enrichment_status = 'stage_a_done' THEN 200
        WHEN enrichment_status = 'error' THEN 300 + enrichment_attempts * 50
        ELSE 500
      END ASC,
      created_at ASC
    LIMIT $2
  `, [nowISO, limit]);

  return rows.map(rowToTrack);
}

/** Lookup by UUID or slug */
export async function getTrack(idOrSlug: string): Promise<Track | undefined> {
  const pool = getPool();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const { rows } = isUuid
    ? await pool.query('SELECT * FROM tracks WHERE id = $1', [idOrSlug])
    : await pool.query('SELECT * FROM tracks WHERE slug = $1', [idOrSlug]);
  return rows.length > 0 ? rowToTrack(rows[0]) : undefined;
}

export async function createTrack(input: CreateTrackInput): Promise<Track> {
  const pool = getPool();
  const id = uuidv4();
  const now = new Date().toISOString();
  const slug = await generateUniqueSlug(pool, 'tracks', trackSlug(input.artist, input.title));

  const { rows } = await pool.query(`
    INSERT INTO tracks (id, slug, youtube_url, title, artist, start_time_sec, end_time_sec, volume, notes, created_at, updated_at, audio_status, enrichment_status, enrichment_attempts, field_confidences)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 'pending', 'none', 0, '[]'::jsonb)
    RETURNING *
  `, [
    id,
    slug,
    input.youtubeUrl,
    input.title,
    input.artist,
    input.startTimeSec ?? null,
    input.endTimeSec ?? null,
    input.volume ?? 100,
    input.notes ?? '',
    now,
  ]);

  return rowToTrack(rows[0]);
}

export async function updateTrack(id: string, input: UpdateTrackInput): Promise<Track | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  const fields: Array<[keyof UpdateTrackInput, string]> = [
    ['youtubeUrl', 'youtube_url'],
    ['title', 'title'],
    ['artist', 'artist'],
    ['startTimeSec', 'start_time_sec'],
    ['endTimeSec', 'end_time_sec'],
    ['volume', 'volume'],
    ['notes', 'notes'],
    ['album', 'album'],
    ['releaseYear', 'release_year'],
    ['genre', 'genre'],
    ['label', 'label'],
  ];

  for (const [jsKey, dbCol] of fields) {
    if ((input as any)[jsKey] !== undefined) {
      sets.push(`${dbCol} = $${paramIdx}`);
      values.push((input as any)[jsKey]);
      paramIdx++;
    }
  }

  if (sets.length === 0) {
    const t = await getTrack(id);
    return t || null;
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE tracks SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );

  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

export async function updateTrackAudio(
  id: string,
  fields: {
    audioStatus: AudioStatus;
    audioError?: string | null;
    audioFilename?: string | null;
    duration?: number | null;
    lastDownloadAt?: string | null;
  }
): Promise<Track | null> {
  const pool = getPool();

  const { rows } = await pool.query(`
    UPDATE tracks
    SET audio_status = $2,
        audio_error = COALESCE($3, audio_error),
        audio_filename = COALESCE($4, audio_filename),
        duration = COALESCE($5, duration),
        last_download_at = COALESCE($6::timestamptz, last_download_at)
    WHERE id = $1
    RETURNING *
  `, [
    id,
    fields.audioStatus,
    fields.audioError !== undefined ? fields.audioError : null,
    fields.audioFilename !== undefined ? fields.audioFilename : null,
    fields.duration !== undefined ? fields.duration : null,
    fields.lastDownloadAt !== undefined ? fields.lastDownloadAt : null,
  ]);

  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

export async function updateTrackMetadata(
  id: string,
  fields: Partial<Pick<Track,
    'ytChannel' | 'ytChannelId' | 'ytUploadDate' | 'ytDescription' |
    'ytThumbnailUrl' | 'ytViewCount' | 'ytLikeCount' |
    'album' | 'releaseYear' | 'genre' | 'label' | 'isrc' | 'bpm' |
    'artworkUrl' | 'artworkSource' | 'alternateLinks' |
    'metadataSource' | 'metadataConfidence' | 'fieldConfidences' | 'lastEnrichedAt' |
    'enrichmentStatus' | 'enrichmentAttempts' | 'enrichmentError' |
    'nextEnrichAt' | 'stageACompletedAt' | 'stageBCompletedAt'
  >>
): Promise<Track | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  const mapping: Array<[string, string, (v: any) => any]> = [
    ['ytChannel', 'yt_channel', v => v],
    ['ytChannelId', 'yt_channel_id', v => v],
    ['ytUploadDate', 'yt_upload_date', v => v],
    ['ytDescription', 'yt_description', v => v],
    ['ytThumbnailUrl', 'yt_thumbnail_url', v => v],
    ['ytViewCount', 'yt_view_count', v => v],
    ['ytLikeCount', 'yt_like_count', v => v],
    ['album', 'album', v => v],
    ['releaseYear', 'release_year', v => v],
    ['genre', 'genre', v => v],
    ['label', 'label', v => v],
    ['isrc', 'isrc', v => v],
    ['bpm', 'bpm', v => v],
    ['artworkUrl', 'artwork_url', v => v],
    ['artworkSource', 'artwork_source', v => v],
    ['alternateLinks', 'alternate_links', v => v ? JSON.stringify(v) : null],
    ['metadataSource', 'metadata_source', v => v],
    ['metadataConfidence', 'metadata_confidence', v => v],
    ['fieldConfidences', 'field_confidences', v => JSON.stringify(v ?? [])],
    ['lastEnrichedAt', 'last_enriched_at', v => v],
    ['enrichmentStatus', 'enrichment_status', v => v],
    ['enrichmentAttempts', 'enrichment_attempts', v => v],
    ['enrichmentError', 'enrichment_error', v => v],
    ['nextEnrichAt', 'next_enrich_at', v => v],
    ['stageACompletedAt', 'stage_a_completed_at', v => v],
    ['stageBCompletedAt', 'stage_b_completed_at', v => v],
  ];

  for (const [jsKey, dbCol, transform] of mapping) {
    if ((fields as any)[jsKey] !== undefined) {
      sets.push(`${dbCol} = $${paramIdx}`);
      values.push(transform((fields as any)[jsKey]));
      paramIdx++;
    }
  }

  if (sets.length === 0) {
    const t = await getTrack(id);
    return t || null;
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE tracks SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );

  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

export async function verifyTrack(
  id: string,
  verified: boolean,
  verifiedBy?: string | null
): Promise<Track | null> {
  const pool = getPool();
  const now = verified ? new Date().toISOString() : null;

  const { rows } = await pool.query(`
    UPDATE tracks
    SET verified = $2, verified_by = $3, verified_at = $4
    WHERE id = $1
    RETURNING *
  `, [id, verified, verified ? (verifiedBy ?? null) : null, now]);

  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

export async function deleteTrack(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query('DELETE FROM tracks WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

// ============================================================
// Playlists
// ============================================================

async function getPlaylistTrackIds(playlistId: string): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC',
    [playlistId]
  );
  return rows.map((r: any) => r.track_id);
}

export async function getAllPlaylists(): Promise<Playlist[]> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM playlists ORDER BY created_at DESC');
  const playlists: Playlist[] = [];
  for (const row of rows) {
    const trackIds = await getPlaylistTrackIds(row.id);
    playlists.push(rowToPlaylist(row, trackIds));
  }
  return playlists;
}

/** Lookup by UUID or slug */
export async function getPlaylist(idOrSlug: string): Promise<Playlist | undefined> {
  const pool = getPool();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const { rows } = isUuid
    ? await pool.query('SELECT * FROM playlists WHERE id = $1', [idOrSlug])
    : await pool.query('SELECT * FROM playlists WHERE slug = $1', [idOrSlug]);
  if (rows.length === 0) return undefined;
  const trackIds = await getPlaylistTrackIds(rows[0].id);
  return rowToPlaylist(rows[0], trackIds);
}

export async function createPlaylist(input: CreatePlaylistInput): Promise<Playlist> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const id = uuidv4();
    const now = new Date().toISOString();
    const slug = await generateUniqueSlug(pool, 'playlists', slugify(input.name));

    const { rows } = await client.query(`
      INSERT INTO playlists (id, slug, name, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      RETURNING *
    `, [id, slug, input.name, input.description ?? '', now]);

    // Insert track associations
    const trackIds = input.trackIds ?? [];
    for (let i = 0; i < trackIds.length; i++) {
      await client.query(`
        INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3)
      `, [id, trackIds[i], i]);
    }

    await client.query('COMMIT');
    return rowToPlaylist(rows[0], trackIds);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updatePlaylist(id: string, input: UpdatePlaylistInput): Promise<Playlist | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update playlist fields
    const sets: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${paramIdx}`);
      values.push(input.name);
      paramIdx++;
    }
    if (input.description !== undefined) {
      sets.push(`description = $${paramIdx}`);
      values.push(input.description);
      paramIdx++;
    }

    let playlistRow: any;
    if (sets.length > 0) {
      values.push(id);
      const { rows } = await client.query(
        `UPDATE playlists SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
        values
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      playlistRow = rows[0];
    } else {
      const { rows } = await client.query('SELECT * FROM playlists WHERE id = $1', [id]);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      playlistRow = rows[0];
    }

    // Update track order if provided
    if (input.trackIds !== undefined) {
      // Delete existing associations and re-insert
      await client.query('DELETE FROM playlist_tracks WHERE playlist_id = $1', [id]);
      for (let i = 0; i < input.trackIds.length; i++) {
        await client.query(`
          INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3)
        `, [id, input.trackIds[i], i]);
      }
    }

    await client.query('COMMIT');

    const trackIds = input.trackIds ?? await getPlaylistTrackIds(id);
    return rowToPlaylist(playlistRow, trackIds);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePlaylist(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query('DELETE FROM playlists WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

// ============================================================
// Favorites
// ============================================================

export async function getAllFavorites(): Promise<Favorite[]> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM favorites ORDER BY liked_at DESC');
  return rows.map(rowToFavorite);
}

export async function addFavorite(trackId: string): Promise<Favorite | null> {
  const pool = getPool();

  // Check track exists
  const trackCheck = await pool.query('SELECT id FROM tracks WHERE id = $1', [trackId]);
  if (trackCheck.rows.length === 0) return null;

  // Check if already favorited
  const existing = await pool.query('SELECT * FROM favorites WHERE track_id = $1', [trackId]);
  if (existing.rows.length > 0) return rowToFavorite(existing.rows[0]);

  const id = uuidv4();
  const { rows } = await pool.query(`
    INSERT INTO favorites (id, track_id, liked_at) VALUES ($1, $2, now())
    RETURNING *
  `, [id, trackId]);

  return rowToFavorite(rows[0]);
}

export async function removeFavorite(trackId: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query('DELETE FROM favorites WHERE track_id = $1', [trackId]);
  return (rowCount ?? 0) > 0;
}

export async function isFavorite(trackId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT 1 FROM favorites WHERE track_id = $1', [trackId]);
  return rows.length > 0;
}

// ============================================================
// Events (audit log)
// ============================================================

export interface AppEvent {
  id: string;
  userId: string | null;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
}

function rowToEvent(row: any): AppEvent {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    metadata: row.metadata || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function recordEvent(
  eventType: string,
  opts?: {
    userId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, any>;
  }
): Promise<AppEvent> {
  const pool = getPool();
  const { rows } = await pool.query(`
    INSERT INTO events (user_id, event_type, entity_type, entity_id, metadata)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [
    opts?.userId ?? null,
    eventType,
    opts?.entityType ?? null,
    opts?.entityId ?? null,
    JSON.stringify(opts?.metadata ?? {}),
  ]);
  return rowToEvent(rows[0]);
}

export async function getEvents(opts?: {
  userId?: string;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: AppEvent[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  if (opts?.userId) {
    conditions.push(`user_id = $${paramIdx}`);
    values.push(opts.userId);
    paramIdx++;
  }
  if (opts?.eventType) {
    conditions.push(`event_type = $${paramIdx}`);
    values.push(opts.eventType);
    paramIdx++;
  }
  if (opts?.entityType) {
    conditions.push(`entity_type = $${paramIdx}`);
    values.push(opts.entityType);
    paramIdx++;
  }
  if (opts?.entityId) {
    conditions.push(`entity_id = $${paramIdx}`);
    values.push(opts.entityId);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;

  const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM events ${whereClause}`, values);
  const total = parseInt(countResult.rows[0].cnt, 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (Math.min(page, totalPages) - 1) * pageSize;

  const dataResult = await pool.query(
    `SELECT * FROM events ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...values, pageSize, offset]
  );

  return {
    data: dataResult.rows.map(rowToEvent),
    total,
    page: Math.min(page, totalPages),
    pageSize,
    totalPages,
  };
}

// ============================================================
// Slug Helpers
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean { return UUID_RE.test(s); }

/** Generate a unique slug by appending -2, -3, etc. on collision */
async function generateUniqueSlug(pool: any, table: string, baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let attempt = 0;
  while (true) {
    const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug]);
    if (rows.length === 0) return slug;
    attempt++;
    slug = `${baseSlug}-${attempt + 1}`;
    if (attempt > 100) return `${baseSlug}-${uuidv4().slice(0, 8)}`;
  }
}

// ============================================================
// Artists
// ============================================================

function rowToArtist(row: any): Artist {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url || null,
    bio: row.bio || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function getArtist(idOrSlug: string): Promise<Artist | undefined> {
  const pool = getPool();
  const { rows } = isUuid(idOrSlug)
    ? await pool.query('SELECT * FROM artists WHERE id = $1', [idOrSlug])
    : await pool.query('SELECT * FROM artists WHERE slug = $1', [idOrSlug]);
  return rows.length > 0 ? rowToArtist(rows[0]) : undefined;
}

export async function getAllArtists(): Promise<Artist[]> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM artists ORDER BY name ASC');
  return rows.map(rowToArtist);
}

export async function createArtist(input: { name: string; imageUrl?: string; bio?: string }): Promise<Artist> {
  const pool = getPool();
  const id = uuidv4();
  const slug = await generateUniqueSlug(pool, 'artists', artistSlug(input.name));
  const { rows } = await pool.query(`
    INSERT INTO artists (id, name, slug, image_url, bio)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [id, input.name, slug, input.imageUrl ?? null, input.bio ?? null]);
  return rowToArtist(rows[0]);
}

export async function updateArtist(id: string, input: { name?: string; imageUrl?: string | null; bio?: string | null }): Promise<Artist | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (input.name !== undefined) { sets.push(`name = $${idx}`); values.push(input.name); idx++; }
  if (input.imageUrl !== undefined) { sets.push(`image_url = $${idx}`); values.push(input.imageUrl); idx++; }
  if (input.bio !== undefined) { sets.push(`bio = $${idx}`); values.push(input.bio); idx++; }
  if (sets.length === 0) { const a = await getArtist(id); return a || null; }
  values.push(id);
  const { rows } = await pool.query(`UPDATE artists SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
  return rows.length > 0 ? rowToArtist(rows[0]) : null;
}

/** Find or create artist by name (for auto-linking) */
export async function findOrCreateArtist(name: string): Promise<Artist> {
  const pool = getPool();
  const slug = artistSlug(name);
  const { rows } = await pool.query('SELECT * FROM artists WHERE slug = $1', [slug]);
  if (rows.length > 0) return rowToArtist(rows[0]);
  return createArtist({ name });
}

// ============================================================
// Albums
// ============================================================

function rowToAlbum(row: any): Album {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    artistId: row.artist_id || null,
    artistName: row.artist_name || null,
    releaseYear: row.release_year || null,
    artworkUrl: row.artwork_url || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function getAlbum(idOrSlug: string): Promise<Album | undefined> {
  const pool = getPool();
  const q = `SELECT al.*, ar.name as artist_name FROM albums al LEFT JOIN artists ar ON al.artist_id = ar.id`;
  const { rows } = isUuid(idOrSlug)
    ? await pool.query(`${q} WHERE al.id = $1`, [idOrSlug])
    : await pool.query(`${q} WHERE al.slug = $1`, [idOrSlug]);
  return rows.length > 0 ? rowToAlbum(rows[0]) : undefined;
}

export async function getAllAlbums(): Promise<Album[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT al.*, ar.name as artist_name FROM albums al LEFT JOIN artists ar ON al.artist_id = ar.id ORDER BY al.title ASC`
  );
  return rows.map(rowToAlbum);
}

export async function createAlbum(input: { title: string; artistId?: string; releaseYear?: number; artworkUrl?: string }): Promise<Album> {
  const pool = getPool();
  const id = uuidv4();
  // Determine artist name for slug
  let artName = '';
  if (input.artistId) {
    const ar = await getArtist(input.artistId);
    artName = ar?.name ?? '';
  }
  const slug = await generateUniqueSlug(pool, 'albums', albumSlug(artName, input.title));
  const { rows } = await pool.query(`
    INSERT INTO albums (id, title, slug, artist_id, release_year, artwork_url)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, input.title, slug, input.artistId ?? null, input.releaseYear ?? null, input.artworkUrl ?? null]);
  // Fetch with join for artist_name
  return (await getAlbum(id))!;
}

export async function findOrCreateAlbum(title: string, artistId?: string, releaseYear?: number): Promise<Album> {
  const pool = getPool();
  let artName = '';
  if (artistId) {
    const ar = await getArtist(artistId);
    artName = ar?.name ?? '';
  }
  const slug = albumSlug(artName, title);
  const { rows } = await pool.query('SELECT * FROM albums WHERE slug = $1', [slug]);
  if (rows.length > 0) return (await getAlbum(rows[0].id))!;
  return createAlbum({ title, artistId, releaseYear });
}

// ============================================================
// Play Sessions
// ============================================================

function rowToSession(row: any): PlaySession {
  return {
    id: row.id,
    token: row.token,
    name: row.name,
    ownerId: row.owner_id,
    playlistId: row.playlist_id || null,
    isActive: row.is_active,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    endedAt: row.ended_at ? (row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at) : null,
  };
}

function rowToMember(row: any): SessionMember {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at instanceof Date ? row.joined_at.toISOString() : row.joined_at,
    leftAt: row.left_at ? (row.left_at instanceof Date ? row.left_at.toISOString() : row.left_at) : null,
  };
}

function rowToSessionState(row: any): SessionState {
  return {
    sessionId: row.session_id,
    currentTrackId: row.current_track_id || null,
    isPlaying: row.is_playing,
    positionSec: parseFloat(row.position_sec) || 0,
    positionUpdatedAt: row.position_updated_at instanceof Date ? row.position_updated_at.toISOString() : row.position_updated_at,
    queue: Array.isArray(row.queue) ? row.queue : (typeof row.queue === 'string' ? JSON.parse(row.queue) : []),
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function rowToSessionEvent(row: any): SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id || null,
    eventType: row.event_type,
    metadata: row.metadata || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function createSession(input: { name?: string; ownerId: string; playlistId?: string; queue?: string[] }): Promise<{ session: PlaySession; state: SessionState }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = uuidv4();
    const token = uuidv4();

    const { rows: sRows } = await client.query(`
      INSERT INTO play_sessions (id, token, name, owner_id, playlist_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [id, token, input.name ?? 'Listening Session', input.ownerId, input.playlistId ?? null]);

    // Create initial state
    await client.query(`
      INSERT INTO session_state (session_id, queue, updated_by)
      VALUES ($1, $2, $3)
    `, [id, JSON.stringify(input.queue ?? []), input.ownerId]);

    // Add owner as member
    await client.query(`
      INSERT INTO session_members (session_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `, [id, input.ownerId]);

    // Session event
    await client.query(`
      INSERT INTO session_events (session_id, user_id, event_type, metadata)
      VALUES ($1, $2, 'session_created', '{}')
    `, [id, input.ownerId]);

    await client.query('COMMIT');

    const session = rowToSession(sRows[0]);
    const stateResult = await pool.query('SELECT * FROM session_state WHERE session_id = $1', [id]);
    const state = rowToSessionState(stateResult.rows[0]);

    return { session, state };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSession(token: string): Promise<PlaySession | undefined> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM play_sessions WHERE token = $1', [token]);
  return rows.length > 0 ? rowToSession(rows[0]) : undefined;
}

export async function getSessionById(id: string): Promise<PlaySession | undefined> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM play_sessions WHERE id = $1', [id]);
  return rows.length > 0 ? rowToSession(rows[0]) : undefined;
}

export async function getSessionState(sessionId: string): Promise<SessionState | undefined> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM session_state WHERE session_id = $1', [sessionId]);
  return rows.length > 0 ? rowToSessionState(rows[0]) : undefined;
}

export async function getSessionMembers(sessionId: string): Promise<SessionMember[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM session_members WHERE session_id = $1 AND left_at IS NULL ORDER BY joined_at ASC',
    [sessionId]
  );
  return rows.map(rowToMember);
}

export async function joinSession(sessionId: string, userId: string): Promise<SessionMember> {
  const pool = getPool();
  // Check if already a member
  const { rows: existing } = await pool.query(
    'SELECT * FROM session_members WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL',
    [sessionId, userId]
  );
  if (existing.length > 0) return rowToMember(existing[0]);

  // Check if previously left — update instead of insert
  const { rows: left } = await pool.query(
    'SELECT * FROM session_members WHERE session_id = $1 AND user_id = $2 AND left_at IS NOT NULL',
    [sessionId, userId]
  );
  if (left.length > 0) {
    const { rows } = await pool.query(
      'UPDATE session_members SET left_at = NULL, joined_at = now() WHERE id = $1 RETURNING *',
      [left[0].id]
    );
    await pool.query(`INSERT INTO session_events (session_id, user_id, event_type) VALUES ($1, $2, 'member_joined')`, [sessionId, userId]);
    return rowToMember(rows[0]);
  }

  const { rows } = await pool.query(`
    INSERT INTO session_members (session_id, user_id, role) VALUES ($1, $2, 'member') RETURNING *
  `, [sessionId, userId]);

  await pool.query(`INSERT INTO session_events (session_id, user_id, event_type) VALUES ($1, $2, 'member_joined')`, [sessionId, userId]);

  return rowToMember(rows[0]);
}

export async function leaveSession(sessionId: string, userId: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'UPDATE session_members SET left_at = now() WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL',
    [sessionId, userId]
  );
  if ((rowCount ?? 0) > 0) {
    await pool.query(`INSERT INTO session_events (session_id, user_id, event_type) VALUES ($1, $2, 'member_left')`, [sessionId, userId]);
  }
  return (rowCount ?? 0) > 0;
}

export async function updateSessionState(
  sessionId: string,
  userId: string,
  update: Partial<Pick<SessionState, 'currentTrackId' | 'isPlaying' | 'positionSec' | 'queue'>>
): Promise<SessionState | null> {
  const pool = getPool();
  const sets: string[] = ['updated_by = $1', 'updated_at = now()'];
  const values: any[] = [userId];
  let idx = 2;

  if (update.currentTrackId !== undefined) {
    sets.push(`current_track_id = $${idx}`);
    values.push(update.currentTrackId);
    idx++;
  }
  if (update.isPlaying !== undefined) {
    sets.push(`is_playing = $${idx}`);
    values.push(update.isPlaying);
    idx++;
  }
  if (update.positionSec !== undefined) {
    sets.push(`position_sec = $${idx}`, 'position_updated_at = now()');
    values.push(update.positionSec);
    idx++;
  }
  if (update.queue !== undefined) {
    sets.push(`queue = $${idx}`);
    values.push(JSON.stringify(update.queue));
    idx++;
  }

  values.push(sessionId);
  const { rows } = await pool.query(
    `UPDATE session_state SET ${sets.join(', ')} WHERE session_id = $${idx} RETURNING *`,
    values
  );

  return rows.length > 0 ? rowToSessionState(rows[0]) : null;
}

export async function regenerateSessionToken(sessionId: string, ownerId: string): Promise<string | null> {
  const pool = getPool();
  // Verify ownership
  const session = await getSessionById(sessionId);
  if (!session || session.ownerId !== ownerId) return null;

  const newToken = uuidv4();
  await pool.query('UPDATE play_sessions SET token = $1 WHERE id = $2', [newToken, sessionId]);
  await pool.query(
    `INSERT INTO session_events (session_id, user_id, event_type, metadata) VALUES ($1, $2, 'token_regenerated', $3)`,
    [sessionId, ownerId, JSON.stringify({ oldToken: session.token, newToken })]
  );
  return newToken;
}

export async function endSession(sessionId: string, ownerId: string): Promise<boolean> {
  const pool = getPool();
  const session = await getSessionById(sessionId);
  if (!session || session.ownerId !== ownerId) return false;

  await pool.query('UPDATE play_sessions SET is_active = false, ended_at = now() WHERE id = $1', [sessionId]);
  await pool.query('UPDATE session_state SET is_playing = false WHERE session_id = $1', [sessionId]);
  await pool.query(
    `INSERT INTO session_events (session_id, user_id, event_type) VALUES ($1, $2, 'session_ended')`,
    [sessionId, ownerId]
  );
  return true;
}

export async function recordSessionEvent(
  sessionId: string,
  userId: string | null,
  eventType: string,
  metadata?: Record<string, any>
): Promise<SessionEvent> {
  const pool = getPool();
  const { rows } = await pool.query(`
    INSERT INTO session_events (session_id, user_id, event_type, metadata)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [sessionId, userId, eventType, JSON.stringify(metadata ?? {})]);
  return rowToSessionEvent(rows[0]);
}

export async function getSessionEvents(sessionId: string, opts?: { page?: number; pageSize?: number }): Promise<{ data: SessionEvent[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const pool = getPool();
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;

  const countResult = await pool.query('SELECT COUNT(*) as cnt FROM session_events WHERE session_id = $1', [sessionId]);
  const total = parseInt(countResult.rows[0].cnt, 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (Math.min(page, totalPages) - 1) * pageSize;

  const { rows } = await pool.query(
    'SELECT * FROM session_events WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [sessionId, pageSize, offset]
  );

  return { data: rows.map(rowToSessionEvent), total, page: Math.min(page, totalPages), pageSize, totalPages };
}

export async function getUserSessions(userId: string): Promise<PlaySession[]> {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT DISTINCT ps.* FROM play_sessions ps
    JOIN session_members sm ON sm.session_id = ps.id
    WHERE sm.user_id = $1
    ORDER BY ps.updated_at DESC
  `, [userId]);
  return rows.map(rowToSession);
}
