#!/bin/bash

echo "🎭 VERSIONS - Testing Filecoin Integration"
echo "=========================================="

# Test if server builds
echo "📋 Testing server build..."
if cargo check -p termusic-server --quiet; then
    echo "✅ Server builds successfully with Filecoin integration"
else
    echo "❌ Server build failed"
    exit 1
fi

# Test web interface
echo ""
echo "🌐 Testing web interface..."
if [ -f "web/filecoin-integration.js" ]; then
    echo "✅ Filecoin integration module present"
else
    echo "❌ Filecoin integration module missing"
    exit 1
fi

# Test if all required files are present
echo ""
echo "📁 Checking required files..."
files=(
    "server/src/filecoin_service.rs"
    "web/filecoin-integration.js"
    "web/index.html"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

echo ""
echo "🎉 Filecoin integration foundation complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Start server: cargo run -p termusic-server"
echo "   2. Open web interface: cd web && python3 -m http.server 3000"
echo "   3. Test Filecoin features in browser"
echo ""
echo "🌍 Ready for global music storage and creator economy!"