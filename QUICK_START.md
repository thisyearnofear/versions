# Quick Start Guide

## Current Status

✅ **Environment Variables Configured**
- All API keys moved to `.env`
- Backend proxy endpoints created
- Frontend updated to use backend

⚠️ **Server Compilation Issue**
The Rust server requires libmpv but there's a linker issue on your system.

## Testing Options

### Option 1: Frontend Only (Immediate)
The frontend is already running at http://localhost:3000

It will show connection errors because the backend isn't running, but you can see the UI.

### Option 2: Fix libmpv Linking (Recommended)
The issue is that the linker can't find libmpv symbols. Try:

```bash
# Check if pkg-config can find mpv
pkg-config --libs mpv

# If that works, try:
export PKG_CONFIG_PATH="/usr/local/opt/mpv/lib/pkgconfig:$PKG_CONFIG_PATH"
cargo clean
cargo run --features mpv -p termusic-server -- audio_files
```

### Option 3: Use GStreamer Instead
```bash
brew install gstreamer gst-plugins-base gst-plugins-good
cargo run --features gst -p termusic-server -- audio_files
```

### Option 4: Deploy to Production
Since the local build is having issues, you could:
1. Commit and push your changes
2. Deploy to a Linux server where libmpv linking works better
3. Test there

## What Was Accomplished

1. ✅ Moved all API keys to `.env` file
2. ✅ Created backend proxy endpoints in `server/src/rest_api.rs`
3. ✅ Updated frontend to use backend proxy
4. ✅ Added environment variable documentation
5. ✅ Configured IPFS and blockchain RPC URLs via env vars

## Files Modified

- `.env` - Your API keys (DO NOT COMMIT)
- `.env.example` - Template for others
- `server/Cargo.toml` - Added dotenvy, urlencoding
- `server/src/server.rs` - Loads .env on startup
- `server/src/rest_api.rs` - Uses env vars, added proxy endpoints
- `lib/src/onchain.rs` - Uses ARBITRUM_RPC_URL, IPFS_GATEWAY_URL
- `lib/src/distributed.rs` - Uses IPFS env vars
- `web/audius-solana.js` - Uses backend proxy
- `docs/ENVIRONMENT_VARIABLES.md` - Complete documentation

## Next Steps

1. Fix the libmpv linking issue (see Option 2 above)
2. Once server runs, test at http://localhost:8080/api/v1/health
3. Frontend at http://localhost:3000 will connect automatically
4. Test Audius integration and wallet connection
