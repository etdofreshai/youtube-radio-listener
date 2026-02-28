/**
 * PostgreSQL-backed store — drop-in replacement for memory.ts.
 * All functions match the same signatures as the memory store.
 */

import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/pool';
import type {
  Track, Playlist, Favorite,
  Artist, Album, ArtistSummary,
  TrackVariant, CreateVariantInput, UpdateVariantInput, VariantKind,
  TrackGroup, LinkedTrackSummary,
  PlaySession, SessionMember, SessionState, SessionEvent,
  PlaybackState, UpdatePlaybackStateInput, PlayHistoryEntry,
  CreateTrackInput, UpdateTrackInput,
  CreatePlaylistInput, UpdatePlaylistInput,
  AudioStatus, VideoStatus, EnrichmentStatus, FieldConfidence,
  PaginationParams, PaginatedResponse,
  SortableTrackField, SortDirection,
  LearningResource, CreateLearningResourceInput,
  RadioStation, CreateRadioStationInput, UpdateRadioStationInput,
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
    // Live stream
    isLiveStream: row.is_live_stream ?? false,
    // Video pipeline
    videoStatus: (row.video_status || 'none') as VideoStatus,
    videoError: row.video_error || null,
    videoFilename: row.video_filename || null,
    // Lyrics
    lyrics: row.lyrics || null,
    lyricsSource: row.lyrics_source || null,
  };
}

// ============================================================
// Track-Artists Join Table Helpers
// ============================================================

/** Get all artists linked to a track (ordered by position) */
async function getTrackArtists(trackId: string): Promise<ArtistSummary[]> {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT a.id, a.name, a.slug, ta.role
    FROM track_artists ta
    JOIN artists a ON ta.artist_id = a.id
    WHERE ta.track_id = $1
    ORDER BY ta.position ASC
  `, [trackId]);
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    role: r.role || 'primary',
  }));
}

/** Get artists for multiple tracks in a single query (batch) */
async function getTrackArtistsBatch(trackIds: string[]): Promise<Map<string, ArtistSummary[]>> {
  if (trackIds.length === 0) return new Map();
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT ta.track_id, a.id, a.name, a.slug, ta.role
    FROM track_artists ta
    JOIN artists a ON ta.artist_id = a.id
    WHERE ta.track_id = ANY($1)
    ORDER BY ta.track_id, ta.position ASC
  `, [trackIds]);

  const map = new Map<string, ArtistSummary[]>();
  for (const r of rows) {
    const list = map.get(r.track_id) || [];
    list.push({ id: r.id, name: r.name, slug: r.slug, role: r.role || 'primary' });
    map.set(r.track_id, list);
  }
  return map;
}

/** Set the artists for a track (replaces all existing links) */
async function setTrackArtists(trackId: string, artistIds: string[], client?: any): Promise<void> {
  const pool = client || getPool();
  await pool.query('DELETE FROM track_artists WHERE track_id = $1', [trackId]);
  for (let i = 0; i < artistIds.length; i++) {
    await pool.query(
      `INSERT INTO track_artists (track_id, artist_id, role, position) VALUES ($1, $2, $3, $4)
       ON CONFLICT (track_id, artist_id) DO UPDATE SET position = $4`,
      [trackId, artistIds[i], i === 0 ? 'primary' : 'featured', i]
    );
  }
}

/** Get album details for a track (name + slug) */
async function getTrackAlbumInfo(albumId: string | null): Promise<{ albumName: string | null; albumSlug: string | null }> {
  if (!albumId) return { albumName: null, albumSlug: null };
  const pool = getPool();
  const { rows } = await pool.query('SELECT title, slug FROM albums WHERE id = $1', [albumId]);
  if (rows.length === 0) return { albumName: null, albumSlug: null };
  return { albumName: rows[0].title, albumSlug: rows[0].slug };
}

