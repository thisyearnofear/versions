# 🛠️ VERSIONS - Development Guide

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
│ + Farcaster     │                             │ Social Layer    │
│ Mini App        │◄────────────────────────────┤                 │
└─────────────────┘                             └─────────────────┘
```

### **Core Components**
- **Audio Service**: Streaming, metadata, file management
- **Farcaster Service**: Social integration, authentication, casting
- **REST API**: Web interface and external integrations
- **gRPC Server**: Terminal interface and professional tools
- **Web Interface**: Community platform with audio player

## **Core Principles**

VERSIONS follows **8 Core Principles** that guide all development decisions:

### **1. ENHANCEMENT FIRST**
Always prioritize enhancing existing components over creating new ones.
- Build on existing foundation rather than starting from scratch
- Extend current functionality before adding new features
- Improve what works rather than replacing it

### **2. AGGRESSIVE CONSOLIDATION**
Delete unnecessary code rather than deprecating it.
- Remove dead code immediately
- Consolidate duplicate functionality
- Eliminate unused dependencies and imports

### **3. PREVENT BLOAT**
Systematically audit and consolidate before adding new features.
- Add minimal dependencies only when necessary
- Use feature flags for optional functionality
- Regular dependency audits and cleanup

### **4. DRY (Don't Repeat Yourself)**
Single source of truth for all shared logic.
- Shared services and utilities
- Unified configuration system
- Common data structures and interfaces

### **5. CLEAN**
Clear separation of concerns with explicit dependencies.
- Modular architecture with defined boundaries
- Explicit interfaces between components
- Clear error handling and logging

### **6. MODULAR**
Composable, testable, independent modules.
- Services can be developed and tested independently
- Clear APIs between modules
- Dependency injection for testability

### **7. PERFORMANT**
Adaptive loading, caching, and resource optimization.
- Async/await throughout for non-blocking operations
- Intelligent caching strategies
- Efficient streaming and data transfer

### **8. ORGANIZED**
Predictable file structure with domain-driven design.
- Consistent naming conventions
- Logical directory structure
- Comprehensive documentation

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

### **Code Organization**
```
versions/
├── lib/                    # Shared library code
│   ├── src/
│   │   ├── track.rs       # Core music data structures
│   │   ├── onchain.rs     # Blockchain integration
│   │   └── distributed.rs # IPFS and P2P features
├── server/                 # Backend server
│   ├── src/
│   │   ├── audio_service.rs      # Audio streaming
│   │   ├── farcaster_service.rs  # Social integration
│   │   ├── rest_api.rs          # REST endpoints
│   │   └── server.rs            # Main server
├── tui/                    # Terminal interface
├── web/                    # Web interface + Farcaster Mini App
│   ├── audio-player.js    # Audio player component
│   ├── farcaster.js       # Farcaster integration
│   └── config.js          # Environment configuration
└── docs/                   # Documentation
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

### **📋 Planned Features**
- **Advanced Audio Analysis**: Waveform visualization, sync playback
- **Enhanced TUI**: Professional terminal tools for creators
- **Blockchain Integration**: Arbitrum L2 for version ownership
- **Creator Economy**: Direct fan funding and royalty distribution

### **🎯 Next Milestones**
1. **Version Comparison** (2 weeks): Core feature for comparing versions
2. **Database Layer** (3 weeks): Persistent storage and real data
3. **Enhanced Search** (2 weeks): Advanced discovery features
4. **Mobile Optimization** (2 weeks): Better responsive design

## **Technical Decisions**

### **Technology Choices**
- **Rust**: Performance, safety, excellent async support
- **Axum**: Modern, fast web framework with good ecosystem
- **Symphonia**: Comprehensive audio format support
- **Farcaster**: Web3-native social layer, growing ecosystem
- **PostgreSQL**: Robust relational database for version relationships

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

## **Deployment**

### **Development Deployment**
- **Backend**: Local development server
- **Frontend**: Python HTTP server or live-server
- **Database**: SQLite for local development

### **Production Deployment**
- **Backend**: Heroku, Railway, Fly.io, or VPS
- **Frontend**: Netlify, Vercel, or CDN
- **Database**: PostgreSQL on cloud provider
- **Audio Storage**: S3, IPFS, or local storage

### **Environment Configuration**
```javascript
// web/config.js
const config = {
  development: {
    domain: 'localhost:3000',
    apiBase: 'http://localhost:8080'
  },
  production: {
    domain: 'versions.app',
    apiBase: 'https://api.versions.app'
  }
};
```

## **Troubleshooting**

### **Common Issues**
- **Build Failures**: Check Rust version (1.85.0+) and protobuf installation
- **Port Conflicts**: Ensure ports 8080 and 3000 are available
- **Audio Issues**: Verify file permissions and supported formats
- **Farcaster Issues**: Check manifest accessibility and domain configuration

---

**🛠️ Building the future of version-centric music discovery!**