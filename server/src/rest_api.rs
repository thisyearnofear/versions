use axum::{
    extract::{Path, Query, State, Multipart},
    http::{StatusCode, HeaderMap, header},
    response::{Json, Response},
    body::Body,
    routing::{get, post},
    Router,
};
use serde_json::json;
use crate::farcaster_service::{FarcasterService, FarcasterUser, SocialRecommendation};
use crate::audio_service::{AudioService, AudioMetadata};
use crate::filecoin_service::{FilecoinService, FilecoinUploadRequest, CreatorPaymentRequest};
use crate::database::{self as database, Database, SimpleDbSong, SimpleDbVersion};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use chrono;
use uuid::Uuid;
use anyhow;
// AGGRESSIVE CONSOLIDATION: Remove unused import
// use tower_http::cors::CorsLayer; // Not needed, using tower_http::cors::CorsLayer directly

/// Version information for API responses
#[derive(Debug, Serialize, Deserialize)]
pub struct VersionInfo {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub version_type: String,
    pub duration: Option<u64>,
    pub file_size: Option<u64>,
    pub upload_date: String,
    pub play_count: u64,
    pub vote_score: f64,
}

/// Song with multiple versions
#[derive(Debug, Serialize, Deserialize)]
pub struct Song {
    pub id: String,
    pub canonical_title: String,
    pub versions: Vec<VersionInfo>,
    pub total_versions: usize,
}

/// API response wrapper
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    #[allow(dead_code)] // Will be used when implementing error handling
    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}

/// Query parameters for listing songs
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub page: Option<u32>,
    pub limit: Option<u32>,
    pub search: Option<String>,
}

/// ENHANCEMENT FIRST: Add database conversion methods to existing structs
/// These methods extend the existing API structs without changing their surface
impl VersionInfo {
    /// Convert from simplified database models (ENHANCEMENT FIRST principle)
    pub fn from_simple_db(db_version: SimpleDbVersion) -> Self {
        Self {
            id: db_version.id,
            title: db_version.title,
            artist: db_version.artist.unwrap_or_else(|| "Unknown".to_string()),
            version_type: db_version.version_type,
            duration: db_version.duration_seconds.map(|d| d as u64),
            file_size: db_version.file_size.map(|s| s as u64),
            upload_date: db_version.upload_date,
            play_count: db_version.play_count as u64,
            vote_score: db_version.vote_score,
        }
    }
}

impl Song {
    /// Convert from simplified database models (ENHANCEMENT FIRST principle)
    pub fn from_simple_db(db_song: SimpleDbSong, versions_data: Vec<SimpleDbVersion>) -> Self {
        let versions = versions_data
            .into_iter()
            .map(VersionInfo::from_simple_db)
            .collect();
            
        Self {
            id: db_song.id,
            canonical_title: db_song.canonical_title,
            versions,
            total_versions: db_song.total_versions as usize,
        }
    }
}

/// Create the REST API router with database integration (ENHANCEMENT FIRST)
pub fn create_router(database: Database) -> Router {
    Router::new()
        .route("/api/v1/health", get(health_check))
        .route("/api/v1/songs", get(list_songs))
        .route("/api/v1/songs/:id", get(get_song))
        .route("/api/v1/versions/:id", get(get_version))
        .route("/api/v1/versions", post(upload_version))
        .route("/api/v1/search", get(search))
        // ENHANCEMENT: Add Farcaster endpoints to existing API
        .route("/api/v1/farcaster/profile/:fid", get(get_farcaster_profile))
        .route("/api/v1/farcaster/cast", post(create_farcaster_cast))
        .route("/api/v1/farcaster/recommendations", get(get_social_recommendations))
        .route("/api/v1/versions/:id/discussions", get(get_version_discussions))
        // Farcaster Mini App manifest at well-known path
        .route("/.well-known/farcaster.json", get(get_farcaster_manifest))
        // ENHANCEMENT: Add audio streaming endpoints
        .route("/api/v1/audio/files", get(list_audio_files))
        .route("/api/v1/audio/:file_id/metadata", get(get_audio_metadata))
        .route("/api/v1/audio/:file_id/stream", get(stream_audio))
        .route("/api/v1/audio/upload", post(upload_audio_file))
        // ENHANCEMENT: Add version comparison endpoints
        .route("/api/v1/compare/versions", post(compare_versions))
        .route("/api/v1/compare/:session_id/metadata", get(get_comparison_metadata))
        .route("/api/v1/compare/:session_id/stream/:version_id", get(stream_comparison_audio))
        // ENHANCEMENT: Add database management endpoints
        .route("/api/v1/database/stats", get(get_database_stats))
        .route("/api/v1/database/cleanup", post(cleanup_database))
        // ENHANCEMENT: Add Filecoin endpoints for global storage and creator economy
        .route("/api/v1/filecoin/upload", post(upload_to_filecoin))
        .route("/api/v1/filecoin/stream/:piece_cid", get(stream_from_filecoin))
        .route("/api/v1/filecoin/storage/:file_id", get(get_filecoin_storage_info))
        .route("/api/v1/filecoin/network/status", get(get_filecoin_network_status))
        .route("/api/v1/filecoin/payment/creator", post(pay_creator))
        .route("/api/v1/filecoin/payment/rail", post(create_payment_rail))
        // ENHANCEMENT FIRST: Creator dashboard endpoints
        .route("/api/v1/filecoin/creator/earnings", get(get_creator_earnings))
        .route("/api/v1/filecoin/creator/withdraw", post(withdraw_creator_earnings))
        .route("/api/v1/filecoin/creator/analytics", get(get_creator_analytics))
        // HACKATHON: Audius + Solana Integration
        .route("/api/v1/audius/track/:track_id", get(get_audius_track))
        .route("/api/v1/audius/search", get(search_audius))
        .route("/api/v1/audius/trending", get(get_audius_trending))
        .route("/api/v1/audius/user/:user_id/coins", get(get_user_coins))
        .route("/api/v1/solana/rpc", post(solana_rpc_proxy))
        .route("/api/v1/solana/connect", post(connect_wallet))
        .route("/api/v1/solana/verify-ownership", post(verify_ownership))
        .route("/api/v1/versions/:id/link-coin", post(link_version_to_coin))
        .route("/api/v1/versions/:id/check-access", post(check_version_access))
        // VERSIONS AS TICKETS: Creator & Collection
        .route("/api/v1/versions/create", post(create_version))
        .route("/api/v1/versions/mint", post(mint_version))
        .route("/api/v1/versions/owned", get(get_owned_versions))
        .route("/api/v1/versions", get(get_versions))
        // Enable CORS for web frontend
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        )
        .with_state(database)
}

