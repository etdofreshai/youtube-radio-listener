/**
 * Auto-migration: ensures all required tables and columns exist.
 *
 * Embeds the full idempotent schema DDL (equivalent to migrate-v4-persistence.sql)
 * so it works in Docker builds where .sql files aren't copied to dist/.
 *
 * Safe to run on every startup — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 */

import { getPool } from './pool';

/**
 * Combined DDL: v4 (full persistence) + v5 (linkable entities + sessions).
 * All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */
const SCHEMA_DDL = `
-- ============================================================
-- 0. Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. Users table
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  email TEXT UNIQUE,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (id, username, display_name, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'local', 'Local User', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- 2. Tracks table (base + all columns)
-- ============================================================
CREATE TABLE IF NOT EXISTS tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  start_time_sec INTEGER,
  end_time_sec INTEGER,
  volume INTEGER NOT NULL DEFAULT 100 CHECK (volume >= 0 AND volume <= 200),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audio pipeline
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_error TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_filename TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS last_download_at TIMESTAMPTZ;

-- Verification
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- YouTube metadata
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_channel TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_channel_id TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_upload_date DATE;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_description TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_thumbnail_url TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_view_count BIGINT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_like_count BIGINT;

-- Music metadata
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS release_year INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS isrc TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS bpm REAL;

-- Provenance
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS metadata_source TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS metadata_confidence TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

-- Enrichment pipeline
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_error TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS next_enrich_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stage_a_completed_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stage_b_completed_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS field_confidences JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Artwork + links
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_url TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_source TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS alternate_links JSONB;

-- Video pipeline
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS video_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS video_error TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS video_filename TEXT;

-- Lyrics
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS lyrics TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS lyrics_source TEXT;

-- Live stream support (v7)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS is_live_stream BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. Playlists + playlist_tracks
-- ============================================================
CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- ============================================================
-- v11: Playlist ownership / sharing flags
-- ============================================================
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS is_editable_by_others BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, track_id)
);

ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES users(id);

-- ============================================================
-- 4. Favorites
-- ============================================================
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  liked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (track_id)
);

ALTER TABLE favorites ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- ============================================================
-- 5. Events (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_verified ON tracks(verified);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
CREATE INDEX IF NOT EXISTS idx_tracks_release_year ON tracks(release_year);
CREATE INDEX IF NOT EXISTS idx_tracks_created_at_desc ON tracks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_enrichment_status ON tracks(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_tracks_next_enrich_at ON tracks(next_enrich_at) WHERE next_enrich_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_audio_status ON tracks(audio_status);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_favorites_track ON favorites(track_id);
CREATE INDEX IF NOT EXISTS idx_favorites_liked ON favorites(liked_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_created ON events(user_id, created_at DESC);

-- ============================================================
-- 7. updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_tracks_updated_at ON tracks;
CREATE TRIGGER update_tracks_updated_at
  BEFORE UPDATE ON tracks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_playlists_updated_at ON playlists;
CREATE TRIGGER update_playlists_updated_at
  BEFORE UPDATE ON playlists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- v5: Linkable entities + shared play sessions
-- ============================================================

-- Artists
CREATE TABLE IF NOT EXISTS artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  image_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_artists_slug ON artists(slug);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

-- Albums
CREATE TABLE IF NOT EXISTS albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  artist_id UUID REFERENCES artists(id) ON DELETE SET NULL,
  release_year INTEGER,
  artwork_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title);

-- Tracks: slug + FK refs
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artist_id UUID REFERENCES artists(id) ON DELETE SET NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album_id UUID REFERENCES albums(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_slug ON tracks(slug);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);

-- Playlists: slug
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE INDEX IF NOT EXISTS idx_playlists_slug ON playlists(slug);

-- Play Sessions
CREATE TABLE IF NOT EXISTS play_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Listening Session',
  owner_id UUID NOT NULL REFERENCES users(id),
  playlist_id UUID REFERENCES playlists(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_play_sessions_token ON play_sessions(token);
CREATE INDEX IF NOT EXISTS idx_play_sessions_owner ON play_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_play_sessions_active ON play_sessions(is_active) WHERE is_active = true;

-- Session Members
CREATE TABLE IF NOT EXISTS session_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_session_members_session ON session_members(session_id);
CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members(user_id);

-- Session State
CREATE TABLE IF NOT EXISTS session_state (
  session_id UUID PRIMARY KEY REFERENCES play_sessions(id) ON DELETE CASCADE,
  current_track_id UUID REFERENCES tracks(id) ON DELETE SET NULL,
  is_playing BOOLEAN NOT NULL DEFAULT false,
  position_sec REAL NOT NULL DEFAULT 0,
  position_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  queue JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session Events
CREATE TABLE IF NOT EXISTS session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_created ON session_events(session_id, created_at DESC);

-- Triggers for v5 tables
DROP TRIGGER IF EXISTS update_artists_updated_at ON artists;
CREATE TRIGGER update_artists_updated_at
  BEFORE UPDATE ON artists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_albums_updated_at ON albums;
CREATE TRIGGER update_albums_updated_at
  BEFORE UPDATE ON albums
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_play_sessions_updated_at ON play_sessions;
CREATE TRIGGER update_play_sessions_updated_at
  BEFORE UPDATE ON play_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- v6: Multi-artist support (track_artists join table)
-- ============================================================

CREATE TABLE IF NOT EXISTS track_artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'primary',   -- 'primary' | 'featured' | 'remix'
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (track_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_track_artists_track ON track_artists(track_id);
CREATE INDEX IF NOT EXISTS idx_track_artists_artist ON track_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_track_artists_position ON track_artists(track_id, position);

-- ============================================================
-- v7: Track variants — multiple YouTube URLs per canonical track
-- ============================================================

CREATE TABLE IF NOT EXISTS track_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  youtube_url TEXT NOT NULL,
  video_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'original',
  label TEXT NOT NULL DEFAULT '',
  is_preferred BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_track_variants_track ON track_variants(track_id);
CREATE INDEX IF NOT EXISTS idx_track_variants_video_id ON track_variants(video_id);
CREATE INDEX IF NOT EXISTS idx_track_variants_preferred ON track_variants(track_id, is_preferred) WHERE is_preferred = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_variants_unique_video ON track_variants(track_id, video_id);

DROP TRIGGER IF EXISTS update_track_variants_updated_at ON track_variants;
CREATE TRIGGER update_track_variants_updated_at
  BEFORE UPDATE ON track_variants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- v8: Track Groups / Linked Track Rows
-- ============================================================

CREATE TABLE IF NOT EXISTS track_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  canonical_track_id UUID REFERENCES tracks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS track_group_members (
  track_group_id UUID NOT NULL REFERENCES track_groups(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (track_group_id, track_id),
  UNIQUE (track_id)
);

CREATE INDEX IF NOT EXISTS idx_track_group_members_group ON track_group_members(track_group_id, position);
CREATE INDEX IF NOT EXISTS idx_track_group_members_track ON track_group_members(track_id);
CREATE INDEX IF NOT EXISTS idx_track_groups_canonical_track_id ON track_groups(canonical_track_id);

DROP TRIGGER IF EXISTS update_track_groups_updated_at ON track_groups;
CREATE TRIGGER update_track_groups_updated_at
  BEFORE UPDATE ON track_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- v10: Radio Stations
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  stream_url TEXT NOT NULL,
  homepage_url TEXT,
  description TEXT,
  image_url TEXT,
  is_live BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radio_stations_slug ON radio_stations(slug);
CREATE INDEX IF NOT EXISTS idx_radio_stations_active ON radio_stations(active) WHERE active = true;

DROP TRIGGER IF EXISTS update_radio_stations_updated_at ON radio_stations;
CREATE TRIGGER update_radio_stations_updated_at
  BEFORE UPDATE ON radio_stations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed default: Rainwave OCR Remix
-- Uses the official Rainwave M3U endpoint for OCRemix (station 2).
-- The /api/radios/:id/resolve-stream endpoint fetches this M3U and extracts
-- the first HTTPS stream URL (e.g. https://relay.rainwave.cc:443/ocremix.mp3).
-- MP3 chosen for broadest browser support; resolve-stream prefers HTTPS relay.
INSERT INTO radio_stations (id, name, slug, stream_url, homepage_url, description, is_live, active, tags)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'Rainwave OCR Remix',
  'rainwave-ocr-remix',
  'https://rainwave.cc/tune_in/2.mp3.m3u',
  'https://rainwave.cc/ocremix/',
  '24/7 live radio of video game music remixes from OverClocked ReMix, curated by Rainwave.',
  true,
  true,
  '["vgm","remix","ocremix","rainwave"]'::jsonb
) ON CONFLICT (slug) DO UPDATE SET stream_url = EXCLUDED.stream_url;

-- ============================================================
-- v9: Learning Resources (Learn/Play feature)
-- ============================================================

CREATE TABLE IF NOT EXISTS track_learning_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('guitar-tabs', 'guitar-chords', 'piano-keys', 'sheet-music', 'tutorial')),
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  url TEXT NOT NULL,
  snippet TEXT,
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  is_saved BOOLEAN NOT NULL DEFAULT false,
  search_query TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_resources_track ON track_learning_resources(track_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_saved ON track_learning_resources(track_id, is_saved) WHERE is_saved = true;
CREATE INDEX IF NOT EXISTS idx_learning_resources_type ON track_learning_resources(track_id, resource_type);

DROP TRIGGER IF EXISTS update_learning_resources_updated_at ON track_learning_resources;
CREATE TRIGGER update_learning_resources_updated_at
  BEFORE UPDATE ON track_learning_resources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
`;

