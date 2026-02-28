-- Migration v4: Full persistence — users, events, audio fields, unified schema
-- Run with: psql $DATABASE_URL -f migrate-v4-persistence.sql
-- Idempotent: safe to re-run
-- Depends on: schema.sql, migrate-v2, migrate-v3, migrate-volume-200

-- ============================================================
-- 0. Ensure base tables + extensions exist (from prior migrations)
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
  role TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default local user (for pre-auth usage)
INSERT INTO users (id, username, display_name, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'local', 'Local User', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- 2. Ensure tracks table has all columns
-- ============================================================

-- Base schema columns
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

-- Audio pipeline fields
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_error TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_filename TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS last_download_at TIMESTAMPTZ;

-- Verification fields (from v2)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- YouTube metadata (from v2)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_channel TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_channel_id TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_upload_date DATE;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_description TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_thumbnail_url TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_view_count BIGINT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_like_count BIGINT;

-- Music metadata (from v2)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS release_year INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS isrc TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS bpm REAL;

-- Provenance (from v2)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS metadata_source TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS metadata_confidence TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

-- Enrichment pipeline (from v3)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_error TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS next_enrich_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stage_a_completed_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stage_b_completed_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS field_confidences JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Artwork + links (from v3)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_url TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_source TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS alternate_links JSONB;

-- ============================================================
-- 3. Playlists + playlist_tracks (ensure from base schema)
-- ============================================================
CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add created_by to playlists
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by UUID REFERENCES users(id),
  UNIQUE (playlist_id, track_id)
);

-- ============================================================
-- 4. Favorites
-- ============================================================
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  liked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (track_id)
);

-- Add user_id column if not present
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- ============================================================
-- 5. Events (append-only audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  entity_type TEXT,           -- 'track' | 'playlist' | 'favorite' | null
  entity_id UUID,             -- ID of the affected entity
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_created ON events(user_id, created_at DESC);

-- ============================================================
-- 6. Indexes (ensure all exist)
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

-- Full-text search index on tracks
CREATE INDEX IF NOT EXISTS idx_tracks_search ON tracks USING gin(
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(artist, '') || ' ' || coalesce(album, '') || ' ' || coalesce(genre, ''))
);

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
