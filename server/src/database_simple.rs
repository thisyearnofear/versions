use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use anyhow::{Result, Context};
use uuid::Uuid;

/// ENHANCEMENT FIRST: Simple database using existing rusqlite
/// CLEAN: Single responsibility - only database concerns
#[derive(Debug, Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// CLEAN: Initialize database with migrations
    pub async fn new(database_path: &str) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = Path::new(database_path).parent() {
            tokio::fs::create_dir_all(parent).await
                .context("Failed to create database directory")?;
        }

        // Create connection
        let conn = Connection::open(database_path)
            .context("Failed to open database")?;
        
        let db = Self { 
            conn: Arc::new(Mutex::new(conn)) 
        };
        
        // ORGANIZED: Run migrations on startup
        db.run_migrations().await?;
        
        Ok(db)
    }

    /// ORGANIZED: Apply database migrations
    async fn run_migrations(&self) -> Result<()> {
        let migration_sql = include_str!("../migrations/001_initial_schema.sql");
        
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(migration_sql)
            .context("Failed to run database migrations")?;
        
        log::info!("Database migrations completed successfully");
        Ok(())
    }
    
    /// ORGANIZED: Seed database with example data for development
    pub async fn seed_example_data(&self) -> Result<()> {
        log::info!("Seeding database with example data...");

        let conn = self.conn.lock().unwrap();

        // Check if data already exists
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))?;
        if count > 0 {
            log::info!("Database already contains data, skipping seed");
            return Ok(());
        }

        // Create example songs and versions
        let songs_data = vec![
            ("Bohemian Rhapsody", "Queen", vec![
                ("Studio Version", 2, 1000, 4.8, 50),
                ("Live at Wembley", 3, 750, 4.9, 42),
                ("Demo Version", 1, 234, 4.6, 18),
            ]),
            ("Imagine", "John Lennon", vec![
                ("Original 1971", 2, 856, 4.7, 38),
                ("Live in New York", 3, 445, 4.5, 25),
            ]),
            ("Yesterday", "The Beatles", vec![
                ("Home Recording", 1, 634, 4.8, 31),
                ("Studio Version", 2, 1234, 4.9, 67),
                ("Acoustic Version", 6, 389, 4.7, 22),
            ]),
            ("Stairway to Heaven", "Led Zeppelin", vec![
                ("Studio Version", 2, 2156, 4.9, 89),
                ("Live at Madison Square Garden", 3, 987, 4.8, 45),
                ("Remastered 2014", 5, 567, 4.6, 28),
            ]),
        ];

        let songs_count = songs_data.len();
        
        for (song_title, artist, versions) in songs_data {
            let song_id = Uuid::new_v4().to_string();

            // Create song
            conn.execute(
                "INSERT INTO songs (id, canonical_title, original_artist) VALUES (?1, ?2, ?3)",
                params![song_id, song_title, artist],
            )?;

            // Create versions
            for (version_title, version_type_id, play_count, vote_score, vote_count) in versions {
                let version_id = Uuid::new_v4().to_string();

                conn.execute(
                    "INSERT INTO versions (id, song_id, version_type_id, title, artist, upload_date, play_count, vote_score, vote_count) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), ?6, ?7, ?8)",
                    params![version_id, song_id, version_type_id, version_title, artist, play_count, vote_score, vote_count],
                )?;
            }
        }

        log::info!("Example data seeded successfully with {} songs", songs_count);
        Ok(())
    }

    /// MODULAR: Migrate existing data to ensure consistency
    pub async fn migrate_existing_data(&self) -> Result<()> {
        log::info!("Starting database migration...");

        let conn = self.conn.lock().unwrap();

        // Add missing columns if they don't exist (for future migrations)
        let mut needs_migration = false;

        // Check if we need to add any missing indexes
        let index_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_versions_format'",
            [],
            |row| row.get(0)
        ).unwrap_or(0);

        if index_count == 0 {
            // Add index for format-based queries
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_versions_format ON versions(format)",
                [],
            )?;
            needs_migration = true;
        }

        // Update any versions without format information
        let updated_count = conn.execute(
            "UPDATE versions SET format = 'mp3' WHERE format IS NULL OR format = ''",
            [],
        )?;

        if updated_count > 0 {
            log::info!("Updated {} versions with default format", updated_count);
            needs_migration = true;
        }

        // Clean up any data inconsistencies
        self.cleanup_orphaned_data().await?;

        if needs_migration {
            log::info!("Database migration completed successfully");
        } else {
            log::info!("Database is already up to date");
        }

        Ok(())
    }

    /// CLEAN: Get database statistics
    pub async fn get_database_stats(&self) -> Result<DatabaseStats> {
        let conn = self.conn.lock().unwrap();

        let song_count: i64 = conn.query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))?;
        let version_count: i64 = conn.query_row("SELECT COUNT(*) FROM versions", [], |row| row.get(0))?;
        let total_play_count: i64 = conn.query_row("SELECT COALESCE(SUM(play_count), 0) FROM versions", [], |row| row.get(0))?;
        let avg_vote_score: f64 = conn.query_row("SELECT COALESCE(AVG(vote_score), 0.0) FROM versions", [], |row| row.get(0))?;

        Ok(DatabaseStats {
            song_count: song_count as u32,
            version_count: version_count as u32,
            total_play_count: total_play_count as u64,
            average_vote_score: avg_vote_score,
        })
    }

    /// MODULAR: Clean up orphaned data
    pub async fn cleanup_orphaned_data(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Remove versions without corresponding songs
        let deleted_versions = conn.execute(
            "DELETE FROM versions WHERE song_id NOT IN (SELECT id FROM songs)",
            [],
        )?;

        // Remove songs without any versions
        let deleted_songs = conn.execute(
            "DELETE FROM songs WHERE id NOT IN (SELECT DISTINCT song_id FROM versions)",
            [],
        )?;

        if deleted_versions > 0 || deleted_songs > 0 {
            log::info!("Cleaned up {} orphaned versions and {} empty songs", deleted_versions, deleted_songs);
        }

        Ok(())
    }
}

