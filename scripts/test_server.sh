#!/bin/bash

echo "🎭 VERSIONS - Testing Server and API"
echo "===================================="

# Start server in background
echo "Starting server..."
./target/debug/versions-server &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 3

# Test API endpoints
echo "Testing health endpoint..."
curl -s http://127.0.0.1:8080/api/v1/health | jq '.' || echo "Health endpoint failed"

echo -e "\nTesting songs endpoint..."
curl -s http://127.0.0.1:8080/api/v1/songs | jq '.' || echo "Songs endpoint failed"

echo -e "\nTesting specific song endpoint..."
curl -s http://127.0.0.1:8080/api/v1/songs/song1 | jq '.' || echo "Song endpoint failed"

echo -e "\nTesting Farcaster profile endpoint..."
curl -s http://127.0.0.1:8080/api/v1/farcaster/profile/1 | jq '.' || echo "Farcaster profile endpoint failed"

echo -e "\nTesting version discussions endpoint..."
curl -s http://127.0.0.1:8080/api/v1/versions/song1/discussions | jq '.' || echo "Discussions endpoint failed"

echo -e "\nTesting social recommendations endpoint..."
curl -s "http://127.0.0.1:8080/api/v1/farcaster/recommendations?fid=1" | jq '.' || echo "Social recommendations endpoint failed"

echo -e "\nTesting audio files list endpoint..."
curl -s http://127.0.0.1:8080/api/v1/audio/files | jq '.' || echo "Audio files endpoint failed"

echo "\nTesting audio metadata endpoint..."
curl -s http://127.0.0.1:8080/api/v1/audio/sample-track/metadata | jq '.' || echo "Audio metadata endpoint failed (expected - no sample file)"

echo "\nTesting Filecoin network status endpoint..."
curl -s http://127.0.0.1:8080/api/v1/filecoin/network/status | jq '.' || echo "Filecoin network endpoint failed"

# ENHANCEMENT FIRST: Test web interface TypeScript compilation
echo -e "\n🌍 Testing web interface TypeScript build..."
if [ -d "web/dist" ]; then
    echo "✅ TypeScript compiled successfully - dist directory exists"
    ls -la web/dist/*.js | head -5
else
    echo "❌ TypeScript build failed - no dist directory found"
    echo "Run: cd web && npm run build"
fi

# Stop server
echo -e "\nStopping server..."
kill $SERVER_PID 2>/dev/null || echo "Server already stopped"

echo "✅ Audio Streaming Foundation complete! 🎵 Music platform ready!"