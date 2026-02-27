# 🛠️ VERSIONS - Developer Guide

## **Architecture Overview**

VERSIONS follows a **dual-interface architecture** with shared backend services, designed for both professional creators and community users.

### **System Architecture**
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Terminal (TUI) │    │   gRPC + REST    │    │  Audio Engine   │
│ Professional    │◄──►│     Server       │◄──►│   (Rust)        │
│    Tools        │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
┌─────────────────┐             │               ┌─────────────────┐
│  Web Frontend   │◄────────────┘               │   Farcaster     │
│ + Solana        │                             │ Social Layer    │
 │ Wallet          │◄────────────────────────────┤                 │
 └─────────────────┘                             └─────────────────┘
                                │
                    ┌───────────────────────────┐
                    │      Audius               │
                    │  + Solana Artist Coins   │
                    │ (Ticket Validation)      │
                    └───────────────────────────┘
```

### **Core Components**
- **Audio Service**: Streaming, metadata, file management
- **Farcaster Service**: Social integration, authentication, casting
- **REST API**: Web interface and external integrations
- **gRPC Server**: Terminal interface and professional tools
- **Web Interface**: Community platform with audio player
- **Audius Service**: Track fetching, artist data, Artist Coin integration
- **Solana Service**: Wallet connection, coin ownership validation

## **Core Principles**

VERSIONS follows **8 Core Principles** that guide all development decisions:

### **1. ENHANCEMENT FIRST**
Always prioritize enhancing existing components over creating new ones.
- **Application**: New features extend current services, not replace them
- **Hackathon**: Audius integration extends audio service, not replaces it

### **2. AGGRESSIVE CONSOLIDATION**
Delete unnecessary code rather than deprecating it.
- **Application**: Remove dead code, merge duplicate endpoints
- **Hackathon**: Demo uses existing infrastructure, no new services created

### **3. PREVENT BLOAT**
Systematically audit and consolidate before adding new features.
- **Application**: Each feature must justify its existence
- **Hackathon**: Separate demo file prevents main app bloat

### **4. DRY (Don't Repeat Yourself)**
Single source of truth for all shared logic.
- **Application**: Shared types in `lib/`, services in `server/src/`
- **Hackathon**: Uses existing audio service, REST API patterns

### **5. CLEAN**
Clear separation of concerns with explicit dependencies.
- **Application**: Service modules have single responsibility
- **Hackathon**: `audius-solana.js` handles only wallet/coin logic

### **6. MODULAR**
Composable, testable, independent modules.
- **Application**: Each service can be tested independently
- **Hackathon**: Demo imports integration, can be removed entirely

### **7. PERFORMANT**
Adaptive loading, caching, and resource optimization.
- **Application**: Range requests, metadata caching, async throughout
- **Hackathon**: Lazy-loads Audius data, caches wallet state

### **8. ORGANIZED**
Predictable file structure with domain-driven design.
- **Application**: Clear directory structure, consistent naming
- **Hackathon**: Follows existing `web/` patterns, uses `.js` not `.ts`

## **How to Apply Principles**

When contributing or adding features:

1. **ENHANCEMENT FIRST**: Can this be an extension?
2. **AGGRESSIVE CONSOLIDATION**: What's being removed?
3. **PREVENT BLOAT**: Is this feature necessary?
4. **DRY**: Where's the single source of truth?
5. **CLEAN**: What does this module own?
6. **MODULAR**: Can it be tested in isolation?
7. **PERFORMANT**: What's being cached/optimized?
8. **ORGANIZED**: Where does this file belong?

### **Code Review Checklist**

```rust
/// MODULAR: Clear function purpose
/// PERFORMANT: Caching strategy explained
/// CLEAN: Explicit dependency injection
fn example() {
    // PRINCIPLE: Tag code with which principle it follows
}
```

## **Development Workflow**

### **Setting Up Development Environment**
```bash
# Clone and setup
git clone https://github.com/thisyearnofear/versions.git
cd versions

# Install dependencies
rustup update
brew install protobuf  # macOS
# or sudo apt install protobuf-compiler  # Ubuntu

