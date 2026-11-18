CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  video_id VARCHAR(11) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('Bollywood', 'Hindi retro', 'Punjabi', 'English pop', '90s', 'regional', 'devotional')
  ),
  duration_sec INTEGER NOT NULL DEFAULT 240,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_songs_title_trgm ON songs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_songs_artist_trgm ON songs USING gin (artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_songs_category ON songs (category);

CREATE TABLE IF NOT EXISTS rooms (
  code CHAR(6) PRIMARY KEY,
  name TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  duet_mode BOOLEAN NOT NULL DEFAULT FALSE,
  auto_mute_on_stage BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
