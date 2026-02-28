-- Migration v5: Linkable entities + Shared play sessions
-- Run with: psql $DATABASE_URL -f migrate-v5-linkable-sessions.sql
-- Idempotent: safe to re-run
-- Depends on: migrate-v4-persistence.sql

-- ============================================================
-- 1. Artists table (first-class entity)
-- ============================================================
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

-- ============================================================
-- 2. Albums table (first-class entity)
-- ============================================================
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

-- ============================================================
-- 3. Slugs on existing tables
-- ============================================================

-- Tracks: add slug + FK refs to artist/album entities
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artist_id UUID REFERENCES artists(id) ON DELETE SET NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album_id UUID REFERENCES albums(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracks_slug ON tracks(slug);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);

-- Playlists: add slug
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_playlists_slug ON playlists(slug);

-- ============================================================
-- 4. Play Sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS play_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,          -- shareable link token (UUID string)
  name TEXT NOT NULL DEFAULT 'Listening Session',
  owner_id UUID NOT NULL REFERENCES users(id),
  playlist_id UUID REFERENCES playlists(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ                  -- when session was ended (null = still active)
);

CREATE INDEX IF NOT EXISTS idx_play_sessions_token ON play_sessions(token);
CREATE INDEX IF NOT EXISTS idx_play_sessions_owner ON play_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_play_sessions_active ON play_sessions(is_active) WHERE is_active = true;

-- ============================================================
-- 5. Session Members
-- ============================================================

CREATE TABLE IF NOT EXISTS session_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,                  -- null = still in session
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_members_session ON session_members(session_id);
CREATE INDEX IF NOT EXISTS idx_session_members_user ON session_members(user_id);

-- ============================================================
-- 6. Session State (mutable, single row per session)
-- ============================================================

CREATE TABLE IF NOT EXISTS session_state (
  session_id UUID PRIMARY KEY REFERENCES play_sessions(id) ON DELETE CASCADE,
  current_track_id UUID REFERENCES tracks(id) ON DELETE SET NULL,
  is_playing BOOLEAN NOT NULL DEFAULT false,
  position_sec REAL NOT NULL DEFAULT 0,
  position_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- for drift calculation
  queue JSONB NOT NULL DEFAULT '[]'::jsonb,                -- ordered list of track IDs
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. Session Events (append-only log for sync history)
-- ============================================================

CREATE TABLE IF NOT EXISTS session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,            -- play, pause, seek, next, prev, set_track, join, leave, queue_update
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_created ON session_events(session_id, created_at DESC);

-- ============================================================
-- 8. Updated_at triggers for new tables
-- ============================================================

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