# Build and test
make build
./verify_build.sh
./test_server.sh
```

### **Development Commands**
```bash
# Build specific components
cargo build -p termusic-server    # Server only
cargo build -p termusic           # TUI only
cargo build -p termusic-lib       # Library only

# Development builds
cargo build --all                 # All components
make full                         # Full build with features

# Testing
cargo test --all                  # Unit tests
./test_server.sh                  # Integration tests
./verify_build.sh                 # Build verification

# Release builds
cargo build --release --all       # Optimized builds
```

## **API Reference**

### **Base URL**: `http://localhost:8080/api/v1`

### **🔊 Audio Streaming**
- `GET /audio/files` - List audio files
- `GET /audio/{file_id}/metadata` - Get audio metadata
- `GET /audio/{file_id}/stream` - Stream audio (supports range requests)
- `POST /audio/upload` - Upload audio file

### **🟣 Farcaster Integration**
- `GET /farcaster/profile/{fid}` - Get user profile
- `POST /farcaster/cast` - Create cast
- `GET /farcaster/recommendations?fid={fid}` - Get recommendations
- `GET /versions/{version_id}/discussions` - Get discussions

### **🎭 Core Platform**
- `GET /health` - Health check
- `GET /songs` - List songs with versions
- `GET /songs/{song_id}` - Get specific song
- `GET /search?q={query}` - Search (placeholder)

### **Supported Audio Formats**
- MP3 (`audio/mpeg`) - Universal compatibility
- FLAC (`audio/flac`) - Lossless quality
- WAV (`audio/wav`) - Uncompressed
- M4A (`audio/mp4`) - Apple format
- OGG (`audio/ogg`) - Open source
- AIFF (`audio/aiff`) - Professional

### **HTTP Status Codes**
- **200 OK**: Successful request
- **206 Partial Content**: Successful range request (audio streaming)
- **400 Bad Request**: Invalid request format or parameters
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

## **Code Organization**

**ORGANIZED**: Predictable file structure following domain-driven design

```
versions/
├── lib/                         # DRY: Shared types and logic
│   └── src/
│       ├── track.rs            # Core music data structures
│       ├── onchain.rs         # Blockchain integration (stub)
│       └── distributed.rs     # IPFS and P2P features
├── server/                     # MODULAR: Independent services
│   ├── src/
│   │   ├── audio_service.rs   # CLEAN: Single responsibility
│   │   ├── farcaster_service.rs
│   │   ├── rest_api.rs        # PERFORMANT: Async endpoints
│   │   └── server.rs
│   └── migrations/             # ORGANIZED: Schema versioning
├── web/                        # CONSOLIDATED: Single frontend
│   ├── index.html             # ENHANCEMENT FIRST: Main app
│   ├── hackathon-demo.html    # PREVENT BLOAT: Separate demo
│   ├── audius-solana.js       # MODULAR: Pluggable integration
│   ├── farcaster-miniapp.js
│   └── theme-bridge.js
└── docs/                       # DRY: Single source of truth
```

## **Contributing Guidelines**

### **Before Contributing**
1. **Read Core Principles**: Understand and follow all 8 principles
2. **Check Existing Issues**: Avoid duplicate work
3. **Discuss Major Changes**: Open an issue for architectural changes

### **Development Process**
1. **Fork Repository**: Create your own fork
2. **Create Feature Branch**: `git checkout -b feature/your-feature`
3. **Follow Principles**: Ensure code follows Core Principles
4. **Add Tests**: Include tests for new functionality
5. **Update Documentation**: Keep docs current
6. **Submit PR**: Clear description of changes

### **Code Standards**
```rust
// CLEAN: Clear function signatures with documentation
/// MODULAR: Get audio metadata with caching
pub async fn get_audio_metadata(&mut self, file_id: &str) -> Result<AudioMetadata> {
    // PERFORMANT: Check cache first
    if let Some(metadata) = self.metadata_cache.get(file_id) {
        return Ok(metadata.clone());
    }

    // ENHANCEMENT FIRST: Build on existing patterns
    let metadata = self.extract_metadata(file_id).await?;

    // PERFORMANT: Cache the result
    self.metadata_cache.insert(file_id.to_string(), metadata.clone());
    Ok(metadata)
}
```