/**
 * Backfill: create a default 'original' variant for any track that doesn't
 * have one yet. Idempotent — safe to run on every startup.
 */
const BACKFILL_VARIANTS = `
INSERT INTO track_variants (track_id, youtube_url, video_id, kind, label, is_preferred, position)
SELECT
  t.id,
  t.youtube_url,
  COALESCE(
    -- Extract video ID from various YouTube URL formats
    CASE
      WHEN t.youtube_url LIKE '%youtu.be/%'
        THEN split_part(split_part(t.youtube_url, 'youtu.be/', 2), '?', 1)
      WHEN t.youtube_url LIKE '%v=%'
        THEN split_part(split_part(t.youtube_url, 'v=', 2), '&', 1)
      WHEN t.youtube_url LIKE '%/embed/%'
        THEN split_part(split_part(t.youtube_url, '/embed/', 2), '?', 1)
      ELSE 'unknown-' || t.id::text
    END,
    'unknown-' || t.id::text
  ),
  'original',
  'Original',
  true,
  0
FROM tracks t
WHERE NOT EXISTS (
  SELECT 1 FROM track_variants tv WHERE tv.track_id = t.id
);
`;

/**
 * Backfill linked track groups using only high-confidence matches.
 *
 * Safety strategy: auto-link ONLY tracks that resolve to the exact same
 * non-unknown YouTube video ID. This keeps false positives low and avoids
 * uncertain title/artist-based silent merges.
 */