/** Get album info for multiple tracks in a single query (batch) */
async function getTrackAlbumInfoBatch(albumIds: string[]): Promise<Map<string, { albumName: string; albumSlug: string }>> {
  const uniqueIds = [...new Set(albumIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, title, slug FROM albums WHERE id = ANY($1)', [uniqueIds]);
  const map = new Map<string, { albumName: string; albumSlug: string }>();
  for (const r of rows) {
    map.set(r.id, { albumName: r.title, albumSlug: r.slug });
  }
  return map;
}

// ============================================================
// Track Variants Helpers
// ============================================================

function rowToVariant(row: any): TrackVariant {
  return {
    id: row.id,
    trackId: row.track_id,
    youtubeUrl: row.youtube_url,
    videoId: row.video_id,
    kind: (row.kind || 'original') as VariantKind,
    label: row.label || '',
    isPreferred: row.is_preferred ?? false,
    position: row.position ?? 0,
    metadata: row.metadata || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/** Extract YouTube video ID from URL */
export function extractVideoId(url: string): string {
  // youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (shortMatch) return shortMatch[1];
  // youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) return watchMatch[1];
  // youtube.com/embed/VIDEO_ID
  const embedMatch = url.match(/\/embed\/([^?&]+)/);
  if (embedMatch) return embedMatch[1];
  // fallback
  return 'unknown';
}

/** Get all variants for a track (ordered by position) */
async function getTrackVariants(trackId: string): Promise<TrackVariant[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM track_variants WHERE track_id = $1 ORDER BY position ASC, created_at ASC`,
    [trackId]
  );
  return rows.map(rowToVariant);
}

/** Get variants for multiple tracks in a single query (batch) */
async function getTrackVariantsBatch(trackIds: string[]): Promise<Map<string, TrackVariant[]>> {
  if (trackIds.length === 0) return new Map();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM track_variants WHERE track_id = ANY($1) ORDER BY track_id, position ASC, created_at ASC`,
    [trackIds]
  );
  const map = new Map<string, TrackVariant[]>();
  for (const r of rows) {
    const list = map.get(r.track_id) || [];
    list.push(rowToVariant(r));
    map.set(r.track_id, list);
  }
  return map;
}

/** Find any variant by video ID across all tracks */
export async function findVariantByVideoId(videoId: string): Promise<TrackVariant | undefined> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM track_variants WHERE video_id = $1 LIMIT 1`,
    [videoId]
  );
  return rows.length > 0 ? rowToVariant(rows[0]) : undefined;
}

/** Find tracks that match by normalized title+artist (canonical identity) */
export async function findTracksByCanonicalIdentity(title: string, artist: string): Promise<Track[]> {
  const pool = getPool();
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedArtist = artist.trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT * FROM tracks WHERE LOWER(TRIM(title)) = $1 AND LOWER(TRIM(artist)) = $2`,
    [normalizedTitle, normalizedArtist]
  );
  return rows.map(rowToTrack);
}

/** Create a variant for a track */
export async function createVariant(trackId: string, input: CreateVariantInput): Promise<TrackVariant> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const videoId = extractVideoId(input.youtubeUrl);

    // Get next position
    const posResult = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM track_variants WHERE track_id = $1`,
      [trackId]
    );
    const position = posResult.rows[0].next_pos;

    // If this variant should be preferred, unset all others
    if (input.isPreferred) {
      await client.query(
        `UPDATE track_variants SET is_preferred = false WHERE track_id = $1`,
        [trackId]
      );
    }

    const { rows } = await client.query(`
      INSERT INTO track_variants (track_id, youtube_url, video_id, kind, label, is_preferred, position, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      trackId,
      input.youtubeUrl,
      videoId,
      input.kind || 'original',
      input.label || '',
      input.isPreferred ?? false,
      position,
      JSON.stringify(input.metadata || {}),
    ]);

    // If this variant is now preferred, update the track's youtube_url
    if (input.isPreferred) {
      await client.query(
        `UPDATE tracks SET youtube_url = $1 WHERE id = $2`,
        [input.youtubeUrl, trackId]
      );
    }

    await client.query('COMMIT');
    return rowToVariant(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Update a variant */
export async function updateVariant(trackId: string, variantId: string, input: UpdateVariantInput): Promise<TrackVariant | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // If setting as preferred, unset all others first
    if (input.isPreferred) {
      await client.query(
        `UPDATE track_variants SET is_preferred = false WHERE track_id = $1`,
        [trackId]
      );
    }

    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (input.kind !== undefined) { sets.push(`kind = $${idx}`); values.push(input.kind); idx++; }
    if (input.label !== undefined) { sets.push(`label = $${idx}`); values.push(input.label); idx++; }
    if (input.isPreferred !== undefined) { sets.push(`is_preferred = $${idx}`); values.push(input.isPreferred); idx++; }
    if (input.metadata !== undefined) { sets.push(`metadata = $${idx}`); values.push(JSON.stringify(input.metadata)); idx++; }

    if (sets.length === 0) {
      await client.query('COMMIT');
      const existing = await client.query('SELECT * FROM track_variants WHERE id = $1 AND track_id = $2', [variantId, trackId]);
      return existing.rows.length > 0 ? rowToVariant(existing.rows[0]) : null;
    }

    values.push(variantId, trackId);
    const { rows } = await client.query(
      `UPDATE track_variants SET ${sets.join(', ')} WHERE id = $${idx} AND track_id = $${idx + 1} RETURNING *`,
      values
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const variant = rowToVariant(rows[0]);

    // If this variant is now preferred, sync the track's youtube_url
    if (input.isPreferred) {
      await client.query(
        `UPDATE tracks SET youtube_url = $1 WHERE id = $2`,
        [variant.youtubeUrl, trackId]
      );
    }

    await client.query('COMMIT');
    return variant;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Delete a variant (cannot delete the last/only variant) */
export async function deleteVariant(trackId: string, variantId: string): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check variant count
    const countResult = await client.query(
      `SELECT COUNT(*) as cnt FROM track_variants WHERE track_id = $1`,
      [trackId]
    );
    if (parseInt(countResult.rows[0].cnt, 10) <= 1) {
      await client.query('ROLLBACK');
      throw new Error('Cannot delete the last variant of a track');
    }

    // Check if this is the preferred variant
    const variantResult = await client.query(
      `SELECT * FROM track_variants WHERE id = $1 AND track_id = $2`,
      [variantId, trackId]
    );
    if (variantResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const wasPreferred = variantResult.rows[0].is_preferred;

    const { rowCount } = await client.query(
      `DELETE FROM track_variants WHERE id = $1 AND track_id = $2`,
      [variantId, trackId]
    );

    // If we deleted the preferred variant, make the first remaining variant preferred
    if (wasPreferred) {
      const remaining = await client.query(
        `SELECT * FROM track_variants WHERE track_id = $1 ORDER BY position ASC LIMIT 1`,
        [trackId]
      );
      if (remaining.rows.length > 0) {
        await client.query(
          `UPDATE track_variants SET is_preferred = true WHERE id = $1`,
          [remaining.rows[0].id]
        );
        await client.query(
          `UPDATE tracks SET youtube_url = $1 WHERE id = $2`,
          [remaining.rows[0].youtube_url, trackId]
        );
      }
    }

    await client.query('COMMIT');
    return (rowCount ?? 0) > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Set a variant as preferred */
export async function setPreferredVariant(trackId: string, variantId: string): Promise<TrackVariant | null> {
  return updateVariant(trackId, variantId, { isPreferred: true });
}

/** Get all variants for a track */
export async function getVariants(trackId: string): Promise<TrackVariant[]> {
  return getTrackVariants(trackId);
}

// ============================================================
// Track Groups / Links Helpers
// ============================================================

function rowToLinkedTrackSummary(row: any): LinkedTrackSummary {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    youtubeUrl: row.youtube_url,
    isLiveStream: row.is_live_stream ?? false,
    trackGroupId: row.track_group_id || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function rowToTrackGroup(row: any, trackIds: string[]): TrackGroup {
  return {
    id: row.id,
    name: row.name || '',
    canonicalTrackId: row.canonical_track_id || null,
    trackIds,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

async function getTrackGroupMapBatch(trackIds: string[]): Promise<Map<string, string>> {
  if (trackIds.length === 0) return new Map();

  const pool = getPool();
  const { rows } = await pool.query(
                                                            `SELECT track_id, track_group_id FROM track_group_members WHERE track_id = ANY($1)`,
    [trackIds],
  );

  const map = new Map<string, string>();
  for (const r of rows) map.set(r.track_id, r.track_group_id);
  return map;
}

async function getLinkedTracksBatch(trackIds: string[]): Promise<{
  groupIdByTrack: Map<string, string | null>;
  linkedByTrack: Map<string, LinkedTrackSummary[]>;
}> {
  const groupMapRaw = await getTrackGroupMapBatch(trackIds);

  const groupIdByTrack = new Map<string, string | null>();
  for (const id of trackIds) groupIdByTrack.set(id, groupMapRaw.get(id) || null);

  const groupIds = [...new Set(Array.from(groupMapRaw.values()))];
  if (groupIds.length === 0) {
    return { groupIdByTrack, linkedByTrack: new Map() };
  }

  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT gm.track_group_id, t.id, t.title, t.artist, t.youtube_url, t.is_live_stream, t.created_at
    FROM track_group_members gm
    JOIN tracks t ON t.id = gm.track_id
    WHERE gm.track_group_id = ANY($1)
    ORDER BY gm.track_group_id, gm.position ASC, t.created_at ASC
  `, [groupIds]);

  const byGroup = new Map<string, LinkedTrackSummary[]>();
  for (const r of rows) {
    const list = byGroup.get(r.track_group_id) || [];
    list.push(rowToLinkedTrackSummary({ ...r, track_group_id: r.track_group_id }));
    byGroup.set(r.track_group_id, list);
  }

  const linkedByTrack = new Map<string, LinkedTrackSummary[]>();
  for (const trackId of trackIds) {
    const groupId = groupIdByTrack.get(trackId);
    if (!groupId) {
      linkedByTrack.set(trackId, []);
      continue;
    }
    const members = byGroup.get(groupId) || [];
    linkedByTrack.set(trackId, members.filter(m => m.id !== trackId));
  }

  return { groupIdByTrack, linkedByTrack };
}

async function getTrackGroupId(trackId: string, client?: any): Promise<string | null> {
  const db = client || getPool();
  const { rows } = await db.query(
    `SELECT track_group_id FROM track_group_members WHERE track_id = $1`,
    [trackId],
  );
  return rows.length > 0 ? rows[0].track_group_id : null;
}

async function getTrackGroupById(groupId: string, client?: any): Promise<TrackGroup | undefined> {
  const db = client || getPool();
  const groupRes = await db.query(`SELECT * FROM track_groups WHERE id = $1`, [groupId]);
  if (groupRes.rows.length === 0) return undefined;

  const membersRes = await db.query(
    `SELECT track_id FROM track_group_members WHERE track_group_id = $1 ORDER BY position ASC, linked_at ASC`,
    [groupId],
  );

  return rowToTrackGroup(groupRes.rows[0], membersRes.rows.map((r: any) => r.track_id));
}

/** Get the track group for a track id. */
export async function getTrackGroup(trackId: string): Promise<TrackGroup | undefined> {
  const groupId = await getTrackGroupId(trackId);
  if (!groupId) return undefined;
  return getTrackGroupById(groupId);
}

/** Get linked tracks for a given track id. */
export async function getLinkedTracks(trackId: string): Promise<LinkedTrackSummary[]> {
  const { linkedByTrack } = await getLinkedTracksBatch([trackId]);
  return linkedByTrack.get(trackId) || [];
}

/** Link two tracks (creates/extends/merges groups as needed). */
export async function linkTracks(trackId: string, targetTrackId: string, groupName?: string): Promise<TrackGroup> {
  if (trackId === targetTrackId) throw new Error('Cannot link a track to itself');

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const trackCheck = await client.query(
      `SELECT id FROM tracks WHERE id = ANY($1)`,
      [[trackId, targetTrackId]],
    );
    if (trackCheck.rows.length < 2) {
      throw new Error('One or more tracks not found');
    }

    const aGroup = await getTrackGroupId(trackId, client);
    const bGroup = await getTrackGroupId(targetTrackId, client);

    let finalGroupId: string;

    if (!aGroup && !bGroup) {
      finalGroupId = uuidv4();
      await client.query(
        `INSERT INTO track_groups (id, name, canonical_track_id, created_at, updated_at)
         VALUES ($1, $2, $3, now(), now())`,
        [finalGroupId, groupName || '', trackId],
      );
      await client.query(
        `INSERT INTO track_group_members (track_group_id, track_id, position)
         VALUES ($1, $2, 0), ($1, $3, 1)`,
        [finalGroupId, trackId, targetTrackId],
      );
    } else if (aGroup && !bGroup) {
      finalGroupId = aGroup as string;
      const posRes = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM track_group_members WHERE track_group_id = $1`,
        [finalGroupId],
      );
      await client.query(
        `INSERT INTO track_group_members (track_group_id, track_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (track_id) DO UPDATE
         SET track_group_id = EXCLUDED.track_group_id,
             position = EXCLUDED.position`,
        [finalGroupId, targetTrackId, posRes.rows[0].next_pos],
      );
      if (groupName) {
        await client.query(`UPDATE track_groups SET name = $2 WHERE id = $1`, [finalGroupId, groupName]);
      }
    } else if (!aGroup && bGroup) {
      finalGroupId = bGroup;
      const posRes = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM track_group_members WHERE track_group_id = $1`,
        [finalGroupId],
      );
      await client.query(
        `INSERT INTO track_group_members (track_group_id, track_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (track_id) DO UPDATE
         SET track_group_id = EXCLUDED.track_group_id,
             position = EXCLUDED.position`,
        [finalGroupId, trackId, posRes.rows[0].next_pos],
      );
      if (groupName) {
        await client.query(`UPDATE track_groups SET name = $2 WHERE id = $1`, [finalGroupId, groupName]);
      }
    } else if (aGroup === bGroup) {
      finalGroupId = aGroup as string;
      if (groupName) {
        await client.query(`UPDATE track_groups SET name = $2 WHERE id = $1`, [finalGroupId, groupName]);
      }
    } else {
      // Merge bGroup into aGroup to keep operations deterministic.
      finalGroupId = aGroup as string;
      const sourceGroupId = bGroup as string;

      const posRes = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM track_group_members WHERE track_group_id = $1`,
        [finalGroupId],
      );
      let nextPos = posRes.rows[0].next_pos;

      const sourceMembers = await client.query(
        `SELECT track_id FROM track_group_members WHERE track_group_id = $1 ORDER BY position ASC, linked_at ASC`,
        [sourceGroupId],
      );

      for (const row of sourceMembers.rows) {
        await client.query(
          `UPDATE track_group_members SET track_group_id = $1, position = $2 WHERE track_id = $3`,
          [finalGroupId, nextPos, row.track_id],
        );
        nextPos += 1;
      }

      await client.query(`DELETE FROM track_groups WHERE id = $1`, [sourceGroupId]);
      if (groupName) {
        await client.query(`UPDATE track_groups SET name = $2 WHERE id = $1`, [finalGroupId, groupName]);
      }
    }

    await client.query('COMMIT');

    const group = await getTrackGroupById(finalGroupId);
    if (!group) throw new Error('Failed to load linked track group');
    return group;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Unlink targetTrackId from the same group as trackId. */
export async function unlinkTracks(trackId: string, targetTrackId: string): Promise<boolean> {
  if (trackId === targetTrackId) return false;

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const aGroup = await getTrackGroupId(trackId, client);
    const bGroup = await getTrackGroupId(targetTrackId, client);

    if (!aGroup || !bGroup || aGroup !== bGroup) {
      await client.query('ROLLBACK');
      return false;
    }

    const { rowCount } = await client.query(
      `DELETE FROM track_group_members WHERE track_group_id = $1 AND track_id = $2`,
      [aGroup, targetTrackId],
    );

    if ((rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const remainingRes = await client.query(
      `SELECT track_id FROM track_group_members WHERE track_group_id = $1 ORDER BY position ASC, linked_at ASC`,
      [aGroup],
    );

    if (remainingRes.rows.length < 2) {
      // dissolve singleton groups
      await client.query(`DELETE FROM track_group_members WHERE track_group_id = $1`, [aGroup]);
      await client.query(`DELETE FROM track_groups WHERE id = $1`, [aGroup]);
    } else {
      const canonicalRes = await client.query(`SELECT canonical_track_id FROM track_groups WHERE id = $1`, [aGroup]);
      const canonicalTrackId = canonicalRes.rows[0]?.canonical_track_id || null;
      const stillHasCanonical = canonicalTrackId
        ? remainingRes.rows.some((r: any) => r.track_id === canonicalTrackId)
        : false;

      if (!stillHasCanonical) {
        await client.query(`UPDATE track_groups SET canonical_track_id = $2 WHERE id = $1`, [aGroup, remainingRes.rows[0].track_id]);
      }
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Set the canonical (preferred playback source) track for a track's group. */
export async function setPreferredLinkedTrack(trackId: string, preferredTrackId: string): Promise<TrackGroup | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const groupId = await getTrackGroupId(trackId, client);
    if (!groupId) {
      await client.query('ROLLBACK');
      return null;
    }

    const inGroup = await client.query(
      `SELECT 1 FROM track_group_members WHERE track_group_id = $1 AND track_id = $2`,
      [groupId, preferredTrackId],
    );
    if (inGroup.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `UPDATE track_groups SET canonical_track_id = $2, updated_at = now() WHERE id = $1`,
      [groupId, preferredTrackId],
    );

    await client.query('COMMIT');
    return (await getTrackGroupById(groupId)) ?? null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Resolve preferred playback source for a track, honoring group canonical when present. */
export async function getPreferredPlaybackTrack(trackId: string): Promise<Track | null> {
  const group = await getTrackGroup(trackId);

  if (!group || !group.canonicalTrackId) {
    const track = await getTrack(trackId);
    return track || null;
  }

  const preferred = await getTrack(group.canonicalTrackId);
  if (preferred) return preferred;

  const fallbackTrackId = group.trackIds[0] || trackId;
  const fallback = await getTrack(fallbackTrackId);
  return fallback || null;
}

/** Populate a track with artists + album info + variants + links */
async function populateTrack(track: Track): Promise<Track> {
  const [artists, albumInfo, variants, linkedBatch] = await Promise.all([
    getTrackArtists(track.id),
    getTrackAlbumInfo(track.albumId),
    getTrackVariants(track.id),
    getLinkedTracksBatch([track.id]),
  ]);

  return {
    ...track,
    artists,
    ...albumInfo,
    variants,
    trackGroupId: linkedBatch.groupIdByTrack.get(track.id) || null,
    linkedTracks: linkedBatch.linkedByTrack.get(track.id) || [],
  };
}

/** Populate multiple tracks with artists + album info (batch) */
async function populateTracks(tracks: Track[]): Promise<Track[]> {
  if (tracks.length === 0) return [];

  const trackIds = tracks.map(t => t.id);
  const albumIds = tracks.map(t => t.albumId).filter(Boolean) as string[];

  const [artistsMap, albumsMap, variantsMap, linkedBatch] = await Promise.all([
    getTrackArtistsBatch(trackIds),
    getTrackAlbumInfoBatch(albumIds),
    getTrackVariantsBatch(trackIds),
    getLinkedTracksBatch(trackIds),
  ]);

  return tracks.map(t => ({
    ...t,
    artists: artistsMap.get(t.id) || [],
    albumName: t.albumId ? albumsMap.get(t.albumId)?.albumName || null : null,
    albumSlug: t.albumId ? albumsMap.get(t.albumId)?.albumSlug || null : null,
    variants: variantsMap.get(t.id) || [],
    trackGroupId: linkedBatch.groupIdByTrack.get(t.id) || null,
    linkedTracks: linkedBatch.linkedByTrack.get(t.id) || [],
  }));
}

function rowToPlaylist(row: any, trackIds: string[]): Playlist {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug || null,
    description: row.description || '',
    trackIds,
    // Ownership / sharing (v11)
    ownerId: row.created_by || null,
    ownerUsername: row.owner_username || null,
    updatedBy: row.updated_by || null,
    updatedByUsername: row.updated_by_username || null,
    isPublic: row.is_public ?? false,
    isEditableByOthers: row.is_editable_by_others ?? false,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// ============================================================
// Playlist Permission Helpers (v11)
// ============================================================

/** A playlist with no owner is a legacy playlist — everyone can edit/delete */
export async function canEditPlaylist(playlistId: string, actorId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT created_by, is_editable_by_others FROM playlists WHERE id = $1',
    [playlistId]
  );
  if (rows.length === 0) return false;
  const { created_by, is_editable_by_others } = rows[0];
  // Legacy (no owner) — everyone can edit
  if (!created_by) return true;
  // Owner can always edit
  if (created_by === actorId) return true;
  // Others can edit if flag is set
  return is_editable_by_others === true;
}

export async function canDeletePlaylist(playlistId: string, actorId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT created_by FROM playlists WHERE id = $1',
    [playlistId]
  );
  if (rows.length === 0) return false;
  const { created_by } = rows[0];
  // Legacy (no owner) — everyone can delete
  if (!created_by) return true;
  // Only owner can delete
  return created_by === actorId;
}

export async function canViewPlaylist(playlistId: string, actorId?: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT created_by, is_public FROM playlists WHERE id = $1',
    [playlistId]
  );
  if (rows.length === 0) return false;
  const { created_by, is_public } = rows[0];
  // Public or legacy (no owner) — everyone can view
  if (is_public || !created_by) return true;
  if (!actorId) return false;
  return created_by === actorId;
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
  const tracks = rows.map(rowToTrack);
  return populateTracks(tracks);
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

  const tracks = await populateTracks(dataResult.rows.map(rowToTrack));

  return {
    data: tracks,
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
  const isUuidVal = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const { rows } = isUuidVal
    ? await pool.query('SELECT * FROM tracks WHERE id = $1', [idOrSlug])
    : await pool.query('SELECT * FROM tracks WHERE slug = $1', [idOrSlug]);
  if (rows.length === 0) return undefined;
  return populateTrack(rowToTrack(rows[0]));
}

export async function createTrack(input: CreateTrackInput): Promise<Track> {
  const pool = getPool();
  const id = uuidv4();
  const now = new Date().toISOString();
  const title = input.title || 'Untitled';
  const artist = input.artist || 'Unknown Artist';
  const slug = await generateUniqueSlug(pool, 'tracks', trackSlug(artist, title));

  // Auto-link artist by name if no artistIds provided
  let artistIds = input.artistIds;
  let primaryArtistId: string | null = null;
  if ((!artistIds || artistIds.length === 0) && artist !== 'Unknown Artist') {
    try {
      const ar = await findOrCreateArtist(artist);
      primaryArtistId = ar.id;
      artistIds = [ar.id];
    } catch { /* non-critical */ }
  } else if (artistIds && artistIds.length > 0) {
    primaryArtistId = artistIds[0];
  }

  const isLive = input.isLiveStream ?? false;
  const { rows } = await pool.query(`
    INSERT INTO tracks (id, slug, youtube_url, title, artist, artist_id, start_time_sec, end_time_sec, volume, notes, created_at, updated_at, audio_status, enrichment_status, enrichment_attempts, field_confidences, is_live_stream)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, 'none', 0, '[]'::jsonb, $13)
    RETURNING *
  `, [
    id,
    slug,
    input.youtubeUrl,
    title,
    artist,
    primaryArtistId,
    input.startTimeSec ?? null,
    input.endTimeSec ?? null,
    input.volume ?? 100,
    input.notes ?? '',
    now,
    isLive ? 'ready' : 'pending',  // live streams are immediately "ready" (streamed)
    isLive,
  ]);

  // Create track_artists join records
  if (artistIds && artistIds.length > 0) {
    await setTrackArtists(id, artistIds);
  }

  // Create default variant for the track
  const videoId = extractVideoId(input.youtubeUrl);
  await pool.query(`
    INSERT INTO track_variants (track_id, youtube_url, video_id, kind, label, is_preferred, position)
    VALUES ($1, $2, $3, 'original', 'Original', true, 0)
    ON CONFLICT (track_id, video_id) DO NOTHING
  `, [id, input.youtubeUrl, videoId]);

  return populateTrack(rowToTrack(rows[0]));
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
    ['isLiveStream', 'is_live_stream'],
    ['album', 'album'],
    ['albumId', 'album_id'],
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

  // Update artist_id to first of artistIds if provided
  if (input.artistIds !== undefined && input.artistIds.length > 0) {
    sets.push(`artist_id = $${paramIdx}`);
    values.push(input.artistIds[0]);
    paramIdx++;
  }

  if (sets.length === 0 && !input.artistIds) {
    const t = await getTrack(id);
    return t || null;
  }

  let track: Track;
  if (sets.length > 0) {
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE tracks SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );
    if (rows.length === 0) return null;
    track = rowToTrack(rows[0]);
  } else {
    const existing = await getTrack(id);
    if (!existing) return null;
    track = existing;
  }

  // Update track_artists join table if artistIds provided
  if (input.artistIds !== undefined) {
    await setTrackArtists(id, input.artistIds);
  }

  return populateTrack(track);
}

/** Get all tracks for a given artist (via track_artists join or legacy artist_id) */
export async function getTracksByArtist(artistId: string): Promise<Track[]> {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT DISTINCT t.* FROM tracks t
    LEFT JOIN track_artists ta ON ta.track_id = t.id
    WHERE ta.artist_id = $1 OR t.artist_id = $1
    ORDER BY t.created_at DESC
  `, [artistId]);
  return populateTracks(rows.map(rowToTrack));
}

/** Get all tracks for a given album */
export async function getTracksByAlbum(albumId: string): Promise<Track[]> {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT * FROM tracks WHERE album_id = $1 ORDER BY created_at DESC
  `, [albumId]);
  return populateTracks(rows.map(rowToTrack));
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

export async function updateTrackVideo(
  id: string,
  fields: {
    videoStatus: VideoStatus;
    videoError?: string | null;
    videoFilename?: string | null;
  }
): Promise<Track | null> {
  const pool = getPool();

  const { rows } = await pool.query(`
    UPDATE tracks
    SET video_status = $2,
        video_error = COALESCE($3, video_error),
        video_filename = COALESCE($4, video_filename)
    WHERE id = $1
    RETURNING *
  `, [
    id,
    fields.videoStatus,
    fields.videoError !== undefined ? fields.videoError : null,
    fields.videoFilename !== undefined ? fields.videoFilename : null,
  ]);

  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

export async function updateTrackLyrics(
  id: string,
  lyrics: string | null,
  lyricsSource: string | null,
): Promise<Track | null> {
  const pool = getPool();
  const { rows } = await pool.query(`
    UPDATE tracks SET lyrics = $2, lyrics_source = $3 WHERE id = $1 RETURNING *
  `, [id, lyrics, lyricsSource]);
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

/** Reusable JOIN query for playlist rows with denormalized user info */
const PLAYLIST_SELECT = `
  SELECT p.*,
    owner.username  AS owner_username,
    updater.username AS updated_by_username
  FROM playlists p
  LEFT JOIN users owner   ON p.created_by  = owner.id
  LEFT JOIN users updater ON p.updated_by  = updater.id
`;

/**
 * List playlists visible to actorId:
 * - own playlists (created_by = actorId)
 * - public playlists (is_public = true)
 * - legacy playlists (created_by IS NULL)
 * If no actorId, only public + legacy are returned.
 */
export async function getAllPlaylists(actorId?: string): Promise<Playlist[]> {
  const pool = getPool();
  let rows: any[];

  if (actorId) {
    ({ rows } = await pool.query(
      `${PLAYLIST_SELECT}
       WHERE p.created_by = $1
          OR p.is_public = true
          OR p.created_by IS NULL
       ORDER BY p.created_at DESC`,
      [actorId]
    ));
  } else {
    ({ rows } = await pool.query(
      `${PLAYLIST_SELECT}
       WHERE p.is_public = true OR p.created_by IS NULL
       ORDER BY p.created_at DESC`
    ));
  }

  const playlists: Playlist[] = [];
  for (const row of rows) {
    const trackIds = await getPlaylistTrackIds(row.id);
    playlists.push(rowToPlaylist(row, trackIds));
  }
  return playlists;
}

/** Lookup by UUID or slug — joins user info */
export async function getPlaylist(idOrSlug: string): Promise<Playlist | undefined> {
  const pool = getPool();
  const isUuidVal = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const { rows } = await pool.query(
    `${PLAYLIST_SELECT} WHERE ${isUuidVal ? 'p.id' : 'p.slug'} = $1`,
    [idOrSlug]
  );
  if (rows.length === 0) return undefined;
  const trackIds = await getPlaylistTrackIds(rows[0].id);
  return rowToPlaylist(rows[0], trackIds);
}

export async function createPlaylist(input: CreatePlaylistInput, actorId?: string): Promise<Playlist> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const id = uuidv4();
    const now = new Date().toISOString();
    const slug = await generateUniqueSlug(pool, 'playlists', slugify(input.name));

    await client.query(`
      INSERT INTO playlists
        (id, slug, name, description, created_by, is_public, is_editable_by_others, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    `, [
      id, slug, input.name, input.description ?? '',
      actorId || null,
      input.isPublic ?? false,
      input.isEditableByOthers ?? false,
      now,
    ]);

    // Insert track associations
    const trackIds = input.trackIds ?? [];
    for (let i = 0; i < trackIds.length; i++) {
      await client.query(
        `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by) VALUES ($1, $2, $3, $4)`,
        [id, trackIds[i], i, actorId || null]
      );
    }

    await client.query('COMMIT');

    // Re-fetch with JOIN to get owner info
    const { rows } = await pool.query(`${PLAYLIST_SELECT} WHERE p.id = $1`, [id]);
    return rowToPlaylist(rows[0], trackIds);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updatePlaylist(id: string, input: UpdatePlaylistInput, actorId?: string): Promise<Playlist | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update playlist fields
    const sets: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${paramIdx}`); values.push(input.name); paramIdx++;
    }
    if (input.description !== undefined) {
      sets.push(`description = $${paramIdx}`); values.push(input.description); paramIdx++;
    }
    if (input.isPublic !== undefined) {
      sets.push(`is_public = $${paramIdx}`); values.push(input.isPublic); paramIdx++;
    }
    if (input.isEditableByOthers !== undefined) {
      sets.push(`is_editable_by_others = $${paramIdx}`); values.push(input.isEditableByOthers); paramIdx++;
    }
    // Always stamp updated_by when making changes
    if (actorId && sets.length > 0) {
      sets.push(`updated_by = $${paramIdx}`); values.push(actorId); paramIdx++;
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
      await client.query('DELETE FROM playlist_tracks WHERE playlist_id = $1', [id]);
      for (let i = 0; i < input.trackIds.length; i++) {
        await client.query(
          `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by) VALUES ($1, $2, $3, $4)`,
          [id, input.trackIds[i], i, actorId || null]
        );
      }
      // Also stamp updated_by if we only updated tracks (no field sets above)
      if (sets.length === 0 && actorId) {
        await client.query('UPDATE playlists SET updated_by = $1 WHERE id = $2', [actorId, id]);
      }
    }

    await client.query('COMMIT');

    // Re-fetch with JOIN to get user info
    const { rows: freshRows } = await pool.query(`${PLAYLIST_SELECT} WHERE p.id = $1`, [id]);
    const trackIds = input.trackIds ?? await getPlaylistTrackIds(id);
    return rowToPlaylist(freshRows[0], trackIds);
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

// ============================================================
// Learning Resources
// ============================================================

function rowToLearningResource(row: any): LearningResource {
  return {
    id: row.id,
    trackId: row.track_id,
    resourceType: row.resource_type,
    title: row.title,
    provider: row.provider,
    url: row.url,
    snippet: row.snippet || null,
    confidence: row.confidence || null,
    isSaved: row.is_saved ?? false,
    searchQuery: row.search_query || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/** Get all learning resources for a track */
export async function getLearningResources(trackId: string): Promise<LearningResource[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM track_learning_resources WHERE track_id = $1 ORDER BY is_saved DESC, confidence, created_at DESC`,
    [trackId]
  );
  return rows.map(rowToLearningResource);
}

/** Get cached learning resources for a track (unsaved, from recent searches) */
export async function getCachedLearningResources(trackId: string): Promise<LearningResource[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM track_learning_resources WHERE track_id = $1 AND is_saved = false ORDER BY confidence, created_at DESC`,
    [trackId]
  );
  return rows.map(rowToLearningResource);
}

/** Get saved learning resources for a track */
export async function getSavedLearningResources(trackId: string): Promise<LearningResource[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM track_learning_resources WHERE track_id = $1 AND is_saved = true ORDER BY created_at DESC`,
    [trackId]
  );
  return rows.map(rowToLearningResource);
}

/** Create multiple learning resources (batch insert) */
export async function createLearningResources(
  trackId: string,
  resources: Omit<LearningResource, 'id' | 'trackId' | 'createdAt' | 'updatedAt' | 'searchQuery'>[],
  searchQuery: string
): Promise<LearningResource[]> {
  const pool = getPool();
  const now = new Date().toISOString();
  const created: LearningResource[] = [];

  for (const r of resources) {
    const id = uuidv4();
    const { rows } = await pool.query(`
      INSERT INTO track_learning_resources (id, track_id, resource_type, title, provider, url, snippet, confidence, is_saved, search_query, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      RETURNING *
    `, [id, trackId, r.resourceType, r.title, r.provider, r.url, r.snippet, r.confidence, r.isSaved ?? false, searchQuery, now]);
    created.push(rowToLearningResource(rows[0]));
  }

  return created;
}

/** Create a single learning resource (for manual add) */
export async function createLearningResource(
  trackId: string,
  input: CreateLearningResourceInput
): Promise<LearningResource> {
  const pool = getPool();
  const id = uuidv4();
  const now = new Date().toISOString();

  const { rows } = await pool.query(`
    INSERT INTO track_learning_resources (id, track_id, resource_type, title, provider, url, snippet, confidence, is_saved, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $9)
    RETURNING *
  `, [id, trackId, input.resourceType, input.title, input.provider, input.url, input.snippet || null, input.confidence || null, now]);

  return rowToLearningResource(rows[0]);
}

/** Save/bookmark a learning resource */
export async function saveLearningResource(trackId: string, resourceId: string): Promise<LearningResource | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE track_learning_resources SET is_saved = true, updated_at = now() WHERE id = $1 AND track_id = $2 RETURNING *`,
    [resourceId, trackId]
  );
  return rows.length > 0 ? rowToLearningResource(rows[0]) : null;
}

/** Unsave/remove bookmark from a learning resource */
export async function unsaveLearningResource(trackId: string, resourceId: string): Promise<LearningResource | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE track_learning_resources SET is_saved = false, updated_at = now() WHERE id = $1 AND track_id = $2 RETURNING *`,
    [resourceId, trackId]
  );
  return rows.length > 0 ? rowToLearningResource(rows[0]) : null;
}

/** Delete a learning resource */
export async function deleteLearningResource(trackId: string, resourceId: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM track_learning_resources WHERE id = $1 AND track_id = $2`,
    [resourceId, trackId]
  );
  return (rowCount ?? 0) > 0;
}

/** Clear cached (unsaved) learning resources for a track */
export async function clearCachedLearningResources(trackId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `DELETE FROM track_learning_resources WHERE track_id = $1 AND is_saved = false`,
    [trackId]
  );
}

// ============================================================
// Radio Stations
// ============================================================

function rowToRadioStation(row: any): RadioStation {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    streamUrl: row.stream_url,
    homepageUrl: row.homepage_url || null,
    description: row.description || null,
    imageUrl: row.image_url || null,
    isLive: row.is_live ?? true,
    active: row.active ?? true,
    tags: Array.isArray(row.tags) ? row.tags : (row.tags ? JSON.parse(row.tags) : []),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function getAllRadioStations(includeInactive = false): Promise<RadioStation[]> {
  const pool = getPool();
  const where = includeInactive ? '' : 'WHERE active = true';
  const { rows } = await pool.query(
    `SELECT * FROM radio_stations ${where} ORDER BY name ASC`
  );
  return rows.map(rowToRadioStation);
}

export async function getRadioStation(idOrSlug: string): Promise<RadioStation | null> {
  const pool = getPool();
  const isUuidVal = isUuid(idOrSlug);
  const { rows } = await pool.query(
    `SELECT * FROM radio_stations WHERE ${isUuidVal ? 'id' : 'slug'} = $1`,
    [idOrSlug]
  );
  return rows.length > 0 ? rowToRadioStation(rows[0]) : null;
}

export async function createRadioStation(input: CreateRadioStationInput): Promise<RadioStation> {
  const pool = getPool();
  const id = uuidv4();
  const slug = slugify(input.name);
  const tags = JSON.stringify(input.tags ?? []);
  const { rows } = await pool.query(`
    INSERT INTO radio_stations (id, name, slug, stream_url, homepage_url, description, image_url, is_live, active, tags)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    id, input.name, slug, input.streamUrl,
    input.homepageUrl ?? null, input.description ?? null, input.imageUrl ?? null,
    input.isLive ?? true, input.active ?? true, tags,
  ]);
  return rowToRadioStation(rows[0]);
}

export async function updateRadioStation(idOrSlug: string, input: UpdateRadioStationInput): Promise<RadioStation | null> {
  const pool = getPool();
  const isUuidVal = isUuid(idOrSlug);

  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (input.name !== undefined) { sets.push(`name = $${idx++}`); values.push(input.name); }
  if (input.streamUrl !== undefined) { sets.push(`stream_url = $${idx++}`); values.push(input.streamUrl); }
  if (input.homepageUrl !== undefined) { sets.push(`homepage_url = $${idx++}`); values.push(input.homepageUrl); }
  if (input.description !== undefined) { sets.push(`description = $${idx++}`); values.push(input.description); }
  if (input.imageUrl !== undefined) { sets.push(`image_url = $${idx++}`); values.push(input.imageUrl); }
  if (input.isLive !== undefined) { sets.push(`is_live = $${idx++}`); values.push(input.isLive); }
  if (input.active !== undefined) { sets.push(`active = $${idx++}`); values.push(input.active); }
  if (input.tags !== undefined) { sets.push(`tags = $${idx++}`); values.push(JSON.stringify(input.tags)); }

  if (sets.length === 0) return getRadioStation(idOrSlug);

  values.push(idOrSlug);
  const { rows } = await pool.query(
    `UPDATE radio_stations SET ${sets.join(', ')} WHERE ${isUuidVal ? 'id' : 'slug'} = $${idx} RETURNING *`,
    values
  );
  return rows.length > 0 ? rowToRadioStation(rows[0]) : null;
}

export async function deleteRadioStation(idOrSlug: string): Promise<boolean> {
  const pool = getPool();
  const isUuidVal = isUuid(idOrSlug);
  const { rowCount } = await pool.query(
    `DELETE FROM radio_stations WHERE ${isUuidVal ? 'id' : 'slug'} = $1`,
    [idOrSlug]
  );
  return (rowCount ?? 0) > 0;
}

// ============================================================
// Playback State (cross-device sync)
// ============================================================

function rowToPlaybackState(row: any): PlaybackState {
  return {
    userId: row.user_id,
    currentTrackId: row.current_track_id ?? null,
    positionSec: parseFloat(row.position_sec) || 0,
    isPlaying: row.is_playing ?? false,
    queue: Array.isArray(row.queue) ? row.queue : [],
    playHistory: Array.isArray(row.play_history) ? row.play_history : [],
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

export async function getPlaybackState(userId: string): Promise<PlaybackState | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM playback_state WHERE user_id = $1', [userId]);
  return rows.length > 0 ? rowToPlaybackState(rows[0]) : null;
}

export async function upsertPlaybackState(userId: string, update: UpdatePlaybackStateInput): Promise<PlaybackState> {
  const pool = getPool();

  // Build the UPSERT — always ensure a row exists
  const sets: string[] = [];
  const vals: any[] = [userId];
  let idx = 2;

  if (update.currentTrackId !== undefined) {
    sets.push(`current_track_id = $${idx++}`);
    vals.push(update.currentTrackId);
  }
  if (update.positionSec !== undefined) {
    sets.push(`position_sec = $${idx++}`);
    vals.push(update.positionSec);
  }
  if (update.isPlaying !== undefined) {
    sets.push(`is_playing = $${idx++}`);
    vals.push(update.isPlaying);
  }
  if (update.queue !== undefined) {
    sets.push(`queue = $${idx++}`);
    vals.push(JSON.stringify(update.queue));
  }
  if (update.playHistory !== undefined) {
    sets.push(`play_history = $${idx++}`);
    vals.push(JSON.stringify(update.playHistory));
  }

  if (sets.length === 0) {
    // Nothing to update — just ensure row exists and return it
    const { rows } = await pool.query(`
      INSERT INTO playback_state (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
      RETURNING *
    `, [userId]);
    if (rows.length > 0) return rowToPlaybackState(rows[0]);
    // Row already existed
    const existing = await getPlaybackState(userId);
    return existing!;
  }

  const { rows } = await pool.query(`
    INSERT INTO playback_state (user_id, ${sets.map(s => s.split(' = ')[0]).join(', ')})
    VALUES ($1, ${Array.from({ length: sets.length }, (_, i) => `$${i + 2}`).join(', ')})
    ON CONFLICT (user_id) DO UPDATE SET ${sets.join(', ')}, updated_at = now()
    RETURNING *
  `, vals);

  return rowToPlaybackState(rows[0]);
}
