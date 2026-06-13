# 🎭 VERSIONS

**⚛️ Lepton Agents Hackathon 2026 - Nanopayments for the Creator Economy**

**The Micro-Settlement Sidecar: Monetizing the creative process through per-second royalties on the Arc L1.**

---

## 🏆 Current Focus: Lepton Hackathon (June 15-29, 2026)

VERSIONS is pivoting from a standalone music platform into a **Settlement Sidecar**. We are building a "shim" that attaches to existing open-source media stacks (Audius, Subsonic, Navidrome) to enable nanopayments ($0.0001/sec) that were previously uneconomic.

**[⚛️ Lepton Strategy & Roadmap](docs/LEPTON_STRATEGY.md)** | **[📺 Watch 3-Minute Demo Video](#)**

### The Lepton Vision
- **Nanopayments**: Move value "too small to have been worth moving before" using USDC on Arc L1.
- **Sidecar Architecture**: Don't build a new silo; enhance the existing creator stack.
- **Settlement-Grade Events**: Convert audio playback "scrobbles" into instant creator payouts.

---

## 💡 The Concept

Every song has multiple versions - demos, studio recordings, live performances, remixes. **VERSIONS** treats the creative process as a stream of value. 

### The Problem
- **The $2.00 Floor**: Traditional payment rails (Stripe/PayPal) make micro-royalties impossible.
- **The Silo Problem**: Creators are forced into closed platforms to monetize.
- **The "Dead" Version**: Demos and rough cuts are rarely monetized because the overhead is too high.

### The Solution
- **Arc L1 Integration**: Instant (<500ms) settlement of sub-cent values.
- **Subsonic Sidecar**: A protocol-level adapter that adds payments to *any* music app.
- **MusicBrainz Mapping**: Automated payee discovery via global metadata standards.

---

## ✨ Features

✅ **Nanopayment Settlement** - Per-second royalty engine (Arc L1 + USDC)  
✅ **Subsonic Sidecar** - Protocol adapter for universal app compatibility  
✅ **Audius Integration** - Real trending tracks from Audius API  
✅ **Farcaster Mini App** - Social discovery and "One-Click Settlement"  
✅ **Professional Rust Backend** - High-performance audio engine and gRPC server  
✅ **WASM Readiness** - Browser-side settlement and playback  

---

## 🏗️ Architecture: The Sidecar Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Existing Media Apps (DSub, etc.)             │
└─────────────────────────────────────────────────────────────────┘
                                │
                    (Subsonic Protocol Hook)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VERSIONS SETTLEMENT SIDECAR                  │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │   Protocol Adapter   │  │       Settlement Engine          │ │
│  │   (Subsonic/gRPC)    │  │       (Arc L1 / USDC)            │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Audius API     │    │   MusicBrainz   │    │   Farcaster     │
│  (Track Source)  │    │   (Payee Reg)   │    │ (Social Layer)  │
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