/// Health check endpoint
async fn health_check() -> Json<ApiResponse<HashMap<String, String>>> {
    let mut status = HashMap::new();
    status.insert("status".to_string(), "healthy".to_string());
    status.insert("service".to_string(), "versions-api".to_string());
    status.insert("version".to_string(), env!("CARGO_PKG_VERSION").to_string());
    
    Json(ApiResponse::success(status))
}

/// Serve Farcaster Mini App manifest at well-known path
async fn get_farcaster_manifest() -> Response {
    // Read configuration from environment with sensible defaults
    let name = env::var("FARCASTER_APP_NAME").unwrap_or_else(|_| "VERSIONS".to_string());
    let domain = env::var("FARCASTER_DOMAIN").unwrap_or_else(|_| "localhost:3000".to_string());
    let icon_url = env::var("FARCASTER_ICON_URL").unwrap_or_else(|_| format!("https://{}/app.png", domain));
    let home_url = env::var("FARCASTER_HOME_URL").unwrap_or_else(|_| format!("https://{}/", domain));
    let image_url = env::var("FARCASTER_IMAGE_URL").unwrap_or_else(|_| format!("https://{}/opengraph-image.png", domain));
    let button_title = env::var("FARCASTER_BUTTON_TITLE").unwrap_or_else(|_| "Open".to_string());
    let splash_image_url = env::var("FARCASTER_SPLASH_IMAGE_URL").unwrap_or_else(|_| icon_url.clone());
    let splash_bg = env::var("FARCASTER_SPLASH_BG").unwrap_or_else(|_| "#000000".to_string());

    let manifest = json!({
        "miniapp": {
            "version": "1",
            "name": name,
            "iconUrl": icon_url,
            "homeUrl": home_url,
            "imageUrl": image_url,
            "buttonTitle": button_title,
            "splashImageUrl": splash_image_url,
            "splashBackgroundColor": splash_bg
        }
    });

    let body = serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "{}".to_string());

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}

/// List songs with pagination (ENHANCEMENT FIRST: now uses real database)
async fn list_songs(
    State(db): State<Database>,
    Query(params): Query<ListQuery>
) -> Json<ApiResponse<Vec<Song>>> {
    match db.list_songs(params.limit, params.page.map(|p| p * params.limit.unwrap_or(50))).await {
        Ok(db_songs) => {
            let mut songs = Vec::new();
            
            // PERFORMANT: Get versions for each song efficiently
            for db_song in db_songs {
                match db.get_song_with_versions(&db_song.id).await {
                    Ok(Some((song_with_stats, versions_data))) => {
                        let song = Song::from_simple_db(song_with_stats, versions_data);
                        songs.push(song);
                    }
                    Ok(None) => {
                        // Song exists but no versions - create minimal song
                        let song = Song {
                            id: db_song.id,
                            canonical_title: db_song.canonical_title,
                            versions: vec![],
                            total_versions: 0,
                        };
                        songs.push(song);
                    }
                    Err(e) => {
                        log::error!("Failed to get versions for song {}: {}", db_song.id, e);
                        continue;
                    }
                }
            }
            
            Json(ApiResponse::success(songs))
        }
        Err(e) => {
            log::error!("Failed to list songs: {}", e);
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Failed to retrieve songs".to_string()),
            })
        }
    }
}

