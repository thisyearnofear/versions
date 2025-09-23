use rusqlite::{Connection, params, Row};
use std::path::Path;
use anyhow::{Result, Context};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::sync::{Arc, Mutex};

/// MODULAR: Database connection and operations  
/// CLEAN: Single responsibility - only database concerns
/// ENHANCEMENT FIRST: Uses existing rusqlite instead of adding sqlx dependency
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

        // PERFORMANT: Connection pool for async operations
        let pool = SqlitePool::connect(&format!("sqlite:{}", database_path)).await
            .context("Failed to connect to database")?;

        let db = Self { pool };
        
        // ORGANIZED: Run migrations on startup
        db.run_migrations().await?;
        
        Ok(db)
    }

    /// ORGANIZED: Apply database migrations
    async fn run_migrations(&self) -> Result<()> {
        // Read and execute migration SQL
        let migration_sql = include_str!("../migrations/001_initial_schema.sql");
        
        sqlx::query(migration_sql)
            .execute(&self.pool)
            .await
            .context("Failed to run database migrations")?;
        
        log::info!("Database migrations completed successfully");
        Ok(())
    }

    /// CLEAN: Get database connection pool
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

/// ENHANCEMENT FIRST: Database models that extend existing API structs
/// These mirror the existing API structures for seamless integration

#[derive(Debug, sqlx::FromRow)]
pub struct DbSong {
    pub id: String,
    pub canonical_title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub original_artist: Option<String>,
    pub original_release_year: Option<i32>,
    pub genre: Option<String>,
    pub total_versions: i32,
    pub total_play_count: i32,
    pub average_vote_score: f64,
}

#[derive(Debug, sqlx::FromRow)]
pub struct DbVersion {
    pub id: String,
    pub song_id: String,
    pub version_type_id: i32,
    pub title: String,
    pub artist: Option<String>,
    pub file_path: Option<String>,
    pub file_size: Option<i64>,
    pub duration_seconds: Option<i32>,
    pub format: Option<String>,
    pub sample_rate: Option<i32>,
    pub channels: Option<i32>,
    pub bitrate: Option<i32>,
    pub upload_date: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub play_count: i32,
    pub vote_score: f64,
    pub vote_count: i32,
    pub uploader_fid: Option<i32>,
    pub is_verified: bool,
    pub is_featured: bool,
}

#[derive(Debug, sqlx::FromRow)]
pub struct DbVersionType {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub color_code: Option<String>,
}

/// MODULAR: Database operations for songs
impl Database {
    /// DRY: Single source for song creation
    pub async fn create_song(&self, canonical_title: &str, original_artist: Option<&str>) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        
        sqlx::query!(
            "INSERT INTO songs (id, canonical_title, original_artist) VALUES (?1, ?2, ?3)",
            id,
            canonical_title,
            original_artist
        )
        .execute(&self.pool)
        .await
        .context("Failed to create song")?;

