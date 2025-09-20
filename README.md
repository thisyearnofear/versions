# 🎭 VERSIONS

**Version-centric music platform with dual interfaces: professional terminal tools for creators, community web platform with Farcaster social features.**

[![Build status](https://github.com/thisyearnofear/versions/actions/workflows/build.yml/badge.svg)](https://github.com/thisyearnofear/versions/actions)
[![crates.io](https://img.shields.io/crates/v/versions.svg)](https://crates.io/crates/versions)
[![MSRV](https://img.shields.io/badge/MSRV-1.85.0-blue)](https://releases.rs/docs/1.85.0/)

## 🎯 **What is VERSIONS?**

VERSIONS puts **song versions at the center** of music discovery with **dual interfaces** and **Web3-native social features**:

### **🖥️ Terminal Interface (Professional)**
- **Local Management** - Privacy-first file system integration
- **CLI Integration** - Script-friendly commands for creators
- **Batch Operations** - Efficient multi-file processing
- **Power Tools** - Advanced audio analysis and comparison

### **🌐 Web Interface (Community)**
- **Audio Streaming** - Professional player with range request support
- **Farcaster Integration** - Web3-native social discovery
- **Version Comparison** - Side-by-side audio analysis
- **Social Curation** - Community-driven version discovery

### **🟣 Farcaster Mini App**
- **Social Authentication** - Sign in with Farcaster
- **Version Discovery Casting** - Share discoveries to social feeds
- **Social Recommendations** - Music suggestions from social graph
- **Community Discussions** - Farcaster-based conversations

## 🚀 **Quick Start**

### **Requirements**
- **Rust 1.85.0+** - [Install Rust](https://rustup.rs/)
- **Node.js 16+** - For TypeScript web interface
- **protobuf-compiler** - `brew install protobuf` (macOS) or `sudo apt install protobuf-compiler` (Ubuntu)

### **Installation & Setup**
```bash
git clone https://github.com/thisyearnofear/versions.git
cd versions

# Install web dependencies
make web-install

# Build everything (Rust + TypeScript)
make full-build
```

### **Running VERSIONS**
```bash
# 1. Start the server (required)
./target/debug/versions-server
# Server runs on http://localhost:8080

# 2a. Web interface - Development with TypeScript watch
make web-dev
# Opens http://localhost:3000 with live reloading

# 2b. Web interface - Production (static files)
cd web && python3 -m http.server 3000
# Open http://localhost:3000

# 3. Terminal interface (professional tools)
./target/debug/versions-tui
```

### **First Steps**
```bash
# Test the complete system (Rust + TypeScript)
./scripts/test_server.sh

# Add audio files
cp your-music.mp3 audio_files/

# Verify complete build
make verify-build
```

## 🏗️ **Architecture**

Dual-interface architecture with shared Rust backend:

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

### **Core Features**
- **Audio Formats**: MP3, FLAC, WAV, M4A, OGG, AIFF
- **Streaming**: Range request support for efficient playback
- **Social Integration**: Native Farcaster Mini App
- **Dual Interface**: Terminal tools + Web community platform
- **Version-Centric**: Unique approach to music organization
- **TypeScript Web Interface**: Type-safe, modern frontend development

## 📊 **Current Status**

**🎵 Functional Music Platform** - Audio streaming and Farcaster social features operational

### **✅ Completed Features**
- **Audio Streaming**: Professional player with range request support
- **Farcaster Mini App**: Native Web3 social integration
- **Dual Interface**: Terminal + Web platforms working together
- **REST API**: Complete endpoints for audio and social features
- **File Management**: Upload, stream, and organize audio files

### **🔄 In Development**
- **Version Comparison**: Side-by-side audio analysis
- **Database Integration**: Persistent storage layer
- **Enhanced Search**: Advanced discovery features
- **Mobile Optimization**: Better responsive design

### **📋 Planned**
- **Enhanced TUI**: Professional terminal tools
- **Blockchain Integration**: Arbitrum L2 for ownership
- **Creator Economy**: Direct fan funding
- **Advanced Audio**: Waveform analysis and sync playback

## 🛠️ **Development Workflow**

### **TypeScript Web Interface**
The web interface is built with TypeScript for type safety and better development experience:

```bash
# Development with live reloading
make web-dev

# Build TypeScript to JavaScript
make web-build

# Clean build artifacts
make web-clean

# Install/update dependencies
make web-install
```

### **File Structure**
```
web/
├── src/                    # TypeScript source files
│   ├── audio-player.ts     # Audio playback with type safety
│   ├── config.ts           # Environment configuration
│   ├── farcaster.ts        # Social integration
│   ├── wallet-connection.ts # Web3 wallet support
│   ├── filecoin-integration.ts # Global storage
│   └── shared/types/       # Shared type definitions
├── dist/                   # Compiled JavaScript (auto-generated)
├── index.html              # Main web interface
├── package.json            # Node.js dependencies
└── tsconfig.json           # TypeScript configuration
```

### **Type-Safe Development**
- **Shared Types**: Common interfaces between frontend and backend
- **API Integration**: Type-safe REST API client calls
- **Modern ES6+**: Latest JavaScript features with compatibility
- **Development Server**: Live reloading for rapid iteration

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
