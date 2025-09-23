# VERSIONS Web Interface

**CLEAN**: Unified WASM terminal interface following Core Principles

## 🎯 **Structure (ORGANIZED)**

```
web/
├── index.html          # Main WASM terminal interface
├── theme-bridge.js     # DRY: Single source of truth for themes
├── pkg/               # WASM module (from experiments/wasm-tui-poc)
├── .well-known/       # Farcaster Mini App manifest
└── _redirects         # Netlify routing
```

## 🚀 **Development (PERFORMANT)**

```bash
# Serve locally
python3 -m http.server 3000

# Or use any static file server
npx serve .
```

## 🌐 **Deployment (MODULAR)**

**Static deployment** - no build process needed:
- **Production**: https://versions.thisyearnofear.com
- **Netlify**: https://versionsapp.netlify.app

## 🔧 **WASM Module (ENHANCEMENT FIRST)**

Built from `experiments/wasm-tui-poc`:

```bash
cd experiments/wasm-tui-poc
wasm-pack build --target web --out-dir pkg
cp pkg/* ../../web/pkg/
```

## 🧹 **Cleanup Applied**

✅ **AGGRESSIVE CONSOLIDATION**: Removed duplicate configs  
✅ **PREVENT BLOAT**: Deleted unused TypeScript infrastructure  
✅ **DRY**: Single configuration source in index.html  
✅ **CLEAN**: Pure WASM terminal, no mixed concerns  
✅ **MODULAR**: Static deployment, composable components  
✅ **ORGANIZED**: Predictable structure, clear dependencies