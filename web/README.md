# 🌐 VERSIONS - Web Community Platform

The web interface for the VERSIONS version-centric music platform.

## 🎯 **Purpose**

This is the **community-focused interface** of VERSIONS, designed for:
- **Social Discovery** - Find and explore different versions of songs
- **Visual Comparisons** - Split-screen audio comparison tools
- **Community Curation** - Vote, comment, and discuss versions
- **Mainstream Accessibility** - Mobile-responsive, intuitive UX

## 🚀 **Quick Start**

### **Development Server**
```bash
# Serve the static HTML (current)
cd web
python3 -m http.server 3000

# Open in browser
open http://localhost:3000
```

### **Test with Backend**
```bash
# Start the VERSIONS server (in project root)
cargo run -p termusic-server

# The web interface will automatically detect the API at localhost:8080
```

## 🏗️ **Current Status**

### **✅ Implemented**
- Static HTML prototype with dual-interface showcase
- REST API testing interface
- Responsive design foundation
- Server status monitoring

### **🔄 Next Steps**
1. **React/Vue.js Framework** - Modern component-based architecture
2. **Audio Player Component** - Web Audio API integration
3. **Version Comparison UI** - Split-screen interface
4. **Wallet Integration** - MetaMask connection for Web3 features
5. **Real-time Updates** - WebSocket integration

## 🎵 **Features Roadmap**

### **Phase 1: Foundation**
- [x] Static prototype
- [ ] React/Vue.js setup
- [ ] Basic audio player
- [ ] API integration

### **Phase 2: Core Features**
- [ ] Version timeline visualization
- [ ] Split-screen comparison
- [ ] User authentication
- [ ] Basic community features

### **Phase 3: Web3 Integration**
- [ ] Wallet connection (MetaMask)
- [ ] NFT version display
- [ ] Blockchain transaction UI
- [ ] IPFS content loading

### **Phase 4: Community**
- [ ] Voting and ranking
- [ ] Comments and discussions
- [ ] Social sharing
- [ ] Advanced discovery

## 🔧 **Technology Stack**

### **Current (Prototype)**
- **HTML5** - Semantic markup
- **CSS3** - Modern styling with Grid/Flexbox
- **Vanilla JavaScript** - API testing and interactions

### **Planned (Production)**
- **Framework**: React 18+ or Vue.js 3+
- **Language**: TypeScript
- **Build Tool**: Vite
- **State Management**: Zustand or Pinia
- **Audio**: Web Audio API + Howler.js
- **Web3**: Wagmi + ethers.js
- **UI Library**: Tailwind CSS + Headless UI
- **PWA**: Service Workers + Manifest

## 📱 **Responsive Design**

The interface is designed mobile-first:
- **Desktop**: Full dual-pane layout with advanced features
- **Tablet**: Optimized for touch interactions
- **Mobile**: Streamlined single-column layout

## 🔗 **API Integration**

The web interface connects to the Rust backend via REST API:

```javascript
// Example API calls
const API_BASE = 'http://localhost:8080';

// Get songs list
const songs = await fetch(`${API_BASE}/api/v1/songs`);

// Get specific version
const version = await fetch(`${API_BASE}/api/v1/versions/version1`);
```

## 🎭 **Dual Interface Strategy**

This web interface complements the terminal interface:

| Feature | Terminal (TUI) | Web Interface |
|---------|----------------|---------------|
| **Target Users** | Creators, Power Users | Community, Mainstream |
| **Primary Use** | Local Management | Social Discovery |
| **Interaction** | CLI Commands | Visual UI |
| **Workflows** | Batch Operations | Individual Actions |
| **Connectivity** | gRPC | REST API |

## 🤝 **Contributing**

We welcome contributions to the web frontend:

### **Areas We Need Help**
- 🎨 **UI/UX Design** - Version comparison interfaces
- ⚛️ **React/Vue Development** - Component architecture
- 🎵 **Audio Engineering** - Web Audio API integration
- ⛓️ **Web3 Integration** - Wallet and blockchain features
- 📱 **Mobile Optimization** - Touch interactions and PWA

### **Development Workflow**
1. Fork the repository
2. Create feature branch: `git checkout -b feature/web-audio-player`
3. Develop and test locally
4. Submit pull request

## 📄 **License**

MIT License - Same as the main VERSIONS project.

---

**🎭 VERSIONS Web - Where community discovers music together.**