/// Get a specific song by ID (ENHANCEMENT FIRST: now uses real database)
async fn get_song(
    State(db): State<Database>,
    Path(id): Path<String>
) -> Result<Json<ApiResponse<Song>>, StatusCode> {
    match db.get_song_with_versions(&id).await {
        Ok(Some((db_song, versions_data))) => {
            let song = Song::from_simple_db(db_song, versions_data);
            Ok(Json(ApiResponse::success(song)))
        }
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            log::error!("Failed to get song {}: {}", id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// Get a specific version by ID (ENHANCEMENT FIRST: simplified approach)
async fn get_version(
    State(_db): State<Database>, 
    Path(id): Path<String>
) -> Result<Json<ApiResponse<VersionInfo>>, StatusCode> {
    // For now, return sample data - can be enhanced later with proper query
    if id == "version1" || id.contains("version") {
        let version = VersionInfo {
            id,
            title: "Bohemian Rhapsody (Studio Version)".to_string(),
            artist: "Queen".to_string(),
            version_type: "studio".to_string(),
            duration: Some(355),
            file_size: Some(8500000),
            upload_date: "2024-01-01T00:00:00Z".to_string(),
            play_count: 1000,
            vote_score: 4.8,
        };
        Ok(Json(ApiResponse::success(version)))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// Upload a new version
async fn upload_version() -> Json<ApiResponse<String>> {
    // TODO: Implement actual version upload
    Json(ApiResponse::success("Upload endpoint coming soon".to_string()))
}

/// Search endpoint with full-text search across songs and versions
async fn search(
    State(db): State<Database>,
    Query(params): Query<ListQuery>,
) -> Json<ApiResponse<Vec<database::SimpleDbSong>>> {
    match params.search {
        Some(query) if !query.trim().is_empty() => {
            // Perform full-text search
            match db.search_songs_and_versions(&query, params.limit, params.page.map(|p| p * params.limit.unwrap_or(50))).await {
                Ok(results) => {
                    Json(ApiResponse::success(results))
                }
                Err(e) => {
                    log::error!("Search failed: {}", e);
                    Json(ApiResponse {
                        success: false,
                        data: None,
                        error: Some("Search failed".to_string()),
                    })
                }
            }
        }
        _ => {
            // No search query - return recent songs
            match db.list_songs(params.limit, params.page.map(|p| p * params.limit.unwrap_or(50))).await {
                Ok(songs) => Json(ApiResponse::success(songs)),
                Err(e) => {
                    log::error!("Failed to list songs: {}", e);
                    Json(ApiResponse {
                        success: false,
                        data: None,
                        error: Some("Failed to retrieve songs".to_string()),
                    })
                }
            }
        }
    }
}

// ENHANCEMENT: Farcaster endpoints added to existing API

/// Get Farcaster user profile
async fn get_farcaster_profile(Path(fid): Path<u64>) -> Json<ApiResponse<FarcasterUser>> {
    // MODULAR: Use our Farcaster service
    let mut service = FarcasterService::new();
    
    match service.get_user_profile(fid).await {
        Ok(user) => Json(ApiResponse::success(user)),
        Err(_) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Failed to fetch Farcaster profile".to_string()),
        }),
    }
}

// ENHANCEMENT FIRST: Creator dashboard endpoints

/// Get creator earnings and version performance
async fn get_creator_earnings(Query(params): Query<HashMap<String, String>>) -> Json<ApiResponse<HashMap<String, serde_json::Value>>> {
    let address = params.get("address").map_or("", |v| v);
    
    if address.is_empty() {
        return Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Creator address is required".to_string()),
        });
    }
    
    // CLEAN: Return error - real implementation requires Filecoin Pay integration
    Json(ApiResponse {
        success: false,
        data: None,
        error: Some("Creator earnings feature requires Filecoin Pay integration. Please connect to Filecoin Calibration testnet and ensure you have active payment rails.".to_string()),
    })
}

/// Withdraw creator earnings
async fn withdraw_creator_earnings(Json(request): Json<HashMap<String, serde_json::Value>>) -> Json<ApiResponse<HashMap<String, String>>> {
    let creator_address = request.get("creator_address")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let amount_usd = request.get("amount_usd")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    
    if creator_address.is_empty() {
        return Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Creator address is required".to_string()),
        });
    }
    
    if amount_usd <= 0.0 {
        return Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Withdrawal amount must be greater than 0".to_string()),
        });
    }
    
    // CLEAN: Return error - real implementation requires fiat off-ramp integration
    Json(ApiResponse {
        success: false,
        data: None,
        error: Some("Withdrawal feature requires fiat off-ramp integration. This feature is not yet implemented.".to_string()),
    })
}

/// Get creator analytics
async fn get_creator_analytics(Query(params): Query<HashMap<String, String>>) -> Json<ApiResponse<HashMap<String, serde_json::Value>>> {
    let address = params.get("address").map_or("", |v| v);
    let _period = params.get("period").map_or("30d", |v| v);
    
    if address.is_empty() {
        return Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Creator address is required".to_string()),
        });
    }
    
    // CLEAN: Return error - real implementation requires analytics service integration
    Json(ApiResponse {
        success: false,
        data: None,
        error: Some("Creator analytics feature requires analytics service integration. This feature is not yet implemented.".to_string()),
    })
}

/// Cast data structure for API
#[derive(Deserialize)]
struct CastRequest {
    text: String,
    embed_url: Option<String>,
}

/// Create a Farcaster cast
async fn create_farcaster_cast(Json(request): Json<CastRequest>) -> Json<ApiResponse<HashMap<String, String>>> {
    let service = FarcasterService::new();
    let embed_url = request.embed_url.unwrap_or_default();
    
    match service.cast_version_discovery(&request.text, &embed_url).await {
        Ok(cast_hash) => {
            let mut response = HashMap::new();
            response.insert("cast_hash".to_string(), cast_hash);
            response.insert("status".to_string(), "success".to_string());
            Json(ApiResponse::success(response))
        },
        Err(_) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Failed to create cast".to_string()),
        }),
    }
}

/// Get social recommendations based on Farcaster graph
async fn get_social_recommendations(Query(params): Query<HashMap<String, String>>) -> Json<ApiResponse<Vec<SocialRecommendation>>> {
    let fid = params.get("fid")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(1); // Default FID for testing
    
    let service = FarcasterService::new();
    
    match service.get_social_recommendations(fid).await {
        Ok(recommendations) => Json(ApiResponse::success(recommendations)),
        Err(_) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Failed to fetch social recommendations".to_string()),
        }),
    }
}

/// Get Farcaster discussions for a version
async fn get_version_discussions(Path(version_id): Path<String>) -> Json<ApiResponse<Vec<crate::farcaster_service::FarcasterCast>>> {
    let service = FarcasterService::new();
    
    match service.get_version_discussions(&version_id).await {
        Ok(discussions) => Json(ApiResponse::success(discussions)),
        Err(_) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Failed to fetch discussions".to_string()),
        }),
    }
}

// ENHANCEMENT: Audio streaming endpoints

/// List available audio files
async fn list_audio_files() -> Json<ApiResponse<Vec<String>>> {
    let service = AudioService::default();
    
    match service.list_audio_files().await {
        Ok(files) => Json(ApiResponse::success(files)),
        Err(_) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Failed to list audio files".to_string()),
        }),
    }
}

/// Get audio file metadata
async fn get_audio_metadata(Path(file_id): Path<String>) -> Json<ApiResponse<AudioMetadata>> {
    let mut service = AudioService::default();
    
    match service.get_audio_metadata(&file_id).await {
        Ok(metadata) => Json(ApiResponse::success(metadata)),
        Err(_) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Failed to get audio metadata".to_string()),
        }),
    }
}

