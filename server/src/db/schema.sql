-- Nightwave Database Schema
-- PostgreSQL migration for v0.1.0
-- Run with: psql $DATABASE_URL -f schema.sql

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tracks table
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

-- Playlists table
CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Playlist-Track join table (ordered)
CREATE TABLE IF NOT EXISTS playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, track_id)
);

-- Favorites table
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  liked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (track_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_favorites_track ON favorites(track_id);
CREATE INDEX IF NOT EXISTS idx_favorites_liked ON favorites(liked_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
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
