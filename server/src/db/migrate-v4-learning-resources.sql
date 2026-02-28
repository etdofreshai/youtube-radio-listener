-- Migration: Learning Resources
-- Adds support for saved learning resources (tabs, chords, sheets, tutorials) linked to tracks

-- Extension for UUID generation (if not exists)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Learning resources table
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_learning_resources_track ON track_learning_resources(track_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_saved ON track_learning_resources(track_id, is_saved) WHERE is_saved = true;
CREATE INDEX IF NOT EXISTS idx_learning_resources_type ON track_learning_resources(track_id, resource_type);

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_learning_resources_updated_at ON track_learning_resources;
CREATE TRIGGER update_learning_resources_updated_at
  BEFORE UPDATE ON track_learning_resources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE track_learning_resources IS 'Cached and saved learning resources for tracks (tabs, chords, sheets, tutorials)';
COMMENT ON COLUMN track_learning_resources.resource_type IS 'Type of learning resource: guitar-tabs, guitar-chords, piano-keys, sheet-music, tutorial';
COMMENT ON COLUMN track_learning_resources.is_saved IS 'True if user explicitly saved/bookmarked this resource';
COMMENT ON COLUMN track_learning_resources.confidence IS 'Relevance confidence from search ranking';