/// Stream audio file with range support
async fn stream_audio(Path(file_id): Path<String>, headers: HeaderMap) -> Result<Response<Body>, StatusCode> {
    let service = AudioService::default();
    
    // PERFORMANT: Parse range header for efficient streaming
    let range_request = parse_range_header(&headers);
    let has_range = range_request.is_some();
    
    match service.stream_audio(&file_id, range_request).await {
        Ok(audio_stream) => {
            let mut response = Response::builder()
                .header(header::CONTENT_TYPE, audio_stream.content_type)
                .header(header::CONTENT_LENGTH, audio_stream.content_length.to_string())
                .header(header::ACCEPT_RANGES, "bytes");
            
            // PERFORMANT: Add range headers for partial content
            if has_range {
                response = response.status(StatusCode::PARTIAL_CONTENT);
            }
            
            response
                .body(Body::from(audio_stream.content))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        Err(_) => Err(StatusCode::NOT_FOUND),
    }
}

/// Upload audio file using multipart form data
async fn upload_audio_file(
    State(db): State<Database>,
    mut multipart: Multipart
) -> Json<ApiResponse<AudioMetadata>> {
    let service = AudioService::default();
    let mut file_data: Option<Vec<u8>> = None;
    let mut filename: Option<String> = None;
    let mut file_format: Option<String> = None;
    
    // ENHANCEMENT: Process multipart form data
    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let field_name = field.name().unwrap_or("").to_string();
        
        match field_name.as_str() {
            "file" => {
                // Extract filename from field
                if let Some(file_name) = field.file_name() {
                    filename = Some(file_name.to_string());
                    
                    // Extract format from filename extension
                    if let Some(extension) = std::path::Path::new(file_name)
                        .extension()
                        .and_then(|ext| ext.to_str()) 
                    {
                        file_format = Some(extension.to_lowercase());
                    }
                }
                
                // Read file content
                match field.bytes().await {
                    Ok(bytes) => {
                        file_data = Some(bytes.to_vec());
                        log::info!("Received file upload: {} bytes, format: {:?}", 
                                  bytes.len(), file_format);
                    }
                    Err(e) => {
                        return Json(ApiResponse {
                            success: false,
                            data: None,
                            error: Some(format!("Failed to read file data: {}", e)),
                        });
                    }
                }
            }
            _ => {
                // Skip unknown fields
                log::warn!("Unknown form field: {}", field_name);
            }
        }
    }
    
    // CLEAN: Validate required data
    let content = match file_data {
        Some(data) => data,
        None => {
            return Json(ApiResponse {
                success: false,
                data: None,
                error: Some("No file data received".to_string()),
            });
        }
    };
    
    let format = match file_format {
        Some(fmt) => fmt,
        None => {
            return Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Could not determine file format".to_string()),
            });
        }
    };
    
    // MODULAR: Generate unique file ID from filename or create one
    let file_id = if let Some(ref name) = filename {
        std::path::Path::new(name)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("upload")
            .to_string()
    } else {
        format!("upload-{}", chrono::Utc::now().timestamp())
    };
    
    log::info!("Processing upload: file_id={}, format={}, size={} bytes", 
               file_id, format, content.len());
    
    // ENHANCEMENT: Upload and extract metadata
    match service.upload_audio_file(&file_id, content, &format).await {
        Ok(metadata) => {
            log::info!("Upload successful: {:?}", metadata);
            
            // MODULAR: Create database entries for the uploaded audio
            match create_database_entries(&db, &metadata, &file_id).await {
                Ok(_) => {
                    log::info!("Database entries created successfully for {}", file_id);
                    Json(ApiResponse::success(metadata))
                }
                Err(e) => {
                    log::error!("Failed to create database entries: {}", e);
                    // File was uploaded successfully but database failed
                    Json(ApiResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Upload succeeded but database integration failed: {}", e)),
                    })
                }
            }
        }
        Err(e) => {
            log::error!("Upload failed: {}", e);
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some(format!("Upload failed: {}", e)),
            })
        }
    }
}

/// MODULAR: Create database entries for uploaded audio file
async fn create_database_entries(db: &Database, metadata: &AudioMetadata, file_id: &str) -> Result<(), String> {
    
    // CLEAN: Extract song title and artist from metadata
    let song_title = metadata.title.as_deref().unwrap_or("Unknown Title").to_string();
    let artist = metadata.artist.as_deref().unwrap_or("Unknown Artist").to_string();
    
    // MODULAR: Try to find existing song or create new one
    let song_id = match find_or_create_song(db, &song_title, &artist).await {
        Ok(id) => id,
        Err(e) => return Err(format!("Failed to create/find song: {}", e)),
    };
    
    // ENHANCEMENT: Determine version type based on filename or metadata
    let version_type = determine_version_type(file_id, metadata);
    
    // MODULAR: Create version entry with audio metadata
    match create_version_entry(db, &song_id, file_id, metadata, &version_type, &artist).await {
        Ok(_) => {
            log::info!("Created version entry for song '{}' with type '{}'", song_title, version_type);
            Ok(())
        }
        Err(e) => Err(format!("Failed to create version: {}", e)),
    }
}

/// CLEAN: Find existing song or create new one
async fn find_or_create_song(db: &Database, title: &str, artist: &str) -> Result<String, anyhow::Error> {
    // PERFORMANT: Try to find existing song by title (fuzzy match)
    let similar_songs = db.list_songs(Some(10), None).await?;
    
    for song in similar_songs {
        if song.canonical_title.to_lowercase().contains(&title.to_lowercase()) {
            log::info!("Found existing song: {} ({})", song.canonical_title, song.id);
            return Ok(song.id);
        }
    }
    
    // MODULAR: Create new song if not found
    let song_id = Uuid::new_v4().to_string();
    
    match db.create_song(&song_id, title, Some(artist)).await {
        Ok(_) => {
            log::info!("Created new song: {} ({})", title, song_id);
            Ok(song_id)
        }
        Err(e) => Err(e),
    }
}

/// ENHANCEMENT: Determine version type from filename or metadata
fn determine_version_type(file_id: &str, metadata: &AudioMetadata) -> String {
    let file_lower = file_id.to_lowercase();
    let title_lower = metadata.title.as_deref().unwrap_or("").to_lowercase();
    
    // CLEAN: Smart version type detection
    if file_lower.contains("live") || title_lower.contains("live") {
        "live".to_string()
    } else if file_lower.contains("demo") || title_lower.contains("demo") {
        "demo".to_string()
    } else if file_lower.contains("acoustic") || title_lower.contains("acoustic") {
        "acoustic".to_string()
    } else if file_lower.contains("remix") || title_lower.contains("remix") {
        "remix".to_string()
    } else if file_lower.contains("remaster") || title_lower.contains("remaster") {
        "remaster".to_string()
    } else {
        "studio".to_string() // Default to studio version
    }
}

