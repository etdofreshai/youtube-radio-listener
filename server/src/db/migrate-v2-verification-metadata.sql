-- Migration v2: Verification workflow + Metadata enrichment fields
-- Run with: psql $DATABASE_URL -f migrate-v2-verification-metadata.sql
-- Idempotent: safe to re-run

-- ============================================================
-- 1. Verification fields
-- ============================================================
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified_by TEXT;          -- verifier identifier (username, email, or null)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;   -- when verification happened

CREATE INDEX IF NOT EXISTS idx_tracks_verified ON tracks(verified);

-- ============================================================
-- 2. Metadata enrichment fields
-- ============================================================

-- YouTube-sourced metadata
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_channel TEXT;           -- YouTube channel/uploader name
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_channel_id TEXT;        -- YouTube channel ID
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_upload_date DATE;       -- YouTube upload date
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_description TEXT;       -- YouTube video description
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_thumbnail_url TEXT;     -- YouTube thumbnail URL
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_view_count BIGINT;      -- YouTube view count at time of enrichment
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS yt_like_count BIGINT;      -- YouTube like count at time of enrichment

-- Music metadata (from YouTube or external providers)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS release_year INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS genre TEXT;                 -- comma-separated or primary genre
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS label TEXT;                 -- record label
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS isrc TEXT;                  -- International Standard Recording Code
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS bpm REAL;                   -- beats per minute

-- Provenance / confidence
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS metadata_source TEXT;       -- e.g. 'youtube', 'musicbrainz', 'manual'
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS metadata_confidence TEXT;   -- 'high', 'medium', 'low'
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
CREATE INDEX IF NOT EXISTS idx_tracks_release_year ON tracks(release_year);
CREATE INDEX IF NOT EXISTS idx_tracks_created_at_desc ON tracks(created_at DESC);