### **Commit Message Format**
```
type(scope): description

PRINCIPLE: Explanation of how this follows Core Principles

Examples:
feat(audio): add range request support for streaming
PERFORMANT: Enables efficient partial content delivery

fix(farcaster): resolve authentication timeout
CLEAN: Improved error handling and user feedback

refactor(api): consolidate duplicate endpoint logic
DRY: Single source of truth for response formatting
```

## **Current Status & Roadmap**

### **🎯 Active: Solana Graveyard Hackathon (Feb 12-27, 2026)**

**Track:** Music (Audius) - "Versions of a song as tickets"

**Concept:** Each song version is tied to an Audius Artist Coin. Ownership of the coin grants access to stream that version - creating a "ticket" system where song versions are collectible assets.

**Submission Requirements:**
- Built on Solana ✓ (existing Rust/Solana compatibility)
- Working demo/prototype
- 3-min video walkthrough
- GitHub repo with source code
- Team size: 1-5 members

**Prize:** $2,000 (1st) / $1,000 (2nd) in Audius track

### **✅ Completed (Functional Platform)**
- **Audio Streaming Foundation**: Complete with range requests
- **Farcaster Mini App Integration**: Social features operational
- **Web Interface**: Professional audio player with controls
- **Dual-Interface Architecture**: Terminal + Web working together
- **REST API**: Complete endpoints for current features

### **🔄 In Progress**
- **Version Comparison Interface**: Side-by-side audio comparison
- **Database Integration**: Replace mock data with PostgreSQL
- **Enhanced Search**: Full-text search and filtering

### **📋 Planned Features (Hackathon Priority)**
- **Audius Integration**: SDK integration for track fetching and Artist Coins
- **Solana Ticket Validation**: Verify coin ownership for version access
- **Version-Coin Mapping**: Link song versions to specific artist coins
- **Creator Dashboard**: Simple UI for linking versions to Audius tracks

### **🎯 Next Milestones (Hackathon Sprint)**
1. **Audius SDK Integration** (1 week): Fetch tracks, authenticate users
2. **Solana Wallet Connection** (1 week): Connect wallet, verify coin ownership
3. **Version-Ticket Mapping** (1 week): Link versions to artist coins
4. **Demo & Video** (3 days): Working prototype + 3-min walkthrough
5. **Submit** (Feb 27, 2026): Deadline for submissions

## **Technical Decisions**

### **Technology Choices**
- **Rust**: Performance, safety, excellent async support
- **Axum**: Modern, fast web framework with good ecosystem
- **Symphonia**: Comprehensive audio format support
- **Farcaster**: Web3-native social layer, growing ecosystem
- **PostgreSQL**: Robust relational database for version relationships
- **Solana**: Blockchain for Artist Coin ticket validation
- **Audius SDK**: Music protocol integration for track/artist data

### **Architecture Decisions**
- **Dual Interface**: Serves both professional and community users
- **Shared Backend**: DRY principle, consistent business logic
- **Modular Services**: Clean separation, independent development
- **Version-Centric Data Model**: Unique approach to music organization

### **Performance Optimizations**
- **Range Requests**: Efficient audio streaming
- **Metadata Caching**: Reduced file system access
- **Async Throughout**: Non-blocking operations
- **Lazy Loading**: Load components only when needed

## **Testing Strategy**

### **Unit Tests**
```bash
# Run all unit tests
cargo test --all

# Test specific component
cargo test -p termusic-server
```

### **Integration Tests**
```bash
# Test complete API
./test_server.sh

# Test build process
./verify_build.sh
```

### **Manual Testing**
```bash
# Start server
./target/debug/versions-server

# Test web interface
cd web && python3 -m http.server 3000

# Test terminal interface
./target/debug/versions-tui
```

## **Troubleshooting**

### **Common Issues**
- **Build Failures**: Check Rust version (1.85.0+) and protobuf installation
- **Port Conflicts**: Ensure ports 8080 and 3000 are available
- **Audio Issues**: Verify file permissions and supported formats
- **Farcaster Issues**: Check manifest accessibility and domain configuration

---

**🛠️ Building the future of version-centric music discovery!**