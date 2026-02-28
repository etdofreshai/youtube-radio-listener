-- Migration: Expand volume range to 0-200, default 100
-- Backward compatible: existing tracks keep their current volume values
-- Run with: psql $DATABASE_URL -f migrate-volume-200.sql

-- Drop old constraint and add new one
ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_volume_check;
ALTER TABLE tracks ADD CONSTRAINT tracks_volume_check CHECK (volume >= 0 AND volume <= 200);

-- Update default for new tracks
ALTER TABLE tracks ALTER COLUMN volume SET DEFAULT 100;