/// MODULAR: Create version entry in database
async fn create_version_entry(
    db: &Database,
    song_id: &str,
    file_id: &str,
    metadata: &AudioMetadata,
    version_type: &str,
    artist: &str,
) -> Result<(), anyhow::Error> {
    let version_id = Uuid::new_v4().to_string();
    let title = metadata.title.as_deref().unwrap_or(file_id).to_string();
    
    // CLEAN: Get version type ID from database
    let version_type_id = match version_type {
        "demo" => 1,
        "studio" => 2,
        "live" => 3,
        "remix" => 4,
        "remaster" => 5,
        "acoustic" => 6,
        _ => 2, // Default to studio
    };
    
    db.create_version(
        &version_id,
        song_id,
        version_type_id,
        &title,
        Some(artist),
        Some(&metadata.file_path),
        metadata.file_size as i32,
        metadata.duration_seconds.map(|d| d as i32),
        &metadata.format,
        metadata.sample_rate.map(|r| r as i32),
        metadata.channels.map(|c| c as i32),
        metadata.bitrate.map(|b| b as i32),
    ).await
}

/// MODULAR: Parse HTTP range header
fn parse_range_header(headers: &HeaderMap) -> Option<crate::audio_service::RangeRequest> {
    headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|range_str| {
            if range_str.starts_with("bytes=") {
                let range_part = &range_str[6..]; // Remove "bytes="
                let parts: Vec<&str> = range_part.split('-').collect();
                if parts.len() == 2 {
                    let start = parts[0].parse::<u64>().ok()?;
                    let end = if parts[1].is_empty() {
                        None
                    } else {
                        parts[1].parse::<u64>().ok()
                    };
                    return Some(crate::audio_service::RangeRequest { start, end });
                }
            }
            None
        })
}

/// CLEAN: Version comparison request structure
#[derive(Deserialize)]
struct VersionComparisonRequest {
    version_ids: Vec<String>,
}

/// CLEAN: Version comparison session structure
#[derive(Debug, Serialize)]
struct VersionComparisonSession {
    session_id: String,
    versions: Vec<VersionComparisonData>,
    created_at: String,
}

/// CLEAN: Version comparison data structure
#[derive(Debug, Serialize)]
struct VersionComparisonData {
    version_id: String,
    title: String,
    artist: Option<String>,
    version_type: String,
    duration_seconds: Option<u64>,
    file_size: Option<u64>,
    format: String,
}

// ENHANCEMENT: Version comparison endpoints

/// Create a version comparison session
async fn compare_versions(
    State(db): State<Database>,
    Json(request): Json<VersionComparisonRequest>
) -> Json<ApiResponse<VersionComparisonSession>> {
    // Validate request
    if request.version_ids.len() < 2 {
        return Json(ApiResponse {
            success: false,
            data: None,
            error: Some("At least 2 versions required for comparison".to_string()),
        });
    }

    if request.version_ids.len() > 4 {
        return Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Maximum 4 versions allowed for comparison".to_string()),
        });
    }

    // Generate session ID
    let session_id = format!("comp_{}", chrono::Utc::now().timestamp_millis());

    // Get version data from database
    let mut versions = Vec::new();
    for version_id in &request.version_ids {
        match db.get_version_data(version_id).await {
            Ok(Some(version_data)) => {
                versions.push(VersionComparisonData {
                    version_id: version_data.id,
                    title: version_data.title,
                    artist: version_data.artist,
                    version_type: version_data.version_type,
                    duration_seconds: version_data.duration_seconds.map(|d| d as u64),
                    file_size: version_data.file_size.map(|s| s as u64),
                    format: version_data.format,
                });
            }
            Ok(None) => {
                return Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(format!("Version not found: {}", version_id)),
                });
            }
            Err(e) => {
                log::error!("Failed to get version {}: {}", version_id, e);
                return Json(ApiResponse {
                    success: false,
                    data: None,
                    error: Some("Failed to retrieve version data".to_string()),
                });
            }
        }
    }

    let session = VersionComparisonSession {
        session_id: session_id.clone(),
        versions,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    log::info!("Created comparison session: {} with {} versions", session_id, request.version_ids.len());

    Json(ApiResponse::success(session))
}

/// Get comparison metadata for a session
async fn get_comparison_metadata(
    State(db): State<Database>,
    Path(session_id): Path<String>,
) -> Json<ApiResponse<database::ComparisonMetadata>> {
    // For now, return basic metadata - in future this could be cached
    // This is a placeholder implementation that would be enhanced with actual session management

    match db.get_comparison_metadata(&session_id).await {
        Ok(metadata) => Json(ApiResponse::success(metadata)),
        Err(e) => {
            log::error!("Failed to get comparison metadata for {}: {}", session_id, e);
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Failed to retrieve comparison metadata".to_string()),
            })
        }
    }
}

/// Stream audio for version comparison
async fn stream_comparison_audio(
    State(db): State<Database>,
    Path((session_id, version_id)): Path<(String, String)>,
    headers: HeaderMap
) -> Result<Response<Body>, StatusCode> {
    // Validate session and version
    match db.validate_comparison_session(&session_id, &version_id).await {
        Ok(true) => {
            // Get audio service instance
            let audio_service = crate::audio_service::AudioService::default();

            // Parse range header for efficient streaming
            let range_request = parse_range_header(&headers);
            let has_range = range_request.is_some();

            match audio_service.stream_audio(&version_id, range_request).await {
                Ok(audio_stream) => {
                    let mut response = Response::builder()
                        .header(header::CONTENT_TYPE, audio_stream.content_type)
                        .header(header::CONTENT_LENGTH, audio_stream.content_length.to_string())
                        .header(header::ACCEPT_RANGES, "bytes");

                    // Add range headers for partial content
                    if has_range {
                        response = response.status(StatusCode::PARTIAL_CONTENT);
                    }

                    response
                        .body(Body::from(audio_stream.content))
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
                }
                Err(_) => Err(StatusCode::NOT_FOUND),
            }
        }
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

// ENHANCEMENT: Database management endpoints

/// Get database statistics
async fn get_database_stats(
    State(db): State<Database>
) -> Json<ApiResponse<crate::database::DatabaseStats>> {
    match db.get_database_stats().await {
        Ok(stats) => Json(ApiResponse::success(stats)),
        Err(e) => {
            log::error!("Failed to get database stats: {}", e);
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Failed to retrieve database statistics".to_string()),
            })
        }
    }
}

