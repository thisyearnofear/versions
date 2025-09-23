-- VERSIONS Database Schema
-- DRY: Single source of truth for version-centric music data
-- CLEAN: Clear separation between songs and their versions
-- ORGANIZED: Version types as enum for consistency

-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Songs table: Canonical titles and metadata
CREATE TABLE songs (
    id TEXT PRIMARY KEY,  -- UUID as string for simplicity
    canonical_title TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Metadata
    original_artist TEXT,
    original_release_year INTEGER,
    genre TEXT,
    -- Stats (aggregated from versions)
    total_versions INTEGER DEFAULT 0,
    total_play_count INTEGER DEFAULT 0,
    average_vote_score REAL DEFAULT 0.0
);

-- Version types enum (DRY principle)
CREATE TABLE version_types (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    color_code TEXT  -- For UI theming
);

-- Insert standard version types
INSERT INTO version_types (name, description, color_code) VALUES
    ('demo', 'Early recordings and rough cuts', '#f6c744'),
    ('studio', 'Official album releases', '#00d4ff'),
    ('live', 'Concert performances', '#00ff88'),
    ('remix', 'Alternative arrangements', '#64dbed'),
    ('remaster', 'Updated audio quality', '#ff5555'),
    ('acoustic', 'Stripped-down versions', '#b8c5d6');

-- Versions table: Individual recordings of songs
CREATE TABLE versions (
    id TEXT PRIMARY KEY,  -- UUID as string
    song_id TEXT NOT NULL,
    version_type_id INTEGER NOT NULL,
    
    -- Core metadata
    title TEXT NOT NULL,
    artist TEXT,
    
    -- Audio file information
    file_path TEXT,
    file_size INTEGER,
    duration_seconds INTEGER,
    format TEXT,  -- mp3, flac, wav, etc.
    
    -- Technical metadata
    sample_rate INTEGER,
    channels INTEGER,
    bitrate INTEGER,
    
    -- Timestamps
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Stats
    play_count INTEGER DEFAULT 0,
    vote_score REAL DEFAULT 0.0,
    vote_count INTEGER DEFAULT 0,
    
    -- Social features
    uploader_fid INTEGER,  -- Farcaster ID of uploader
    is_verified BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (version_type_id) REFERENCES version_types(id)
);

-- Indexes for performance (PERFORMANT principle)
CREATE INDEX idx_versions_song_id ON versions(song_id);
CREATE INDEX idx_versions_type ON versions(version_type_id);
CREATE INDEX idx_versions_play_count ON versions(play_count DESC);
CREATE INDEX idx_versions_vote_score ON versions(vote_score DESC);
CREATE INDEX idx_versions_upload_date ON versions(upload_date DESC);
CREATE INDEX idx_songs_canonical_title ON songs(canonical_title);

-- Triggers to maintain aggregate data (DRY principle)
-- Update song stats when version stats change
CREATE TRIGGER update_song_stats_on_version_insert
    AFTER INSERT ON versions
BEGIN
    UPDATE songs 
    SET 
        total_versions = (SELECT COUNT(*) FROM versions WHERE song_id = NEW.song_id),
        total_play_count = (SELECT COALESCE(SUM(play_count), 0) FROM versions WHERE song_id = NEW.song_id),
        average_vote_score = (SELECT COALESCE(AVG(vote_score), 0.0) FROM versions WHERE song_id = NEW.song_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.song_id;
END;

CREATE TRIGGER update_song_stats_on_version_update
    AFTER UPDATE ON versions
BEGIN
    UPDATE songs 
    SET 
        total_versions = (SELECT COUNT(*) FROM versions WHERE song_id = NEW.song_id),
        total_play_count = (SELECT COALESCE(SUM(play_count), 0) FROM versions WHERE song_id = NEW.song_id),
        average_vote_score = (SELECT COALESCE(AVG(vote_score), 0.0) FROM versions WHERE song_id = NEW.song_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.song_id;
END;

CREATE TRIGGER update_song_stats_on_version_delete
    AFTER DELETE ON versions
BEGIN
    UPDATE songs 
    SET 
        total_versions = (SELECT COUNT(*) FROM versions WHERE song_id = OLD.song_id),
        total_play_count = (SELECT COALESCE(SUM(play_count), 0) FROM versions WHERE song_id = OLD.song_id),
        average_vote_score = (SELECT COALESCE(AVG(vote_score), 0.0) FROM versions WHERE song_id = OLD.song_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.song_id;
END;

-- Update timestamps automatically
CREATE TRIGGER update_songs_timestamp
    BEFORE UPDATE ON songs
BEGIN
    UPDATE songs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER update_versions_timestamp
    BEFORE UPDATE ON versions
BEGIN
    UPDATE versions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;