/// CLEAN: Database statistics structure
#[derive(Debug, Serialize)]
pub struct DatabaseStats {
    pub song_count: u32,
    pub version_count: u32,
    pub total_play_count: u64,
    pub average_vote_score: f64,
}

/// ENHANCEMENT FIRST: Simplified data structures for API conversion
#[derive(Debug, serde::Serialize)]
pub struct SimpleDbSong {
    pub id: String,
    pub canonical_title: String,
    pub total_versions: i32,
    pub total_play_count: i32,
    pub average_vote_score: f64,
}

#[derive(Debug)]
pub struct SimpleDbVersion {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub version_type: String,
    pub duration_seconds: Option<i32>,
    pub file_size: Option<i64>,
    pub upload_date: String,
    pub play_count: i32,
    pub vote_score: f64,
    pub format: String,
}

/// MODULAR: Database operations 
impl Database {
    /// Get song with versions - simplified version
    pub async fn get_song_with_versions(&self, song_id: &str) -> Result<Option<(SimpleDbSong, Vec<SimpleDbVersion>)>> {
        let conn = self.conn.lock().unwrap();
        
        // Get song
        let mut song_stmt = conn.prepare(
            "SELECT id, canonical_title, total_versions, total_play_count, average_vote_score 
             FROM songs WHERE id = ?"
        )?;
        
        let song_result = song_stmt.query_row(params![song_id], |row| {
            Ok(SimpleDbSong {
                id: row.get(0)?,
                canonical_title: row.get(1)?,
                total_versions: row.get(2)?,
                total_play_count: row.get(3)?,
                average_vote_score: row.get(4)?,
            })
        });
        
        let song = match song_result {
            Ok(s) => s,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        
        // Get versions
        let mut version_stmt = conn.prepare(
            "SELECT v.id, v.title, v.artist, vt.name, v.duration_seconds, v.file_size, 
             v.upload_date, v.play_count, v.vote_score, COALESCE(v.format, 'mp3')
             FROM versions v 
             JOIN version_types vt ON v.version_type_id = vt.id 
             WHERE v.song_id = ? 
             ORDER BY v.vote_score DESC"
        )?;
        
        let version_iter = version_stmt.query_map(params![song_id], |row| {
            Ok(SimpleDbVersion {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                version_type: row.get(3)?,
                duration_seconds: row.get(4)?,
                file_size: row.get(5)?,
                upload_date: row.get::<_, String>(6)?,
                play_count: row.get(7)?,
                vote_score: row.get(8)?,
                format: row.get::<_, String>(9)?,
            })
        })?;
        
        let versions: Result<Vec<_>, _> = version_iter.collect();
        let versions = versions?;
        
        Ok(Some((song, versions)))
    }
    
    /// List songs - simplified version
    pub async fn list_songs(&self, limit: Option<u32>, offset: Option<u32>) -> Result<Vec<SimpleDbSong>> {
        let limit = limit.unwrap_or(50).min(200);
        let offset = offset.unwrap_or(0);
        
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, canonical_title, total_versions, total_play_count, average_vote_score 
             FROM songs 
             ORDER BY average_vote_score DESC, total_play_count DESC
             LIMIT ? OFFSET ?"
        )?;
        
        let song_iter = stmt.query_map(params![limit, offset], |row| {
            Ok(SimpleDbSong {
                id: row.get(0)?,
                canonical_title: row.get(1)?,
                total_versions: row.get(2)?,
                total_play_count: row.get(3)?,
                average_vote_score: row.get(4)?,
            })
        })?;
        
        let songs: Result<Vec<_>, _> = song_iter.collect();
        songs.map_err(Into::into)
    }
    