const BACKFILL_TRACK_GROUPS = `
WITH duplicate_video_sets AS (
  SELECT
    tv.video_id,
    ARRAY_AGG(DISTINCT tv.track_id ORDER BY tv.track_id) AS track_ids
  FROM track_variants tv
  WHERE tv.video_id IS NOT NULL
    AND tv.video_id <> ''
    AND tv.video_id NOT LIKE 'unknown-%'
  GROUP BY tv.video_id
  HAVING COUNT(DISTINCT tv.track_id) > 1
),
to_create AS (
  SELECT
    gen_random_uuid() AS group_id,
    d.video_id,
    ARRAY(
      SELECT tid
      FROM unnest(d.track_ids) AS tid
      WHERE NOT EXISTS (
        SELECT 1 FROM track_group_members gm WHERE gm.track_id = tid
      )
    ) AS free_track_ids
  FROM duplicate_video_sets d
),
inserted_groups AS (
  INSERT INTO track_groups (id, name, canonical_track_id, created_at, updated_at)
  SELECT
    tc.group_id,
    'Auto-linked duplicate video: ' || tc.video_id,
    tc.free_track_ids[1],
    now(),
    now()
  FROM to_create tc
  WHERE cardinality(tc.free_track_ids) > 1
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO track_group_members (track_group_id, track_id, position, linked_at)
SELECT
  tc.group_id,
  m.track_id,
  m.ordinality - 1,
  now()
FROM to_create tc
JOIN inserted_groups ig ON ig.id = tc.group_id
CROSS JOIN LATERAL unnest(tc.free_track_ids) WITH ORDINALITY AS m(track_id, ordinality)
ON CONFLICT (track_id) DO NOTHING;
`;

/**
 * Run the full idempotent schema DDL.
 * Returns true if successful, false if something went wrong.
 */
export async function ensureSchema(): Promise<boolean> {
  const pool = getPool();
  try {
    await pool.query(SCHEMA_DDL);
    // Backfill variants for existing tracks
    await pool.query(BACKFILL_VARIANTS);
    // Backfill conservative high-confidence link groups
    await pool.query(BACKFILL_TRACK_GROUPS);
    return true;
  } catch (err) {
    console.error('[migrate] Schema migration failed:', err);
    return false;
  }
}

/**
 * Quick validation: verify the critical 'tracks' table exists and has
 * the enrichment_status column the scheduler needs.
 */
export async function validateSchema(): Promise<boolean> {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tracks' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    const columns = result.rows.map((r: any) => r.column_name);

    const required = [
      'id', 'youtube_url', 'title', 'artist',
      'enrichment_status', 'enrichment_attempts',
      'audio_status', 'verified',
    ];

    const missing = required.filter(c => !columns.includes(c));
    if (missing.length > 0) {
      console.error(`[migrate] Schema validation failed — missing columns: ${missing.join(', ')}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[migrate] Schema validation error:', err);
    return false;
  }
}
