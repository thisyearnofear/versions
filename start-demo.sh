#!/bin/bash
# Quick start script for VERSIONS hackathon demo

echo "🚀 Starting VERSIONS Demo"
echo "========================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "   Copy .env.example to .env and add your API keys"
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Kill any existing processes on ports 3000 and 8080
echo "🧹 Cleaning up existing processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8080 | xargs kill -9 2>/dev/null || true
sleep 1

# Start proxy server in background
echo "🔧 Starting proxy server on port 8080..."
node proxy-server.js &
PROXY_PID=$!
sleep 2

# Start frontend server in background
echo "🌐 Starting frontend on port 3000..."
cd web && python3 -m http.server 3000 &
FRONTEND_PID=$!
cd ..
sleep 2

echo ""
echo "✅ VERSIONS Demo is running!"
echo "========================="
echo ""
echo "🌐 Frontend: http://localhost:3000"
echo "🔧 Backend:  http://localhost:8080"
echo ""
echo "📝 Test endpoints:"
echo "   curl http://localhost:8080/api/v1/health"
echo "   curl http://localhost:8080/api/v1/audius/trending"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Wait for Ctrl+C
trap "echo ''; echo '🛑 Stopping servers...'; kill $PROXY_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait
