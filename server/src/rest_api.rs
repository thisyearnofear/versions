use axum::{
    extract::{Path, Query},
    http::{StatusCode, HeaderMap, header},
    response::{Json, Response},
    body::Body,
    routing::{get, post},
    Router,
};
use crate::farcaster_service::{FarcasterService, FarcasterUser, SocialRecommendation};
use crate::audio_service::{AudioService, AudioMetadata};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    #[allow(dead_code)] // Will be used for pagination
    pub page: Option<u32>,
    #[allow(dead_code)] // Will be used for pagination
    pub limit: Option<u32>,
    #[allow(dead_code)] // Will be used for search functionality
    pub search: Option<String>,
}

/// Create the REST API router
pub fn create_router() -> Router {
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
        // ENHANCEMENT: Add audio streaming endpoints
        .route("/api/v1/audio/files", get(list_audio_files))
        .route("/api/v1/audio/:file_id/metadata", get(get_audio_metadata))
        .route("/api/v1/audio/:file_id/stream", get(stream_audio))
        .route("/api/v1/audio/upload", post(upload_audio_file))
        // Enable CORS for web frontend
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        )
}

/// Health check endpoint
async fn health_check() -> Json<ApiResponse<HashMap<String, String>>> {
    let mut status = HashMap::new();
    status.insert("status".to_string(), "healthy".to_string());
    status.insert("service".to_string(), "versions-api".to_string());
    status.insert("version".to_string(), env!("CARGO_PKG_VERSION").to_string());
    
    Json(ApiResponse::success(status))
}

/// List songs with pagination
async fn list_songs(Query(_params): Query<ListQuery>) -> Json<ApiResponse<Vec<Song>>> {
    // TODO: Implement actual database query
    // For now, return mock data
    let mock_songs = vec![
        Song {
            id: "song1".to_string(),
            canonical_title: "Bohemian Rhapsody".to_string(),
            versions: vec![
                VersionInfo {
                    id: "version1".to_string(),
                    title: "Bohemian Rhapsody (Studio Version)".to_string(),
                    artist: "Queen".to_string(),
                    version_type: "Studio".to_string(),
                    duration: Some(355),
                    file_size: Some(8500000),
                    upload_date: "2024-01-01T00:00:00Z".to_string(),
                    play_count: 1000,
                    vote_score: 4.8,
                },
                VersionInfo {
                    id: "version2".to_string(),
                    title: "Bohemian Rhapsody (Live at Wembley)".to_string(),
                    artist: "Queen".to_string(),
                    version_type: "Live".to_string(),
                    duration: Some(380),
                    file_size: Some(9200000),
                    upload_date: "2024-01-02T00:00:00Z".to_string(),
                    play_count: 750,
                    vote_score: 4.9,
                },
            ],
            total_versions: 2,
        },
    ];

    Json(ApiResponse::success(mock_songs))
}

/// Get a specific song by ID
async fn get_song(Path(id): Path<String>) -> Result<Json<ApiResponse<Song>>, StatusCode> {
    // TODO: Implement actual database query
    if id == "song1" {
        let song = Song {
            id: "song1".to_string(),
            canonical_title: "Bohemian Rhapsody".to_string(),
            versions: vec![
                VersionInfo {
                    id: "version1".to_string(),
                    title: "Bohemian Rhapsody (Studio Version)".to_string(),
                    artist: "Queen".to_string(),
                    version_type: "Studio".to_string(),
                    duration: Some(355),
                    file_size: Some(8500000),
                    upload_date: "2024-01-01T00:00:00Z".to_string(),
                    play_count: 1000,
                    vote_score: 4.8,
                },
            ],
            total_versions: 1,
        };
        Ok(Json(ApiResponse::success(song)))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// Get a specific version by ID
async fn get_version(Path(id): Path<String>) -> Result<Json<ApiResponse<VersionInfo>>, StatusCode> {
    // TODO: Implement actual database query
    if id == "version1" {
        let version = VersionInfo {
            id: "version1".to_string(),
            title: "Bohemian Rhapsody (Studio Version)".to_string(),
            artist: "Queen".to_string(),
            version_type: "Studio".to_string(),
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

/// Search endpoint (placeholder)
async fn search(_query: Query<ListQuery>) -> Json<ApiResponse<Vec<String>>> {
    Json(ApiResponse::success(vec![
        "Search functionality coming soon".to_string(),
    ]))
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

/// Upload audio file
async fn upload_audio_file(Json(request): Json<UploadRequest>) -> Json<ApiResponse<AudioMetadata>> {
    let service = AudioService::default();
    
    // CLEAN: Decode base64 content
    let content = match base64::engine::general_purpose::STANDARD.decode(&request.content) {
        Ok(data) => data,
        Err(_) => return Json(ApiResponse {
            success: false,
            data: None,
            error: Some("Invalid base64 content".to_string()),
        }),
    };
    
    match service.upload_audio_file(&request.file_id, content, &request.format).await {
        Ok(metadata) => Json(ApiResponse::success(metadata)),
        Err(e) => Json(ApiResponse {
            success: false,
            data: None,
            error: Some(format!("Upload failed: {}", e)),
        }),
    }
}

/// CLEAN: Upload request structure
#[derive(Deserialize)]
struct UploadRequest {
    file_id: String,
    content: String, // base64 encoded
    format: String,
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