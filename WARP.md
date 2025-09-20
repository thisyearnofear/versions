# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

**VERSIONS** is a version-centric music platform with dual interfaces: professional terminal tools for creators and a community web platform with Farcaster social features. The platform puts song versions at the center of music discovery.

### Core Architecture

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

## Common Development Commands

### Build Commands
```bash
# Full workspace build
cargo build --all

# Development build
make build

# Release build with optimizations
cargo build --release --all
make release

# Build with all features (backends + cover)
make full

# Build specific components
cargo build -p termusic-server    # Server only
cargo build -p termusic           # TUI only
cargo build -p termusic-lib       # Library only
```

### Testing and Verification
```bash
# Verify all components build correctly
./scripts/verify_build.sh

# Test complete API with all endpoints
./scripts/test_server.sh

# Run unit tests
cargo test --all

# Run unit tests for specific component
cargo test -p termusic-server
```

### Running the Platform
```bash
# 1. Start the dual-interface server (required)
./target/debug/versions-server
# Server runs on http://localhost:8080 (gRPC + REST)

# 2. Web interface (community platform)
cd web && python3 -m http.server 3000
# Open http://localhost:3000

# 3. Terminal interface (professional tools)
./target/debug/versions-tui
```

### Development Workflow
```bash
# Format and check code
make fmt
# This runs: cargo fmt, cargo check, and cargo clippy

# Quick development cycle
cargo build --all && ./scripts/test_server.sh

# Add audio files for testing
cp your-music.mp3 audio_files/
```

## Architecture & Code Organization

### Rust Workspace Structure
- **`lib/`** - Shared library code with core data structures and utilities
- **`server/`** - Backend server providing both gRPC and REST APIs
- **`tui/`** - Terminal user interface for professional users
- **`playback/`** - Audio playback engine with multiple backend support
- **`web/`** - Static web assets for community platform

### Key Server Components
- **`server/src/rest_api.rs`** - REST API router with all endpoints
- **`server/src/audio_service.rs`** - Audio streaming with range request support
- **`server/src/farcaster_service.rs`** - Farcaster social integration
- **`server/src/filecoin_service.rs`** - Global storage and creator economy

### Web Interface Components
- **`web/index.html`** - Main application with terminal-style UI
- **`web/audio-player.js`** - Professional audio player with controls
- **`web/farcaster.js`** - Farcaster Mini App integration
- **`web/config.js`** - Environment configuration

## Core Principles

The codebase follows **8 Core Principles** that guide all development:

1. **ENHANCEMENT FIRST** - Improve existing code before adding new features
2. **AGGRESSIVE CONSOLIDATION** - Delete unnecessary code rather than deprecating
3. **PREVENT BLOAT** - Audit before adding features; minimal dependencies
4. **DRY** - Single source of truth for shared logic
5. **CLEAN** - Clear separation of concerns with explicit dependencies
6. **MODULAR** - Composable, testable, independent modules
7. **PERFORMANT** - Async throughout, caching, efficient operations
8. **ORGANIZED** - Predictable structure with domain-driven design

## API Structure

### REST API (Port 8080)
Base URL: `http://localhost:8080/api/v1`

**Core Endpoints:**
- `GET /health` - Health check
- `GET /songs` - List songs with versions
- `GET /songs/{id}` - Get specific song

**Audio Streaming:**
- `GET /audio/files` - List available audio files
- `GET /audio/{file_id}/metadata` - Get audio metadata  
- `GET /audio/{file_id}/stream` - Stream audio with range support
- `POST /audio/upload` - Upload new audio file

**Farcaster Integration:**
- `GET /farcaster/profile/{fid}` - Get user profile
- `POST /farcaster/cast` - Create cast
- `GET /farcaster/recommendations` - Social recommendations
- `GET /versions/{id}/discussions` - Version discussions

### Audio Formats Supported
MP3, FLAC, WAV, M4A, OGG, AIFF

## Key Technical Details

### Rust Version Requirements
- **MSRV**: 1.85.0
- **protobuf-compiler** required for build

### Backend Selection
The platform supports multiple audio backends:
```bash
# Default: Rusty (Rust-native)
cargo build

# GStreamer backend
make gst

# MPV backend  
make mpv

# All backends
make all-backends
```

### Performance Features
- **Range Requests**: Efficient audio streaming with HTTP range support
- **Metadata Caching**: Reduced file system access
- **Async Operations**: Non-blocking I/O throughout
- **Lazy Loading**: Components loaded only when needed

### Dual Interface Strategy
- **Terminal (TUI)**: Professional tools, CLI integration, batch operations
- **Web Platform**: Community features, social discovery, visual interfaces
- **Shared Backend**: Unified business logic via gRPC and REST APIs

## Development Environment Setup

### Prerequisites
```bash
# Install Rust 1.85.0+
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install protobuf compiler
# macOS:
brew install protobuf

# Ubuntu:
sudo apt install protobuf-compiler
```

### Quick Start
```bash
git clone https://github.com/thisyearnofear/versions.git
cd versions
make build
./scripts/verify_build.sh
./scripts/test_server.sh
```

## Debugging & Troubleshooting

### Common Build Issues
- Check Rust version: `rustc --version` (need 1.85.0+)
- Install protobuf: Missing protobuf-compiler causes build failures
- Port conflicts: Ensure ports 8080 (API) and 3000 (web) are available

### Testing Audio Features
```bash
# Add test audio files
cp /path/to/music.mp3 audio_files/

# Test audio endpoints
curl http://localhost:8080/api/v1/audio/files
curl http://localhost:8080/api/v1/audio/music/metadata
```

### Server Logs
The server provides detailed logging. Start with `RUST_LOG=info` for development:
```bash
RUST_LOG=info ./target/debug/versions-server
```

## File Locations

### Configuration
- `Cargo.toml` - Workspace configuration and dependencies
- `Makefile` - Build automation and common tasks
- `clippy.toml` - Rust linting configuration

### Documentation
- `README.md` - Project overview and quick start
- `docs/DEVELOPMENT.md` - Detailed architecture and contributing guide
- `docs/API_REFERENCE.md` - Complete REST API documentation
- `docs/GETTING_STARTED.md` - Setup and usage instructions

### Scripts
- `scripts/verify_build.sh` - Build verification
- `scripts/test_server.sh` - API integration testing

## Context for Future Development

### Current Status (Functional Platform)
✅ Audio streaming with range requests  
✅ Farcaster Mini App integration  
✅ Dual interface architecture working  
✅ REST API with all core endpoints  

### In Development
🔄 Version comparison interface  
🔄 Database integration (replace mock data)  
🔄 Enhanced search and discovery  

### Version-Centric Data Model
Every song is a collection of versions:
- **Demo** - Early recordings
- **Studio** - Official releases  
- **Live** - Concert performances
- **Remix** - Alternative arrangements
- **Remaster** - Updated audio quality
- **Acoustic** - Stripped-down versions

This version-centric approach is the core differentiator and should guide all feature development.