        log::info!("Created song: {} ({})", canonical_title, id);
        Ok(id)
    }

    /// PERFORMANT: Get song with all versions in single query
    pub async fn get_song_with_versions(&self, song_id: &str) -> Result<Option<(DbSong, Vec<(DbVersion, DbVersionType)>)>> {
        // Get song details
        let song = sqlx::query_as!(
            DbSong,
            "SELECT id, canonical_title, created_at, updated_at, original_artist, 
             original_release_year, genre, total_versions, total_play_count, average_vote_score 
             FROM songs WHERE id = ?",
            song_id
        )
        .fetch_optional(&self.pool)
        .await
        .context("Failed to fetch song")?;

        let Some(song) = song else {
            return Ok(None);
        };

        // Get versions with type information
        let versions = sqlx::query!(
            "SELECT v.id, v.song_id, v.version_type_id, v.title, v.artist, v.file_path,
             v.file_size, v.duration_seconds, v.format, v.sample_rate, v.channels, v.bitrate,
             v.upload_date, v.created_at, v.updated_at, v.play_count, v.vote_score, v.vote_count,
             v.uploader_fid, v.is_verified, v.is_featured,
             vt.name as type_name, vt.description as type_description, vt.color_code as type_color
             FROM versions v 
             JOIN version_types vt ON v.version_type_id = vt.id 
             WHERE v.song_id = ? 
             ORDER BY v.vote_score DESC, v.play_count DESC",
            song_id
        )
        .fetch_all(&self.pool)
        .await
        .context("Failed to fetch versions")?;

        let version_data: Vec<(DbVersion, DbVersionType)> = versions
            .into_iter()
            .map(|row| {
                let version = DbVersion {
                    id: row.id,
                    song_id: row.song_id,
                    version_type_id: row.version_type_id,
                    title: row.title,
                    artist: row.artist,
                    file_path: row.file_path,
                    file_size: row.file_size,
                    duration_seconds: row.duration_seconds,
                    format: row.format,
                    sample_rate: row.sample_rate,
                    channels: row.channels,
                    bitrate: row.bitrate,
                    upload_date: row.upload_date,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    play_count: row.play_count,
                    vote_score: row.vote_score,
                    vote_count: row.vote_count,
                    uploader_fid: row.uploader_fid,
                    is_verified: row.is_verified != 0,
                    is_featured: row.is_featured != 0,
                };
                
                let version_type = DbVersionType {
                    id: row.version_type_id,
                    name: row.type_name,
                    description: row.type_description,
                    color_code: row.type_color,
                };
                
                (version, version_type)
            })
            .collect();

        Ok(Some((song, version_data)))
    }

    /// PERFORMANT: List all songs with pagination
    pub async fn list_songs(&self, limit: Option<u32>, offset: Option<u32>) -> Result<Vec<DbSong>> {
        let limit = limit.unwrap_or(50).min(200) as i64; // PREVENT BLOAT: Reasonable limits
        let offset = offset.unwrap_or(0) as i64;

        let songs = sqlx::query_as!(
            DbSong,
            "SELECT id, canonical_title, created_at, updated_at, original_artist,
             original_release_year, genre, total_versions, total_play_count, average_vote_score 
             FROM songs 
             ORDER BY average_vote_score DESC, total_play_count DESC
             LIMIT ? OFFSET ?",
            limit,
            offset
        )
        .fetch_all(&self.pool)
        .await
        .context("Failed to list songs")?;

        Ok(songs)
    }

    /// DRY: Create version with automatic song stats update
    pub async fn create_version(
        &self,
        song_id: &str,
        version_type_name: &str,
        title: &str,
        artist: Option<&str>,
        file_path: Option<&str>,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();

        // Get version type ID
        let version_type = sqlx::query!(
            "SELECT id FROM version_types WHERE name = ?",
            version_type_name
        )
        .fetch_one(&self.pool)
        .await
        .context("Version type not found")?;

        sqlx::query!(
            "INSERT INTO versions (id, song_id, version_type_id, title, artist, file_path) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            id,
            song_id,
            version_type.id,
            title,
            artist,
            file_path
        )
        .execute(&self.pool)
        .await
        .context("Failed to create version")?;

        log::info!("Created version: {} for song {}", title, song_id);
        Ok(id)
    }

    /// PERFORMANT: Update play count efficiently
    pub async fn increment_play_count(&self, version_id: &str) -> Result<()> {
        sqlx::query!(
            "UPDATE versions SET play_count = play_count + 1 WHERE id = ?",
            version_id
        )
        .execute(&self.pool)
        .await
        .context("Failed to increment play count")?;

        Ok(())
    }

    /// CLEAN: Get version types for API responses
    pub async fn get_version_types(&self) -> Result<Vec<DbVersionType>> {
        let types = sqlx::query_as!(
            DbVersionType,
            "SELECT id, name, description, color_code FROM version_types ORDER BY name"
        )
        .fetch_all(&self.pool)
        .await
        .context("Failed to get version types")?;

        Ok(types)
    }
}

/// ORGANIZED: Database initialization and seeding
impl Database {
    /// ORGANIZED: Seed database with example data for development
    pub async fn seed_example_data(&self) -> Result<()> {
        log::info!("Seeding database with example data...");

        // Create example song
        let song_id = self.create_song("Bohemian Rhapsody", Some("Queen")).await?;

        // Create example versions
        let _version1 = self.create_version(
            &song_id,
            "studio",
            "Bohemian Rhapsody (Studio Version)",
            Some("Queen"),
            None,
        ).await?;

        let _version2 = self.create_version(
            &song_id,
            "live",
            "Bohemian Rhapsody (Live at Wembley)",
            Some("Queen"),
            None,
        ).await?;

        // Update some stats for demo
        sqlx::query!(
            "UPDATE versions SET play_count = 1000, vote_score = 4.8, vote_count = 50 
             WHERE song_id = ? AND title LIKE '%Studio%'",
            song_id
        )
        .execute(&self.pool)
        .await?;

        sqlx::query!(
            "UPDATE versions SET play_count = 750, vote_score = 4.9, vote_count = 42 
             WHERE song_id = ? AND title LIKE '%Live%'",
            song_id
        )
        .execute(&self.pool)
        .await?;

        log::info!("Example data seeded successfully");
        Ok(())
    }
}