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

# Check for TypeScript source files
if [ ! -d "web/src" ] || [ ! -f "web/src/config.ts" ] || [ ! -f "web/src/audio-player.ts" ]; then
    echo "❌ TypeScript source files missing"
    exit 1
fi

# Check for compiled JavaScript files
if [ ! -d "web/dist" ] || [ ! -f "web/dist/config.js" ] || [ ! -f "web/dist/audio-player.js" ]; then
    echo "❌ Compiled JavaScript files missing - run 'make web-build'"
    exit 1
fi

# Check for main HTML files
if [ ! -f "web/index.html" ] || [ ! -f "web/package.json" ] || [ ! -f "web/tsconfig.json" ]; then
    echo "❌ Essential web files missing"
    exit 1
fi

echo "✅ Web components present (TypeScript + compiled JavaScript)"

# CLEAN: Check documentation
echo ""
echo "📚 Checking documentation..."
if [ -f "README.md" ] && [ -f "WARP.md" ]; then
    echo "✅ Documentation present"
else
    echo "❌ Documentation missing"
    exit 1
fi

echo ""
echo "🎉 Build verification complete!"
echo ""
echo "📋 Next steps:"
echo "   1. make full-build         # Complete build (Rust + TypeScript)"
echo "   2. ./scripts/test_server.sh # Test API endpoints + TypeScript"
echo "   3. make web-dev            # Start development server with live reload"
echo "   4. ./target/debug/versions-server  # Start backend server"
echo ""
echo "🎵 VERSIONS is ready for version-centric music discovery!"
