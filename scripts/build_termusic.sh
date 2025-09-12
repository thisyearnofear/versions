#!/bin/bash

# Termusic Build Script
# This script helps build and install termusic on macOS

set -e

echo "🎵 Building Termusic..."
echo "📍 Current directory: $(pwd)"

# Check if we're in the right directory
if [ ! -f "Cargo.toml" ] || [ ! -d "tui" ]; then
    echo "❌ Error: Please run this script from the termusic root directory"
    exit 1
fi

# Check Rust version
echo "🦀 Checking Rust version..."
RUST_VERSION=$(rustc --version | cut -d' ' -f2)
echo "   Rust version: $RUST_VERSION"

# Check protobuf
echo "🔧 Checking protobuf..."
if command -v protoc &> /dev/null; then
    echo "   ✅ protoc found"
else
    echo "   ❌ protoc not found. Installing via Homebrew..."
    brew install protobuf
fi

# Build options
echo ""
echo "🏗️  Build options:"
echo "   1. Debug build (faster compilation)"
echo "   2. Release build (optimized, slower compilation)"
echo "   3. Release with all features (full build)"
echo ""
read -p "Choose build type (1-3): " choice

case $choice in
    1)
        echo "🔨 Building debug version..."
        cargo build --all
        echo "✅ Debug build complete!"
        echo "🚀 You can run: cargo run --package termusic --bin termusic"
        ;;
    2)
        echo "🔨 Building release version..."
        cargo build --release --all
        echo "✅ Release build complete!"
        echo "📦 Binaries are in: target/release/"
        ;;
    3)
        echo "🔨 Building full release with all features..."
        cargo build --features cover,all-backends --release --all
        echo "✅ Full build complete!"
        echo "📦 Binaries are in: target/release/"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🎉 Build completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   • To run termusic: ./target/release/termusic (or cargo run for debug)"
echo "   • To install: make install"
echo "   • Config will be at: ~/.config/termusic/"
echo ""
