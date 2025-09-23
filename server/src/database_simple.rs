use rusqlite::{Connection, params, Row};
use std::path::Path;
use anyhow::{Result, Context};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::sync::{Arc, Mutex};

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
        
        let song_id = Uuid::new_v4().to_string();
        
        {
            let conn = self.conn.lock().unwrap();
            
            // Create example song
            conn.execute(
                "INSERT INTO songs (id, canonical_title, original_artist) VALUES (?1, ?2, ?3)",
                params![song_id, "Bohemian Rhapsody", "Queen"],
            )?;
            
            // Create example versions
            let version1_id = Uuid::new_v4().to_string();
            let version2_id = Uuid::new_v4().to_string();
            
            conn.execute(
                "INSERT INTO versions (id, song_id, version_type_id, title, artist) VALUES (?1, ?2, 2, ?3, ?4)",
                params![version1_id, song_id, "Bohemian Rhapsody (Studio Version)", "Queen"],
            )?;
            
            conn.execute(
                "INSERT INTO versions (id, song_id, version_type_id, title, artist) VALUES (?1, ?2, 3, ?3, ?4)",
                params![version2_id, song_id, "Bohemian Rhapsody (Live at Wembley)", "Queen"],
            )?;
            
            // Update stats
            conn.execute(
                "UPDATE versions SET play_count = 1000, vote_score = 4.8, vote_count = 50 WHERE id = ?1",
                params![version1_id],
            )?;
            
            conn.execute(
                "UPDATE versions SET play_count = 750, vote_score = 4.9, vote_count = 42 WHERE id = ?1",
                params![version2_id],
            )?;
        }
        
        log::info!("Example data seeded successfully");
        Ok(())
    }
}

/// ENHANCEMENT FIRST: Simplified data structures for API conversion
#[derive(Debug)]
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
             v.upload_date, v.play_count, v.vote_score
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
}