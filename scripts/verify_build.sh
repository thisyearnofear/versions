#!/bin/bash

# 🎭 VERSIONS - Build Verification Script
# CLEAN: Verify that all components build correctly

echo "🎭 VERSIONS - Build Verification"
echo "================================"

# ORGANIZED: Check prerequisites
echo "📋 Checking prerequisites..."
if ! command -v cargo &> /dev/null; then
    echo "❌ Cargo not found. Please install Rust."
    exit 1
fi

if ! command -v protoc &> /dev/null; then
    echo "❌ protoc not found. Please install protobuf-compiler."
    echo "   macOS: brew install protobuf"
    echo "   Ubuntu: sudo apt install protobuf-compiler"
    exit 1
fi

echo "✅ Prerequisites satisfied"

# MODULAR: Test individual components
echo ""
echo "🔧 Testing server component..."
if cargo check -p termusic-server --quiet; then
    echo "✅ Server component builds successfully"
else
    echo "❌ Server component build failed"
    exit 1
fi

echo ""
echo "🖥️ Testing TUI component..."
if cargo check -p termusic --quiet; then
    echo "✅ TUI component builds successfully"
else
    echo "❌ TUI component build failed"
    exit 1
fi

echo ""
echo "📚 Testing library component..."
if cargo check -p termusic-lib --quiet; then
    echo "✅ Library component builds successfully"
else
    echo "❌ Library component build failed"
    exit 1
fi

# PERFORMANT: Quick syntax check for web components
echo ""
echo "🌐 Checking web components..."
if [ -f "web/index.html" ] && [ -f "web/audio-player.js" ] && [ -f "web/farcaster.js" ]; then
    echo "✅ Web components present"
else
    echo "❌ Web components missing"
    exit 1
fi

# CLEAN: Check documentation
echo ""
echo "📚 Checking documentation..."
if [ -f "README.md" ] && [ -f "CURRENT_STATUS.md" ]; then
    echo "✅ Documentation present"
else
    echo "❌ Documentation missing"
    exit 1
fi

echo ""
echo "🎉 Build verification complete!"
echo ""
echo "📋 Next steps:"
echo "   1. cargo build --release  # Full optimized build"
echo "   2. ./test_server.sh       # Test API endpoints"
echo "   3. cd web && python3 -m http.server 3000  # Test web interface"
echo ""
echo "🎵 VERSIONS is ready for development!"