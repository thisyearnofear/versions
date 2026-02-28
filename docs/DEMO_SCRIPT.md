# VERSIONS - Demo Script for Solana Graveyard Hackathon

**Project**: VERSIONS - Song Versions as Tickets  
**Track**: Audius Track  
**Hackathon**: Solana Graveyard Hackathon  
**Demo URL**: http://localhost:3003

---

## 🎬 Demo Script (2-3 minutes)

### Opening (15 seconds)
"Hi, I'm presenting VERSIONS - a new way to collect music where song versions become digital collectibles tied to Audius Artist Coins on Solana."

### Problem Statement (20 seconds)
"Artists release multiple versions of their songs - demos, live recordings, remixes, acoustic versions. But fans have no way to collect these versions as unique items. And artists struggle to monetize their creative process beyond the final release."

### Solution Overview (30 seconds)
"VERSIONS solves this by treating each song version as a ticket. To unlock a version, you need to own the artist's coin on Audius. It's like owning rare vinyl, but digital and verifiable on Solana."

**[Navigate to http://localhost:3003]**

### Feature Demo (60 seconds)

**1. Artist Dashboard (15 seconds)**
- "First, let me show you the artist side - click 'Artist Dashboard'"
- "Artists connect their wallet and see all their tracks"
- "They can toggle any track between Free and Premium with one click"
- "Premium automatically gates with their Artist Coin - no complex setup"

**2. Versions as Tickets Concept (15 seconds)**
- "Back on the fan side, notice the info banner explaining the concept"
- "We have X total versions, Y are premium (require artist coins), Z are unlocked"
- "Each card shows whether it's premium (ticket required) or free"
- "Premium versions show the artist's coin ticker and a 'Buy on Jupiter' button"

**3. Connect Wallet & Verify (15 seconds)**
- Click "Connect Wallet" button
- "I'm connecting my Phantom wallet to verify ownership"
- "The app queries Solana blockchain through Helius RPC"
- "Watch the stats update as it verifies which artist coins I own"
- "Owned versions automatically unlock"

**4. Play & Purchase Flow (15 seconds)**
- Click on a free version - plays immediately
- Click on a locked premium version
- "See the 'Buy on Jupiter' button - one click to purchase the coin"
- "Or copy the address to buy on any DEX"
- "Once you own the coin, all that artist's premium versions unlock"

### Technical Highlights (30 seconds)
"Built with:
- Audius API for music metadata and artist coins
- Solana blockchain for ownership verification via Helius RPC
- SPL Token standard for artist coins
- Jupiter DEX integration for seamless coin purchases
- Secure backend proxy to protect API keys
- Responsive frontend with animated gradients and glassmorphism"

### Impact & Future (20 seconds)
"This creates new revenue streams for artists through version scarcity, gives fans collectible items tied to real utility, and builds on Solana's speed and low costs for micro-transactions."

"Want a premium version? Click 'Buy on Jupiter' - it takes you directly to swap SOL for that artist's coin. Once you own it, all their premium versions unlock automatically."

"Artists can release exclusive versions to coin holders, creating a direct relationship between token ownership and content access."

### Closing (10 seconds)
"VERSIONS - where every song version tells a story, and ownership unlocks the collection. Built for the Solana Graveyard Hackathon. Thank you!"

---

## 🎯 Key Points to Emphasize

1. **Real Integration**: Uses actual Audius Artist Coins (SPL tokens on Solana)
2. **Blockchain Verification**: Real-time ownership checks via Solana RPC
3. **Artist Empowerment**: New monetization model for creative process
4. **Fan Experience**: Collectible versions with real utility
5. **Technical Excellence**: Secure architecture, smooth UX, production-ready

---

## 🔧 Pre-Demo Checklist

- [x] Backend proxy running: `node proxy-server.js` (port 8080) ✅
- [x] Frontend running: `python3 -m http.server 3003` in `/web` (port 3003) ✅
- [ ] Browser open to: http://localhost:3003
- [ ] Artist dashboard accessible: http://localhost:3003/artist.html
- [ ] Phantom wallet installed and funded (for demo)
- [ ] Test wallet connection before recording
- [ ] Test audio playback before recording (non-premium tracks should play immediately)
- [ ] Test artist dashboard toggle switches
- [ ] Close unnecessary browser tabs
- [ ] Disable notifications during recording
- [ ] Refresh browser to load latest changes (Ctrl+Shift+R / Cmd+Shift+R)

---

## 🎥 Recording Tips

1. **Screen Setup**: Full browser window, hide bookmarks bar
2. **Audio**: Test microphone levels first
3. **Pace**: Speak clearly, not too fast
4. **Mouse**: Smooth movements, pause on key features
5. **Backup**: Record 2-3 takes in case of issues
6. **Length**: Aim for 2-3 minutes max (hackathon judges are busy!)

---

## 📝 Submission Notes

**What makes VERSIONS special:**
- Solves real problem for artists and fans
- Uses Audius Artist Coins (actual SPL tokens)
- Real blockchain verification, not mocked
- Production-quality UI/UX
- Secure backend architecture
- Extensible for future features (NFT minting, royalty splits, etc.)

**Graveyard Theme Connection:**
- Resurrects the concept of collectible music formats (vinyl, cassettes)
- Brings "dead" song versions (demos, outtakes) back to life
- Revives direct artist-fan relationships in streaming era

---

## 🚀 Demo URLs

- **Frontend**: http://localhost:3003
- **Backend Health**: http://localhost:8080/api/v1/health
- **Audius**: https://audius.co
- **Solana Explorer**: https://explorer.solana.com

Good luck with your demo! 🎵✨