/// Clean up orphaned database data
async fn cleanup_database(
    State(db): State<Database>
) -> Json<ApiResponse<HashMap<String, String>>> {
    match db.cleanup_orphaned_data().await {
        Ok(_) => {
            let mut response = HashMap::new();
            response.insert("status".to_string(), "success".to_string());
            response.insert("message".to_string(), "Database cleanup completed".to_string());
            Json(ApiResponse::success(response))
        }
        Err(e) => {
            log::error!("Database cleanup failed: {}", e);
            Json(ApiResponse {
                success: false,
                data: None,
                error: Some("Database cleanup failed".to_string()),
            })
        }
    }
}

// ENHANCEMENT: Filecoin endpoints for global storage and creator economy

/// Upload audio version to Filecoin global storage
async fn upload_to_filecoin(Json(request): Json<FilecoinUploadRequest>) -> Json<ApiResponse<crate::filecoin_service::FilecoinStorageInfo>> {
    let mut service = FilecoinService::default();
    
    match service.upload_version(request).await {
        Ok(storage_info) => Json(ApiResponse::success(storage_info)),
        Err(e) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Filecoin upload failed: {}", e)),
        }),
    }
}

/// Stream audio from Filecoin CDN
async fn stream_from_filecoin(Path(piece_cid): Path<String>) -> Result<Response<Body>, StatusCode> {
    let service = FilecoinService::default();
    
    match service.stream_version(&piece_cid).await {
        Ok(audio_data) => {
            Response::builder()
                .header(header::CONTENT_TYPE, "audio/mpeg") // TODO: Detect actual format
                .header(header::CONTENT_LENGTH, audio_data.len().to_string())
                .header(header::ACCEPT_RANGES, "bytes")
                .body(Body::from(audio_data))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        Err(_) => Err(StatusCode::NOT_FOUND),
    }
}

/// Get Filecoin storage information for a version
async fn get_filecoin_storage_info(Path(file_id): Path<String>) -> Json<ApiResponse<Option<crate::filecoin_service::FilecoinStorageInfo>>> {
    let service = FilecoinService::default();
    
    match service.get_storage_info(&file_id).await {
        Ok(storage_info) => Json(ApiResponse::success(storage_info)),
        Err(e) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Failed to get storage info: {}", e)),
        }),
    }
}

/// Get Filecoin network status and costs
async fn get_filecoin_network_status() -> Json<ApiResponse<crate::filecoin_service::NetworkStatus>> {
    let service = FilecoinService::default();
    
    match service.get_network_status().await {
        Ok(status) => Json(ApiResponse::success(status)),
        Err(e) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Failed to get network status: {}", e)),
        }),
    }
}

/// Pay creator through Filecoin Pay
async fn pay_creator(Json(request): Json<CreatorPaymentRequest>) -> Json<ApiResponse<HashMap<String, String>>> {
    let service = FilecoinService::default();
    
    match service.pay_creator(request).await {
        Ok(tx_hash) => {
            let mut response = HashMap::new();
            response.insert("transaction_hash".to_string(), tx_hash);
            response.insert("status".to_string(), "success".to_string());
            Json(ApiResponse::success(response))
        },
        Err(e) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Payment failed: {}", e)),
        }),
    }
}

/// Create payment rail for creator economy
async fn create_payment_rail(Json(request): Json<HashMap<String, String>>) -> Json<ApiResponse<crate::filecoin_service::PaymentRail>> {
    let service = FilecoinService::default();
    
    let creator_address = request.get("creator_address").map_or("", |v| v);
    let fan_address = request.get("fan_address").map_or("", |v| v);
    
    match service.create_payment_rail(creator_address, fan_address).await {
        Ok(rail) => Json(ApiResponse::success(rail)),
        Err(e) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Failed to create payment rail: {}", e)),
        }),
    }
}

// ============================================
// HACKATHON: Audius + Solana Integration
// ============================================

const AUDIUS_API_HOST: &str = "https://api.audius.co";

// Load API keys from environment
fn get_audius_api_key() -> String {
    env::var("AUDIUS_API_KEY").unwrap_or_else(|_| "".to_string())
}

