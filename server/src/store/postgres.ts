/**
 * PostgreSQL-backed store — drop-in replacement for memory.ts.
 * All functions match the same signatures as the memory store.
 */

import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/pool';
import type {
  Track, Playlist, Favorite,
  CreateTrackInput, UpdateTrackInput,
  CreatePlaylistInput, UpdatePlaylistInput,
  AudioStatus, EnrichmentStatus, FieldConfidence,
  PaginationParams, PaginatedResponse,
  SortableTrackField, SortDirection,
} from '../types';

// ============================================================
// Row ↔ Object Mapping
// ============================================================

function rowToTrack(row: any): Track {
  return {
    id: row.id,
    youtubeUrl: row.youtube_url,
    title: row.title,
    artist: row.artist,
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

export async function getTrack(id: string): Promise<Track | undefined> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM tracks WHERE id = $1', [id]);
  return rows.length > 0 ? rowToTrack(rows[0]) : undefined;
}

export async function createTrack(input: CreateTrackInput): Promise<Track> {
  const pool = getPool();
  const id = uuidv4();
  const now = new Date().toISOString();

  const { rows } = await pool.query(`
    INSERT INTO tracks (id, youtube_url, title, artist, start_time_sec, end_time_sec, volume, notes, created_at, updated_at, audio_status, enrichment_status, enrichment_attempts, field_confidences)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'pending', 'none', 0, '[]'::jsonb)
    RETURNING *
  `, [
    id,
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

export async function getPlaylist(id: string): Promise<Playlist | undefined> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM playlists WHERE id = $1', [id]);
  if (rows.length === 0) return undefined;
  const trackIds = await getPlaylistTrackIds(id);
  return rowToPlaylist(rows[0], trackIds);
}

export async function createPlaylist(input: CreatePlaylistInput): Promise<Playlist> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const id = uuidv4();
    const now = new Date().toISOString();

    const { rows } = await client.query(`
      INSERT INTO playlists (id, name, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $4)
      RETURNING *
    `, [id, input.name, input.description ?? '', now]);

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
