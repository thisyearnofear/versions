# VERSIONS Web Interface

**CLEAN**: Mobile-first web app following Core Principles

## 🎯 **Structure (ORGANIZED)**

```
web/
├── index.html              # MAIN APP: Audius/Solana integration
├── audius-solana.js       # MODULAR: Wallet + coin integration
├── farcaster-miniapp.js   # MODULAR: Social integration
├── theme-bridge.js        # DRY: Theme configuration
├── pkg/                   # WASM module (legacy, optional)
├── .well-known/          # Faracaster Mini App manifest
└── _redirects            # Netlify routing
```

## 🎯 **Principles Applied**

| File | Principles Applied |
|------|-------------------|
| `index.html` | CLEAN, MODULAR, PERFORMANT, ORGANIZED |
| `audius-solana.js` | MODULAR, DRY, CLEAN, PERFORMANT |
| `farcaster-miniapp.js` | MODULAR, CLEAN |
| `theme-bridge.js` | DRY, ORGANIZED |

## 🚀 **Features (ENHANCEMENT FIRST)**

- **Onboarding Flow**: 3-step explanation of "versions as tickets"
- **Audius Integration**: Real-time trending tracks from Audius API
- **Solana Wallet**: Connect Phantom to unlock premium versions
- **Mobile-First**: Responsive design, touch-friendly
- **Search**: Filter songs and artists in real-time

## 🏗️ **Running Locally**

```bash
# Simple static server
python3 -m http.server 3000

# Or with npx
npx serve .
```

Open http://localhost:3000

## 🌐 **Deployment**

**Static deployment** - no build process:
- **Production**: https://versions.app
- **Netlify**: https://versionsapp.netlify.app

## 🧹 **Architecture Notes**

**AGGRESSIVE CONSOLIDATION**: 
- Removed separate demo file
- Single `index.html` contains all features
- Simplified from 2500 line WASM terminal to ~400 line mobile app
- Focus on hackathon: working Audius/Solana integration

**PREVENT BLOAT**:
- No external dependencies (vanilla JS)
- No build step required
- Cached Audius API responses

**MODULAR**:
- `audius-solana.js` can be removed/updated independently
- Onboarding can be disabled via localStorage
- Wallet connection is optional