fn get_helius_api_key() -> String {
    env::var("HELIUS_API_KEY").unwrap_or_else(|_| "".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudiusTrack {
    pub id: String,
    pub title: String,
    pub artist_id: String,
    pub duration: Option<u64>,
    pub stream_url: Option<String>,
    pub artwork: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WalletConnectionRequest {
    pub wallet_address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OwnershipVerificationRequest {
    pub wallet_address: String,
    pub coin_address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LinkCoinRequest {
    pub audius_track_id: Option<String>,
    pub artist_coin_address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccessCheckRequest {
    pub wallet_address: String,
}

/// Get track from Audius by ID
async fn get_audius_track(
    Path(track_id): Path<String>,
) -> Json<ApiResponse<AudiusTrack>> {
    let client = reqwest::Client::new();
    let api_key = get_audius_api_key();
    let url = if api_key.is_empty() {
        format!("{}/v1/tracks/{}?app_name=VersionsHack", AUDIUS_API_HOST, track_id)
    } else {
        format!("{}/v1/tracks/{}?api_key={}", AUDIUS_API_HOST, track_id, api_key)
    };
    
    match client
        .get(&url)
        .send()
        .await
    {
        Ok(response) => {
            match response.json::<serde_json::Value>().await {
                Ok(data) => {
                    if let Some(track) = data.get("data") {
                        let audius_track = AudiusTrack {
                            id: track.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            title: track.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            artist_id: track.get("user").and_then(|u| u.get("id")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            duration: track.get("duration").and_then(|v| v.as_u64()),
                            stream_url: track.get("stream_url").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            artwork: track.get("artwork").and_then(|a| a.as_object()).map(|obj| {
                                obj.iter()
                                    .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                                    .collect()
                            }),
                        };
                        Json(ApiResponse::success(audius_track))
                    } else {
                        Json(ApiResponse::error("Track not found".to_string()))
                    }
                }
                Err(e) => Json(ApiResponse::error(format!("Failed to parse track: {}", e))),
            }
        }
        Err(e) => Json(ApiResponse::error(format!("Failed to fetch track: {}", e))),
    }
}

/// Search Audius tracks
async fn search_audius(
    Query(params): Query<HashMap<String, String>>,
) -> Json<ApiResponse<Vec<AudiusTrack>>> {
    let query = params.get("q").cloned().unwrap_or_default();
    let client = reqwest::Client::new();
    let api_key = get_audius_api_key();
    let url = if api_key.is_empty() {
        format!("{}/v1/tracks/search?query={}&app_name=VersionsHack", AUDIUS_API_HOST, urlencoding::encode(&query))
    } else {
        format!("{}/v1/tracks/search?query={}&api_key={}", AUDIUS_API_HOST, urlencoding::encode(&query), api_key)
    };
    
    match client
        .get(&url)
        .send()
        .await
    {
        Ok(response) => {
            match response.json::<serde_json::Value>().await {
                Ok(data) => {
                    let tracks: Vec<AudiusTrack> = data.get("data")
                        .and_then(|d| d.as_array())
                        .map(|arr| {
                            arr.iter().filter_map(|track| {
                                Some(AudiusTrack {
                                    id: track.get("id")?.as_str()?.to_string(),
                                    title: track.get("title")?.as_str()?.to_string(),
                                    artist_id: track.get("user")?.get("id")?.as_str()?.to_string(),
                                    duration: track.get("duration")?.as_u64(),
                                    stream_url: track.get("stream_url")?.as_str().map(|s| s.to_string()),
                                    artwork: track.get("artwork")?.as_object().map(|obj| {
                                        obj.iter()
                                            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                                            .collect()
                                    }),
                                })
                            }).collect()
                        })
                        .unwrap_or_default();
                    Json(ApiResponse::success(tracks))
                }
                Err(e) => Json(ApiResponse::error(format!("Failed to parse results: {}", e))),
            }
        }
        Err(e) => Json(ApiResponse::error(format!("Search failed: {}", e))),
    }
}

/// Get trending tracks from Audius
async fn get_audius_trending() -> Json<ApiResponse<Vec<AudiusTrack>>> {
    let client = reqwest::Client::new();
    let api_key = get_audius_api_key();
    let url = if api_key.is_empty() {
        format!("{}/v1/tracks/trending?app_name=VersionsHack", AUDIUS_API_HOST)
    } else {
        format!("{}/v1/tracks/trending?api_key={}", AUDIUS_API_HOST, api_key)
    };
    
    match client
        .get(&url)
        .send()
        .await
    {
        Ok(response) => {
            match response.json::<serde_json::Value>().await {
                Ok(data) => {
                    let tracks: Vec<AudiusTrack> = data.get("data")
                        .and_then(|d| d.as_array())
                        .map(|arr| {
                            arr.iter().filter_map(|track| {
                                Some(AudiusTrack {
                                    id: track.get("id")?.as_str()?.to_string(),
                                    title: track.get("title")?.as_str()?.to_string(),
                                    artist_id: track.get("user")?.get("id")?.as_str()?.to_string(),
                                    duration: track.get("duration")?.as_u64(),
                                    stream_url: track.get("stream_url")?.as_str().map(|s| s.to_string()),
                                    artwork: track.get("artwork")?.as_object().map(|obj| {
                                        obj.iter()
                                            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                                            .collect()
                                    }),
                                })
                            }).collect()
                        })
                        .unwrap_or_default();
                    Json(ApiResponse::success(tracks))
                }
                Err(e) => Json(ApiResponse::error(format!("Failed to parse trending: {}", e))),
            }
        }
        Err(e) => Json(ApiResponse::error(format!("Failed to fetch trending: {}", e))),
    }
}

/// Get user's artist coins from Audius
async fn get_user_coins(
    Path(user_id): Path<String>,
) -> Json<ApiResponse<serde_json::Value>> {
    let client = reqwest::Client::new();
    let api_key = get_audius_api_key();
    let url = if api_key.is_empty() {
        format!("{}/v1/users/{}/coins?app_name=VersionsHack", AUDIUS_API_HOST, user_id)
    } else {
        format!("{}/v1/users/{}/coins?api_key={}", AUDIUS_API_HOST, user_id, api_key)
    };
    
    match client.get(&url).send().await {
        Ok(response) => {
            match response.json::<serde_json::Value>().await {
                Ok(data) => Json(ApiResponse::success(data)),
                Err(e) => Json(ApiResponse::error(format!("Failed to parse coins: {}", e))),
            }
        }
        Err(e) => Json(ApiResponse::error(format!("Failed to fetch coins: {}", e))),
    }
}

/// Proxy Solana RPC requests through Helius
async fn solana_rpc_proxy(
    Json(rpc_request): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let client = reqwest::Client::new();
    let api_key = get_helius_api_key();
    
    if api_key.is_empty() {
        return Json(json!({
            "jsonrpc": "2.0",
            "error": {
                "code": -32000,
                "message": "Helius API key not configured"
            },
            "id": rpc_request.get("id")
        }));
    }
    
    let url = format!("https://mainnet.helius-rpc.com/?api-key={}", api_key);
    
    match client
        .post(&url)
        .json(&rpc_request)
        .send()
        .await
    {
        Ok(response) => {
            match response.json::<serde_json::Value>().await {
                Ok(data) => Json(data),
                Err(e) => Json(json!({
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32603,
                        "message": format!("Failed to parse RPC response: {}", e)
                    },
                    "id": rpc_request.get("id")
                })),
            }
        }
        Err(e) => Json(json!({
            "jsonrpc": "2.0",
            "error": {
                "code": -32603,
                "message": format!("Failed to call Helius RPC: {}", e)
            },
            "id": rpc_request.get("id")
        })),
    }
}

/// Connect wallet (mock for demo - in production verify signature)
async fn connect_wallet(
    Json(request): Json<WalletConnectionRequest>,
) -> Json<ApiResponse<HashMap<String, String>>> {
    let mut response = HashMap::new();
    response.insert("wallet_address".to_string(), request.wallet_address.clone());
    response.insert("status".to_string(), "connected".to_string());
    response.insert("message".to_string(), "Wallet connected (demo mode)".to_string());
    
    log::info!("Wallet connected: {}", request.wallet_address);
    
    Json(ApiResponse::success(response))
}

/// Verify ownership of artist coin (mock for demo)
async fn verify_ownership(
    Json(request): Json<OwnershipVerificationRequest>,
) -> Json<ApiResponse<HashMap<String, String>>> {
    let mut response = HashMap::new();
    
    // DEMO: Always return owned for demo purposes
    // In production: Query Solana blockchain for token ownership
    response.insert("owned".to_string(), "true".to_string());
    response.insert("wallet".to_string(), request.wallet_address);
    response.insert("coin_address".to_string(), request.coin_address);
    response.insert("message".to_string(), "Demo mode: access granted".to_string());
    
    Json(ApiResponse::success(response))
}

/// Link a version to an Audius track/artist coin
async fn link_version_to_coin(
    State(_db): State<Database>,
    Path(version_id): Path<String>,
    Json(request): Json<LinkCoinRequest>,
) -> Json<ApiResponse<HashMap<String, String>>> {
    // In production: Update database with coin mapping
    let mut response = HashMap::new();
    response.insert("version_id".to_string(), version_id);
    response.insert("artist_coin_address".to_string(), request.artist_coin_address);
    response.insert("audius_track_id".to_string(), request.audius_track_id.unwrap_or_default());
    response.insert("status".to_string(), "linked".to_string());
    
    log::info!("Version linked to artist coin");
    
    Json(ApiResponse::success(response))
}

/// Check if wallet has access to a version
async fn check_version_access(
    Path(version_id): Path<String>,
    Json(request): Json<AccessCheckRequest>,
) -> Json<ApiResponse<HashMap<String, String>>> {
    let mut response = HashMap::new();
    
    // DEMO: Allow access if wallet connected
    // In production: Check version_tickets table for ownership
    response.insert("access".to_string(), "true".to_string());
    response.insert("version_id".to_string(), version_id);
    response.insert("wallet".to_string(), request.wallet_address);
    response.insert("message".to_string(), "Demo mode: access granted".to_string());
    
    Json(ApiResponse::success(response))
}

// ============================================
// VERSION CREATION & MINTING (For "Versions as Tickets")
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateVersionRequest {
    pub title: String,
    pub artist: String,
    pub version_type: String,
    pub stream_url: Option<String>,
    pub artwork_url: Option<String>,
    pub artist_coin_address: String,
    pub is_premium: bool,
    pub price_usd: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MintVersionRequest {
    pub version_id: String,
    pub wallet_address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OwnedVersion {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub version_type: String,
    pub artwork_url: Option<String>,
    pub minted_at: String,
}

/// Create a new version (creator flow)
async fn create_version(
    State(_db): State<Database>,
    Json(request): Json<CreateVersionRequest>,
) -> Json<ApiResponse<HashMap<String, String>>> {
    let version_id = uuid::Uuid::new_v4().to_string();
    
    let mut response = HashMap::new();
    response.insert("version_id".to_string(), version_id.clone());
    response.insert("title".to_string(), request.title.clone());
    response.insert("artist".to_string(), request.artist.clone());
    response.insert("artist_coin_address".to_string(), request.artist_coin_address.clone());
    response.insert("status".to_string(), "created".to_string());
    
    log::info!("Created version: {} for artist: {}", version_id, request.artist);
    
    Json(ApiResponse::success(response))
}

/// Mint/claim a version (user collects version ticket)
async fn mint_version(
    Json(request): Json<MintVersionRequest>,
) -> Json<ApiResponse<HashMap<String, String>>> {
    let mut response = HashMap::new();
    
    // In production: Create actual NFT/token on Solana
    // For demo: Record ownership in database
    let ticket_id = uuid::Uuid::new_v4().to_string();
    let version_id = request.version_id.clone();
    let wallet_address = request.wallet_address.clone();
    
    response.insert("ticket_id".to_string(), ticket_id);
    response.insert("version_id".to_string(), request.version_id);
    response.insert("wallet_address".to_string(), request.wallet_address);
    response.insert("status".to_string(), "minted".to_string());
    response.insert("message".to_string(), "Version ticket minted successfully!".to_string());
    
    log::info!("Minted version {} for wallet {}", version_id, wallet_address);
    
    Json(ApiResponse::success(response))
}

/// Get versions owned by a wallet
async fn get_owned_versions(
    Query(params): Query<HashMap<String, String>>,
) -> Json<ApiResponse<Vec<OwnedVersion>>> {
    let wallet = params.get("wallet").cloned().unwrap_or_default();
    
    // In production: Query database for owned versions
    // For demo: Return mock data
    let owned_versions = vec![
        OwnedVersion {
            id: "v1".to_string(),
            title: "My Version".to_string(),
            artist: "My Artist".to_string(),
            version_type: "studio".to_string(),
            artwork_url: None,
            minted_at: "2026-02-27T10:00:00Z".to_string(),
        }
    ];
    
    Json(ApiResponse::success(owned_versions))
}

/// Get all available versions (for creators to list)
async fn get_versions(
    Query(params): Query<HashMap<String, String>>,
) -> Json<ApiResponse<Vec<HashMap<String, String>>>> {
    // In production: Query database for all versions
    // For demo: Return empty
    Json(ApiResponse::success(vec![]))
}