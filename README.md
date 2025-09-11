# 🎭 VERSIONS

**The version-centric music platform for discovering, comparing, and sharing different versions of songs.**

[![Build status](https://github.com/thisyearnofear/versions/actions/workflows/build.yml/badge.svg)](https://github.com/thisyearnofear/versions/actions)
[![crates.io](https://img.shields.io/crates/v/versions.svg)](https://crates.io/crates/versions)
[![MSRV](https://img.shields.io/badge/MSRV-1.85.0-blue)](https://releases.rs/docs/1.85.0/)

## 🎯 **What is VERSIONS?**

VERSIONS puts **song versions at the center** of music discovery. Instead of treating demos, remixes, and live recordings as afterthoughts, we make them the main attraction.

- **Version Timeline** - See how songs evolved from demo to final release
- **Split-Screen Comparison** - Play two versions simultaneously 
- **Community Curation** - Vote on the best versions, discover rare finds
- **Artist Workshop** - Musicians get feedback on works-in-progress

## 🚀 **Quick Start**

### **Requirements**
- **Rust 1.85.0+**
- **protobuf-compiler** (`brew install protobuf` on macOS)

### **Build & Run**
```bash
git clone https://github.com/thisyearnofear/versions.git
cd versions
make build

# Start the legacy TUI (for development)
./target/release/versions-tui

# Start the server
./target/release/versions-server
```

### **Development**
```bash
# Build with all features
make full

# Install binaries
make install

# Run tests
make test
```

## 🏗️ **Architecture**

VERSIONS is built as a modern web platform with a robust Rust backend:

```
Web Frontend ◄──► REST API ◄──► Audio Engine (Rust)
                     │
                 Database
```

### **Supported Formats**
- **Audio**: FLAC, MP3, M4A, WAV, OGG, AIFF, Opus
- **Backends**: Symphonia (default), MPV, GStreamer
- **Platforms**: macOS, Linux, Windows

## 📊 **Current Status**

**🔄 In Active Development** - Transforming from terminal music player to web platform

### **Phase 1: Foundation** (Current)
- ✅ Clean up legacy code
- ✅ Remove external API dependencies  
- 🔄 Build REST API foundation
- 🔄 Create web frontend

### **Phase 2: Core Features**
- 🔄 Version upload & management
- 🔄 Version comparison interface
- 🔄 User authentication
- 🔄 Basic community features

### **Phase 3: Community**
- 🔄 Version voting & ranking
- 🔄 Comments & discussions
- 🔄 Artist tools & analytics
- 🔄 Advanced discovery

## 🎵 **Key Concepts**

### **Version-First Data Model**
Every song is a collection of versions:
- **Demo** - Early rough recordings
- **Remix** - Alternative arrangements  
- **Live** - Concert performances
- **Alternative** - Different endings, arrangements
- **Remaster** - Updated audio quality

### **Community-Driven Discovery**
- **Version Similarity** - AI matches related versions
- **Democratic Ranking** - Community votes on quality
- **Collaborative Filtering** - Learn from listening patterns
- **Version Archaeology** - Discover rare/lost recordings

## 🤝 **Contributing**

We welcome contributions! VERSIONS follows these principles:

- **ENHANCEMENT FIRST** - Improve existing code before adding new features
- **AGGRESSIVE CONSOLIDATION** - Delete unnecessary code
- **PREVENT BLOAT** - Audit before adding features
- **CLEAN & MODULAR** - Clear separation of concerns

### **Areas We Need Help**
- 🎨 **Frontend Development** - React/Vue.js expertise
- 🎵 **Music Industry Knowledge** - Version types and relationships
- 🔍 **Search & Discovery** - Algorithm development
- 📱 **Mobile Development** - iOS/Android apps
- 🎯 **UX/UI Design** - Version comparison interfaces

### **Development Workflow**
1. Fork the repository
2. Create feature branch from `main`
3. Follow coding standards (`make lint`)
4. Add tests for new functionality
5. Submit pull request

## 📚 **Documentation**

- **[Technical Architecture](docs/ARCHITECTURE.md)** - System design and implementation
- **[API Reference](docs/API.md)** - REST API endpoints and usage
- **[Roadmap](docs/ROADMAP.md)** - Detailed development timeline

## 📄 **License**

- **MIT License** for core platform code
- **GPLv3** for podcast components (inherited from shellcaster)

## 🙏 **Acknowledgments**

VERSIONS builds upon [Termusic](https://github.com/tramhao/termusic) and the Rust audio ecosystem:
- [Symphonia](https://github.com/pdeljanov/Symphonia) - Audio decoding
- [Rodio](https://github.com/RustAudio/rodio) - Audio playback
- [tui-realm](https://github.com/veeso/tui-realm) - Terminal UI framework

---

**🎭 VERSIONS - Where every song tells multiple stories.**

*Join us in building the future of music discovery and community curation.*
