# 🚀 VERSIONS - Getting Started

## **Quick Start**

VERSIONS is a version-centric music platform with dual interfaces: professional terminal tools and community web platform, enhanced with Farcaster social features.

### **Requirements**
- **Rust 1.85.0+** - [Install Rust](https://rustup.rs/)
- **protobuf-compiler** - `brew install protobuf` (macOS) or `sudo apt install protobuf-compiler` (Ubuntu)
- **Node.js 22.11.0+** (for web interface) - [Install Node.js](https://nodejs.org/)

### **Installation**
```bash
git clone https://github.com/thisyearnofear/versions.git
cd versions
make build
```

### **Running VERSIONS**

#### **1. Start the Server (Required)**
```bash
# Start the dual-interface server (gRPC + REST API)
./target/debug/versions-server
# Server runs on http://localhost:8080
```

#### **2. Web Interface (Community Platform)**
```bash
# In a new terminal
cd web && python3 -m http.server 3000
# Open http://localhost:3000
```

#### **3. Terminal Interface (Professional Tools)**
```bash
# In a new terminal
./target/debug/versions-tui
```

### **First Steps**

#### **Test the System**
```bash
# Verify all components work
./test_server.sh
```

#### **Add Audio Files**
```bash
# Place audio files in the audio_files directory
cp your-music.mp3 audio_files/
# Supported: MP3, FLAC, WAV, M4A, OGG, AIFF
```

#### **Web Interface Features**
1. **Audio Player**: Professional controls with metadata display
2. **Farcaster Integration**: Sign in with Farcaster for social features
3. **File Management**: List and play available audio files
4. **Social Discovery**: Cast version discoveries to Farcaster

#### **Terminal Interface Features**
1. **Local Music Management**: Browse and play local files
2. **Batch Operations**: Professional tools for music creators
3. **CLI Integration**: Script-friendly commands

## **Core Concepts**

### **Version-Centric Approach**
Every song is a collection of versions:
- **Demo** - Early recordings and rough cuts
- **Studio** - Official album releases
- **Live** - Concert performances
- **Remix** - Alternative arrangements
- **Remaster** - Updated audio quality
- **Acoustic** - Stripped-down versions

### **Dual Interface Strategy**
- **Terminal (TUI)**: Professional tools for creators and power users
- **Web Platform**: Community features and social discovery
- **Shared Backend**: Unified data and business logic

### **Farcaster Integration**
- **Web3-Native Social**: Built on decentralized social protocol
- **Version Discovery**: Share and discover versions through social graph
- **Community Curation**: Social voting and recommendations
- **Artist Engagement**: Direct creator-fan interactions

## **Basic Usage**

### **Playing Music**

#### **Web Interface**
1. Open http://localhost:3000
2. Click "📁 List Audio Files" to see available music
3. Click ▶️ next to any file to play
4. Use the bottom player controls for playback

#### **Terminal Interface**
1. Run `./target/debug/versions-tui`
2. Navigate with arrow keys
3. Press Enter to play selected track
4. Use standard media keys for control

### **Farcaster Features**

#### **Authentication**
1. In web interface, click "🔗 Sign In with Farcaster"
2. Complete authentication in Farcaster client
3. Access social features and recommendations

#### **Sharing Discoveries**
1. Authenticate with Farcaster
2. Click "📢 Cast Discovery" to share a version
3. View social recommendations from your network

### **File Management**

#### **Adding Audio Files**
```bash
# Copy files to audio directory
cp /path/to/your/music.mp3 audio_files/song-name.mp3

# Or upload via API
curl -X POST http://localhost:8080/api/v1/audio/upload \
  -H "Content-Type: application/json" \
  -d '{"file_id":"new-song","content":"base64_data","format":"mp3"}'
```

#### **Supported Formats**
- **MP3** - Universal compatibility
- **FLAC** - Lossless quality
- **WAV** - Uncompressed audio
- **M4A** - Apple format
- **OGG** - Open source format
- **AIFF** - Professional format

## **Configuration**

### **Environment Setup**
```bash
# Development (default)
# API: http://localhost:8080
# Web: http://localhost:3000

# Production
# Update web/config.js with your domain
# Deploy server to your hosting platform
```

### **Farcaster Mini App**
```bash
# For Farcaster integration
# 1. Update web/.well-known/farcaster.json with your domain
# 2. Sign manifest with your Farcaster account
# 3. Deploy to production domain
```

## **Development Setup**

### **Build from Source**
```bash
# Full build with all features
make full

# Development build
cargo build --all

# Release build
cargo build --release --all
```

### **Testing**
```bash
# Test all API endpoints
./test_server.sh

# Verify build
./verify_build.sh

# Run unit tests
cargo test --all
```

### **Web Development**
```bash
cd web

# Install Farcaster SDK (optional)
npm install @farcaster/miniapp-sdk

# Serve locally
python3 -m http.server 3000
```

## **Troubleshooting**

### **Build Issues**
```bash
# Check Rust version
rustc --version  # Should be 1.85.0+

# Check protobuf
protoc --version

# Clean and rebuild
cargo clean && cargo build
```

### **Server Issues**
```bash
# Check if port is in use
lsof -i :8080

# View server logs
tail -f /tmp/versions-server.log

# Restart server
pkill versions-server && ./target/debug/versions-server
```

### **Audio Issues**
```bash
# Check audio files directory
ls -la audio_files/

# Test audio endpoint
curl http://localhost:8080/api/v1/audio/files

# Check file permissions
chmod 644 audio_files/*.mp3
```

### **Farcaster Issues**
```bash
# Check manifest accessibility
curl https://your-domain.com/.well-known/farcaster.json

# Test in Farcaster preview tool
# https://farcaster.xyz/~/developers/mini-apps/preview
```

## **Next Steps**

### **For Users**
1. **Add Your Music**: Copy audio files to `audio_files/` directory
2. **Explore Social Features**: Sign in with Farcaster for recommendations
3. **Discover Versions**: Use social graph to find new music versions

### **For Developers**
1. **Read Development Guide**: See `docs/DEVELOPMENT.md`
2. **Explore API**: See `docs/API_REFERENCE.md`
3. **Contribute**: Follow Core Principles and submit PRs

### **For Deployment**
1. **Choose Hosting**: Netlify/Vercel for web, Heroku/Railway for server
2. **Configure Domain**: Update config files with production URLs
3. **Set up Farcaster**: Sign manifest and configure Mini App

## **Support**

### **Documentation**
- **API Reference**: `docs/API_REFERENCE.md`
- **Development Guide**: `docs/DEVELOPMENT.md`
- **GitHub Issues**: Report bugs and feature requests

### **Community**
- **Farcaster**: Join the music community on Farcaster
- **GitHub Discussions**: Technical discussions and questions

---

**🎵 Ready to discover music versions like never before!**