    /// MODULAR: Create a new song
    pub async fn create_song(&self, song_id: &str, title: &str, artist: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT INTO songs (id, canonical_title, original_artist, total_versions, total_play_count, average_vote_score) VALUES (?1, ?2, ?3, 0, 0, 0.0)",
            params![song_id, title, artist],
        )?;
        
        log::info!("Created song: {} with ID: {}", title, song_id);
        Ok(())
    }
    
    /// MODULAR: Create a new version
    pub async fn create_version(
        &self,
        version_id: &str,
        song_id: &str,
        version_type_id: i32,
        title: &str,
        artist: Option<&str>,
        file_path: Option<&str>,
        file_size: i32,
        duration_seconds: Option<i32>,
        format: &str,
        sample_rate: Option<i32>,
        channels: Option<i32>,
        bitrate: Option<i32>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT INTO versions (id, song_id, version_type_id, title, artist, file_path, file_size, duration_seconds, format, sample_rate, channels, bitrate, upload_date, play_count, vote_score, vote_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'), 0, 0.0, 0)",
            params![
                version_id, 
                song_id, 
                version_type_id, 
                title, 
                artist, 
                file_path, 
                file_size, 
                duration_seconds, 
                format, 
                sample_rate, 
                channels, 
                bitrate
            ],
        )?;
        
        // PERFORMANT: Update song statistics
        conn.execute(
            "UPDATE songs SET total_versions = total_versions + 1 WHERE id = ?1",
            params![song_id],
        )?;
        
        log::info!("Created version: {} for song: {}", title, song_id);
        Ok(())
    }

    /// MODULAR: Get version data for comparison
    pub async fn get_version_data(&self, version_id: &str) -> Result<Option<SimpleDbVersion>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT v.id, v.title, v.artist, vt.name, v.duration_seconds, v.file_size,
             v.upload_date, v.play_count, v.vote_score, v.format
             FROM versions v
             JOIN version_types vt ON v.version_type_id = vt.id
             WHERE v.id = ?"
        )?;

        let result = stmt.query_row(params![version_id], |row| {
            Ok(SimpleDbVersion {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                version_type: row.get(3)?,
                duration_seconds: row.get(4)?,
                file_size: row.get(5)?,
                upload_date: row.get::<_, String>(6)?,
                play_count: row.get(7)?,
                vote_score: row.get(8)?,
                format: row.get(9)?,
            })
        });

        match result {
            Ok(version) => Ok(Some(version)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// MODULAR: Get comparison metadata (placeholder for session management)
    pub async fn get_comparison_metadata(&self, _session_id: &str) -> Result<ComparisonMetadata> {
        // This is a placeholder - in a real implementation, this would:
        // 1. Look up the comparison session
        // 2. Get version data for all versions in the session
        // 3. Generate waveform data if available
        // 4. Return structured comparison metadata

        // For now, return empty metadata structure
        Ok(ComparisonMetadata {
            session_id: _session_id.to_string(),
            versions: Vec::new(),
        })
    }

    /// MODULAR: Validate comparison session (placeholder)
    pub async fn validate_comparison_session(&self, _session_id: &str, _version_id: &str) -> Result<bool> {
        // This is a placeholder - in a real implementation, this would:
        // 1. Check if the session exists
        // 2. Verify the version is part of the session
        // 3. Check session expiration
        // 4. Return validation result

        // For now, just check if the version exists
        Ok(self.get_version_data(_version_id).await?.is_some())
    }

    /// MODULAR: Full-text search across songs and versions
    pub async fn search_songs_and_versions(&self, query: &str, limit: Option<u32>, offset: Option<u32>) -> Result<Vec<SimpleDbSong>> {
        let limit = limit.unwrap_or(50).min(200);
        let offset = offset.unwrap_or(0);
        let search_term = format!("%{}%", query.to_lowercase());

        let conn = self.conn.lock().unwrap();

        // Search in songs table
        let mut song_stmt = conn.prepare(
            "SELECT id, canonical_title, total_versions, total_play_count, average_vote_score
             FROM songs
             WHERE LOWER(canonical_title) LIKE ?1 OR LOWER(original_artist) LIKE ?1
             ORDER BY
                 (CASE WHEN LOWER(canonical_title) LIKE ?1 THEN 1
                       WHEN LOWER(original_artist) LIKE ?1 THEN 2
                       ELSE 3 END),
                 average_vote_score DESC, total_play_count DESC
             LIMIT ?2 OFFSET ?3"
        )?;

        let song_iter = song_stmt.query_map(params![search_term, limit, offset], |row| {
            Ok(SimpleDbSong {
                id: row.get(0)?,
                canonical_title: row.get(1)?,
                total_versions: row.get(2)?,
                total_play_count: row.get(3)?,
                average_vote_score: row.get(4)?,
            })
        })?;

        let mut results: Vec<SimpleDbSong> = song_iter.collect::<Result<Vec<_>, _>>()?;

        // If we have fewer results than requested, also search in versions
        if results.len() < limit as usize {
            let remaining_limit = limit as usize - results.len();
            let mut version_stmt = conn.prepare(
                "SELECT DISTINCT s.id, s.canonical_title, s.total_versions, s.total_play_count, s.average_vote_score
                 FROM songs s
                 JOIN versions v ON s.id = v.song_id
                 JOIN version_types vt ON v.version_type_id = vt.id
                 WHERE (LOWER(v.title) LIKE ?1 OR LOWER(v.artist) LIKE ?1 OR LOWER(vt.name) LIKE ?1)
                 AND s.id NOT IN (SELECT id FROM songs WHERE LOWER(canonical_title) LIKE ?1 OR LOWER(original_artist) LIKE ?1)
                 ORDER BY s.average_vote_score DESC, s.total_play_count DESC
                 LIMIT ?2"
            )?;

            let version_iter = version_stmt.query_map(params![search_term, remaining_limit as u32], |row| {
                Ok(SimpleDbSong {
                    id: row.get(0)?,
                    canonical_title: row.get(1)?,
                    total_versions: row.get(2)?,
                    total_play_count: row.get(3)?,
                    average_vote_score: row.get(4)?,
                })
            })?;

            let mut version_results: Vec<SimpleDbSong> = version_iter.collect::<Result<Vec<_>, _>>()?;

            // Remove duplicates and merge results
            for version_song in version_results {
                if !results.iter().any(|s| s.id == version_song.id) {
                    results.push(version_song);
                }
            }
        }

        // Sort final results by relevance and score
        results.sort_by(|a, b| {
            b.average_vote_score.partial_cmp(&a.average_vote_score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.total_play_count.cmp(&a.total_play_count))
        });

        // Apply offset and limit to final results
        let start_idx = offset as usize;
        let end_idx = (offset + limit) as usize;
        results = results.into_iter().skip(start_idx).take(limit as usize).collect();

        log::info!("Search for '{}' returned {} results", query, results.len());
        Ok(results)
    }
}

/// CLEAN: Comparison metadata structures for database operations
#[derive(Debug, serde::Serialize)]
pub struct ComparisonMetadata {
    pub session_id: String,
    pub versions: Vec<ComparisonVersionInfo>,
}

#[derive(Debug, serde::Serialize)]
pub struct ComparisonVersionInfo {
    pub version_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub version_type: String,
    pub duration_seconds: Option<u64>,
    pub file_size: Option<u64>,
    pub format: String,
    pub waveform_data: Option<Vec<f32>>,
}
