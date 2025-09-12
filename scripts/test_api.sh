#!/bin/bash

echo "🎭 VERSIONS - Testing REST API"
echo "================================"

# Test health endpoint
echo "Testing health endpoint..."
curl -s http://localhost:8080/api/v1/health | jq '.'

echo -e "\nTesting songs list endpoint..."
curl -s http://localhost:8080/api/v1/songs | jq '.'

echo -e "\nTesting specific song endpoint..."
curl -s http://localhost:8080/api/v1/songs/song1 | jq '.'

echo -e "\nTesting version endpoint..."
curl -s http://localhost:8080/api/v1/versions/version1 | jq '.'

echo -e "\n✅ API tests complete!"