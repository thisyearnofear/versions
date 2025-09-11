# 🏗️ VERSIONS - Technical Architecture

## **System Overview**

VERSIONS is a version-centric music platform built with Rust backend and modern web frontend.

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Frontend  │    │   REST/GraphQL   │    │  Audio Engine   │
│   (React/Vue)   │◄──►│      API         │◄──►│   (Rust)        │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                       ┌──────────────────┐
                       │    Database      │
                       │  (PostgreSQL)    │
                       └──────────────────┘
```

## **Core Components**

### **1. Audio Engine (`termusicplayback`)**
- **Multiple Backends**: Symphonia (default), MPV, GStreamer
- **Format Support**: FLAC, MP3, M4A, WAV, OGG, AIFF, Opus
- **Real-time Processing**: Streaming, transcoding, analysis
- **Cross-platform**: macOS, Linux, Windows

### **2. Core Library (`termusiclib`)**
- **Version Management**: Upload, metadata, relationships
- **Database Layer**: PostgreSQL with migrations
- **Configuration**: TOML-based settings
- **Audio Processing**: Metadata extraction, waveform analysis

### **3. Server (`versions-server`)**
- **gRPC Services**: High-performance internal communication
- **REST API**: Public HTTP endpoints for web frontend
- **Authentication**: JWT-based user sessions
- **File Storage**: S3-compatible object storage

### **4. Web Frontend** (Planned)
- **Framework**: React/Vue.js with TypeScript
- **Audio Player**: Web Audio API integration
- **Real-time Updates**: WebSocket connections
- **Responsive Design**: Mobile-first approach

## **Data Model**

### **Version-First Architecture**
```rust
struct Version {
    id: VersionId,
    song_id: SongId,
    title: String,
    version_type: VersionType, // Demo, Remix, Live, etc.
    artist: Artist,
    upload_date: DateTime,
    audio_file: AudioFile,
    metadata: VersionMetadata,
    relationships: Vec<VersionRelationship>,
    community_data: CommunityData,
}

struct Song {
    id: SongId,
    canonical_title: String,
    versions: Vec<Version>,
    timeline: VersionTimeline,
}
```

### **Community Features**
```rust
struct CommunityData {
    votes: VoteCount,
    comments: Vec<Comment>,
    play_count: u64,
    discovery_score: f64,
    similarity_matches: Vec<VersionId>,
}
```

## **API Design**

### **REST Endpoints**
```
GET    /api/v1/songs              # List songs with pagination
GET    /api/v1/songs/{id}         # Song details with versions
GET    /api/v1/versions/{id}      # Version details and stream URL
POST   /api/v1/versions           # Upload new version
PUT    /api/v1/versions/{id}      # Update version metadata
DELETE /api/v1/versions/{id}      # Delete version

GET    /api/v1/search             # Search songs and versions
POST   /api/v1/versions/{id}/vote # Vote on version quality
GET    /api/v1/versions/{id}/comments # Get comments
POST   /api/v1/versions/{id}/comments # Add comment
```

### **WebSocket Events**
```
version.uploaded     # New version available
version.updated      # Metadata changed
comment.added        # New comment posted
vote.changed         # Vote count updated
```

## **Storage Strategy**

### **Audio Files**
- **Primary**: S3-compatible object storage (Cloudflare R2)
- **CDN**: Global distribution for streaming
- **Formats**: Original + transcoded variants (MP3, AAC)
- **Metadata**: Extracted and stored separately

### **Database Schema**
```sql
-- Core entities
songs (id, canonical_title, created_at)
versions (id, song_id, title, version_type, file_path, metadata)
artists (id, name, verified)
users (id, username, email, created_at)

-- Relationships
version_relationships (version_id, related_version_id, relationship_type)
song_artists (song_id, artist_id, role)
user_votes (user_id, version_id, vote_value)
comments (id, user_id, version_id, content, created_at)
```

## **Performance Considerations**

### **Audio Streaming**
- **Adaptive Bitrate**: Multiple quality levels
- **Range Requests**: Efficient seeking and partial downloads
- **Caching**: CDN + browser cache strategies
- **Preloading**: Smart prefetch for version comparisons

### **Database Optimization**
- **Indexing**: Optimized for search and discovery queries
- **Partitioning**: Large tables partitioned by date
- **Caching**: Redis for frequently accessed data
- **Read Replicas**: Separate read/write workloads

### **Search & Discovery**
- **Full-text Search**: PostgreSQL + Elasticsearch hybrid
- **Similarity Matching**: Vector embeddings for audio features
- **Recommendation Engine**: Collaborative filtering algorithms
- **Real-time Updates**: Incremental index updates

## **Security Model**

### **Authentication**
- **JWT Tokens**: Stateless authentication
- **Refresh Tokens**: Secure token rotation
- **OAuth Integration**: GitHub, Google, Spotify
- **Rate Limiting**: API endpoint protection

### **Authorization**
- **Role-based Access**: User, Artist, Moderator, Admin
- **Resource Ownership**: Users control their uploads
- **Community Moderation**: Flagging and review system
- **Content Filtering**: Automated and manual review

## **Deployment Architecture**

### **Development**
```
Docker Compose:
- PostgreSQL database
- Redis cache
- S3-compatible storage (MinIO)
- Rust backend services
- Frontend development server
```

### **Production**
```
Kubernetes Cluster:
- Load balancer (Nginx/Traefik)
- Backend pods (auto-scaling)
- Database (managed PostgreSQL)
- Object storage (Cloudflare R2)
- CDN (Cloudflare)
- Monitoring (Prometheus/Grafana)
```

## **Migration Strategy**

### **Phase 1: Foundation**
1. Clean up legacy terminal code
2. Build REST API foundation
3. Create basic web frontend
4. Implement user authentication

### **Phase 2: Core Features**
1. Version upload and management
2. Audio streaming infrastructure
3. Basic version comparison
4. Search and discovery

### **Phase 3: Community**
1. Voting and ranking system
2. Comments and discussions
3. Artist tools and analytics
4. Advanced recommendation engine

## **Technology Stack**

### **Backend**
- **Language**: Rust (stable 1.85+)
- **Web Framework**: Axum
- **Database**: PostgreSQL 14+
- **Cache**: Redis
- **Audio**: Symphonia, Rodio, FFmpeg
- **Search**: Elasticsearch (optional)

### **Frontend**
- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **State Management**: Zustand/Redux Toolkit
- **Audio**: Web Audio API, Howler.js
- **UI Library**: Tailwind CSS, Headless UI

### **Infrastructure**
- **Container**: Docker + Kubernetes
- **Storage**: S3-compatible (Cloudflare R2)
- **CDN**: Cloudflare
- **Monitoring**: Prometheus, Grafana, Sentry
- **CI/CD**: GitHub Actions
