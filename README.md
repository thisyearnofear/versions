# 🎭 VERSIONS

<!-- Test webhook deployment - 2025-09-20 -->

**Version-centric music platform with unified web interface: professional terminal-like tools + community features with Farcaster social integration.**

[![Build status](https://github.com/thisyearnofear/versions/actions/workflows/build.yml/badge.svg)](https://github.com/thisyearnofear/versions/actions)
[![crates.io](https://img.shields.io/crates/v/versions.svg)](https://crates.io/crates/versions)
[![MSRV](https://img.shields.io/badge/MSRV-1.85.0-blue)](https://releases.rs/docs/1.85.0/)

## 🎯 **What is VERSIONS?**

VERSIONS puts **song versions at the center** of music discovery with a **unified web interface** that combines **professional tools** and **Web3-native social features**:

### **🖥️ Professional Tools (Terminal-Style)**
- **Terminal-Like UX** - Familiar command-line interface in browser
- **Audio Analysis** - Advanced version comparison and processing
- **Batch Operations** - Efficient multi-file operations
- **Power User Features** - Professional creator workflows

### **🌐 Community Features**
- **Audio Streaming** - Professional player with range request support
- **Farcaster Integration** - Web3-native social discovery and Mini App
- **Version Discovery** - Interactive sidebar with trending versions
- **Social Recommendations** - Community-driven discovery through social graph
- **Terminal-Style UX** - Professional command-like interface in browser

### **🟣 Farcaster Mini App**  
- **Native Integration** - Built-in Farcaster Mini App support
- **Social Discovery** - Version recommendations from social graph
- **Community Curation** - Trending versions and social voting
- **Real-time Activity** - Live social indicators and friend activity

## 🚀 **Quick Start**

### **Requirements**
- **Rust 1.85.0+** - [Install Rust](https://rustup.rs/)
- **protobuf-compiler** - `brew install protobuf` (macOS) or `sudo apt install protobuf-compiler` (Ubuntu)

### **Installation & Setup**
```bash
git clone https://github.com/thisyearnofear/versions.git
cd versions

# Build complete Rust workspace
make full-build
```

### **Running VERSIONS**
```bash
# 1. Start the server (required)
./target/debug/versions-server
# Server runs on http://localhost:8080

# 2. Web interface (unified platform)
cd web && python3 -m http.server 3000
# Open http://localhost:3000

# 3. Future: WASM terminal interface
# Coming: Same Rust code running in browser and terminal
```

### **First Steps**
```bash
# Test the complete system
./scripts/test_server.sh

# Add audio files
cp your-music.mp3 audio_files/

# Verify complete build
make verify-build
```

## 🏗️ **Architecture**

Unified web interface architecture with Rust backend:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Unified Web Interface                        │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Terminal-Style UI   │  │       Community Platform         │ │
│  │  Professional Tools  │  │   Social Features & Discovery    │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   gRPC + REST    │    │  Audio Engine   │    │   Farcaster     │
│     Server       │◄──►│   (Rust)        │    │ Social Layer    │
│                  │    │                 │    │                 │
└──────────────────┘    └─────────────────┘    └─────────────────┘
```

### **Core Features**
- **Audio Formats**: MP3, FLAC, WAV, M4A, OGG, AIFF
- **Streaming**: Range request support for efficient playback
- **Social Integration**: Native Farcaster Mini App
- **Unified Interface**: Terminal-like tools + Community platform in browser
- **Version-Centric**: Unique approach to music organization
- **Rust-First Platform**: Single language, unified architecture

## 📊 **Current Status**

**🎵 Functional Music Platform** - Audio streaming and Farcaster social features operational

### **✅ Completed Features**
- **Audio Streaming**: Professional player with range request support
- **Unified Web Interface**: Terminal-style UX with version discovery sidebar
- **Farcaster UI Framework**: Social integration interface ready
- **REST API**: Complete endpoints for audio streaming and version management
- **File Management**: Upload, stream, and organize audio files
- **Theme Integration**: Terminal-style design with CSS theming system

### **🔄 In Development**
- **Database Integration**: Replace mock data with persistent storage
- **Farcaster API Integration**: Connect UI framework to real Farcaster APIs
- **Version Comparison**: Functional side-by-side audio analysis
- **Enhanced Search**: Advanced discovery and filtering features

### **📋 Planned**
- **WASM Terminal**: Unified terminal interface in browser
- **Blockchain Integration**: Arbitrum L2 for ownership
- **Creator Economy**: Direct fan funding
- **Advanced Audio**: Waveform analysis and sync playback

## 🛠️ **Development Workflow**

### **Unified Web Platform**
The web interface uses modern HTML/CSS/JavaScript with a terminal-inspired design:

```bash
# Build complete Rust workspace
make full-build

# Start development
./target/debug/versions-server &
cd web && python3 -m http.server 3000
```

### **File Structure**
```
web/
├── index.html              # Main unified interface
├── theme-bridge.js         # Terminal theme integration
└── _redirects              # Netlify deployment config
```

### **Rust-First Development**
- **Single Language**: Rust for both backend and future WASM frontend
- **Unified Types**: Shared data structures across the platform
- **Performance**: Direct Rust-to-WASM compilation path
- **Simplicity**: No build toolchain complexity

## 🎵 **Key Concepts**

### **Version-Centric Approach**
Every song is a collection of versions:
- **Demo** - Early recordings and rough cuts
- **Studio** - Official album releases
- **Live** - Concert performances
- **Remix** - Alternative arrangements
- **Remaster** - Updated audio quality
- **Acoustic** - Stripped-down versions

### **Social Discovery**
- **Farcaster Integration** - Web3-native social features
- **Community Curation** - Social voting and recommendations
- **Version Archaeology** - Discover rare recordings through social graph
- **Artist Engagement** - Direct creator-fan interactions

## 🤝 **Contributing**

VERSIONS follows **8 Core Principles** that guide all development:

- **ENHANCEMENT FIRST** - Improve existing code before adding new features
- **AGGRESSIVE CONSOLIDATION** - Delete unnecessary code
- **PREVENT BLOAT** - Audit before adding features
- **DRY** - Single source of truth for shared logic
- **CLEAN** - Clear separation of concerns
- **MODULAR** - Composable, testable components
- **PERFORMANT** - Efficient operations and caching
- **ORGANIZED** - Predictable structure and documentation

### **How to Contribute**
1. **Read**: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for detailed guidelines
2. **Fork**: Create your own repository fork
3. **Follow**: Core Principles in all changes
4. **Test**: Add tests and verify builds
5. **Submit**: Pull request with clear description

## 📚 **Documentation**

- **[Getting Started](docs/GETTING_STARTED.md)** - Setup, installation, and basic usage
- **[API Reference](docs/API_REFERENCE.md)** - Complete REST API documentation
- **[Development Guide](docs/DEVELOPMENT.md)** - Architecture, principles, and contributing

## 📄 **License**

- **MIT License** for core platform code
- **GPLv3** for podcast components (inherited from shellcaster)

## 🙏 **Acknowledgments**

Built on [Termusic](https://github.com/tramhao/termusic) and the Rust audio ecosystem:
- [Symphonia](https://github.com/pdeljanov/Symphonia) - Audio decoding
- [Axum](https://github.com/tokio-rs/axum) - Web framework
- [Farcaster](https://farcaster.xyz) - Decentralized social protocol

---

**🎭 VERSIONS - Version-centric music discovery with Web3-native social features.**
