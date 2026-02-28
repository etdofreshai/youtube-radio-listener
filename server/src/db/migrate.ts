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
`;

/**
 * Run the full idempotent schema DDL.
 * Returns true if successful, false if something went wrong.
 */
export async function ensureSchema(): Promise<boolean> {
  const pool = getPool();
  try {
    await pool.query(SCHEMA_DDL);
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
