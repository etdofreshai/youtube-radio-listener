-- Migration v3: Enrichment pipeline + extended metadata
-- Run with: psql $DATABASE_URL -f migrate-v3-enrichment-pipeline.sql
-- Idempotent: safe to re-run
-- Depends on: migrate-v2-verification-metadata.sql

-- ============================================================
-- 1. Enrichment pipeline tracking
-- ============================================================

-- enrichment_status: 'none' | 'queued' | 'stage_a' | 'stage_a_done' | 'stage_b' | 'complete' | 'error'
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS enrichment_error TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS next_enrich_at TIMESTAMPTZ;     -- backoff: don't retry before this
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stage_a_completed_at TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stage_b_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tracks_enrichment_status ON tracks(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_tracks_next_enrich_at ON tracks(next_enrich_at) WHERE next_enrich_at IS NOT NULL;

-- ============================================================
-- 2. Per-field confidence (JSONB array)
-- ============================================================

-- Each element: { "field": "album", "confidence": "high", "source": "youtube", "updatedAt": "..." }
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS field_confidences JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- 3. Artwork
-- ============================================================

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_url TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artwork_source TEXT;   -- 'youtube-thumbnail' | 'musicbrainz' | 'discogs' | etc.

-- ============================================================
-- 4. Alternate links (JSONB object)
-- ============================================================

-- e.g. { "spotify": "https://...", "appleMusic": "https://...", "altYoutube": "https://..." }
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS alternate_links JSONB;

-- ============================================================
-- 5. Indexes for scheduler queries
-- ============================================================

-- Composite index for finding tracks needing enrichment
CREATE INDEX IF NOT EXISTS idx_tracks_needs_enrichment
  ON tracks(enrichment_status, metadata_confidence, next_enrich_at)
  WHERE enrichment_status IN ('none', 'stage_a_done', 'error', 'complete');
