# 🔌 VERSIONS - API Reference

## **Overview**

VERSIONS REST API provides audio streaming, Farcaster integration, and music management. All endpoints return JSON with consistent format.

**Base URL**: `http://localhost:8080/api/v1`

**Response Format**:
```json
{
  "success": boolean,
  "data": any | null,
  "error": string | null
}
```

## **🎵 Audio Streaming**

### **List Audio Files**
```http
GET /audio/files
```
**Response**: Array of available audio file IDs
```json
{
  "success": true,
  "data": ["bohemian-rhapsody-studio", "stairway-acoustic"],
  "error": null
}
```

### **Get Audio Metadata**
```http
GET /audio/{file_id}/metadata
```
**Response**: Audio file metadata
```json
{
  "success": true,
  "data": {
    "file_path": "/path/to/file.mp3",
    "title": "Bohemian Rhapsody",
    "artist": "Queen",
    "duration_seconds": 355,
    "file_size": 8500000,
    "format": "mp3",
    "sample_rate": 44100,
    "channels": 2,
    "bitrate": 320
  },
  "error": null
}
```

### **Stream Audio**
```http
GET /audio/{file_id}/stream
```
**Headers**: 
- `Range: bytes=0-1023` (optional, for partial content)

**Response**: Audio stream with appropriate Content-Type
- **Status**: 200 OK or 206 Partial Content
- **Content-Type**: `audio/mpeg`, `audio/flac`, etc.
- **Accept-Ranges**: `bytes`

### **Upload Audio**
```http
POST /audio/upload
Content-Type: application/json

{
  "file_id": "new-song",
  "content": "base64_encoded_audio_data",
  "format": "mp3"
}
```
**Response**: Upload confirmation with metadata

## **🟣 Farcaster Integration**

### **Get User Profile**
```http
GET /farcaster/profile/{fid}
```
**Response**: Farcaster user information
```json
{
  "success": true,
  "data": {
    "fid": 123,
    "username": "musiclover",
    "display_name": "Music Lover",
    "bio": "Passionate about music discovery",
    "follower_count": 150,
    "following_count": 75
  },
  "error": null
}
```

### **Create Cast**
```http
POST /farcaster/cast
Content-Type: application/json

{
  "text": "🎭 Discovered an amazing demo version!",
  "embed_url": "https://versions.app/versions/song-demo"
}
```
**Response**: Cast creation confirmation
```json
{
  "success": true,
  "data": {
    "cast_hash": "0x1234567890abcdef",
    "status": "success"
  },
  "error": null
}
```

### **Get Social Recommendations**
```http
GET /farcaster/recommendations?fid={fid}
```
**Response**: Music recommendations from social graph
```json
{
  "success": true,
  "data": [
    {
      "version_id": "bohemian-rhapsody-live",
      "title": "Bohemian Rhapsody (Live Aid 1985)",
      "artist": "Queen",
      "version_type": "Live",
      "recommended_by_fid": 456,
      "recommended_by_username": "queenfan",
      "reason": "Friend discovered this legendary performance",
      "score": 0.95
    }
  ],
  "error": null
}
```

### **Get Version Discussions**
```http
GET /versions/{version_id}/discussions
```
**Response**: Farcaster discussions about a version
```json
{
  "success": true,
  "data": [
    {
      "hash": "0x123abc",
      "author_fid": 789,
      "text": "This version hits different! 🔥",
      "timestamp": "2024-01-01T12:00:00Z",
      "replies_count": 5,
      "reactions_count": 20
    }
  ],
  "error": null
}
```

## **🎭 Core Platform**

### **Health Check**
```http
GET /health
```
**Response**: API health status
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "0.11.0",
    "service": "versions-api"
  },
  "error": null
}
```

### **List Songs**
```http
GET /songs
```
**Response**: Songs with versions (currently mock data)
```json
{
  "success": true,
  "data": [
    {
      "id": "song1",
      "canonical_title": "Bohemian Rhapsody",
      "versions": [
        {
          "id": "version1",
          "title": "Bohemian Rhapsody (Studio)",
          "artist": "Queen",
          "version_type": "Studio",
          "duration": 355,
          "file_size": 8500000,
          "upload_date": "2024-01-01T00:00:00Z",
          "play_count": 1000,
          "vote_score": 4.8
        }
      ],
      "total_versions": 2
    }
  ],
  "error": null
}
```

### **Get Specific Song**
```http
GET /songs/{song_id}
```
**Response**: Detailed song information with versions

### **Search (Placeholder)**
```http
GET /search?q={query}
```
**Response**: Search results (placeholder implementation)
```json
{
  "success": true,
  "data": ["Search functionality coming soon"],
  "error": null
}
```

## **📝 Audio Formats**

### **Supported Formats**
- **MP3** (`audio/mpeg`) - Universal compatibility
- **FLAC** (`audio/flac`) - Lossless quality
- **WAV** (`audio/wav`) - Uncompressed
- **M4A** (`audio/mp4`) - Apple format
- **OGG** (`audio/ogg`) - Open source
- **AIFF** (`audio/aiff`) - Professional

### **Upload Requirements**
- **Base64 Encoding**: Audio content must be base64 encoded
- **File ID**: Unique identifier (alphanumeric, hyphens, underscores)
- **Format**: Must match supported format list
- **Size Limit**: Reasonable file sizes (implementation dependent)

## **🔧 HTTP Status Codes**

- **200 OK**: Successful request
- **206 Partial Content**: Successful range request (audio streaming)
- **400 Bad Request**: Invalid request format or parameters
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

## **⚡ Performance Features**

### **Audio Streaming Optimization**
- **Range Requests**: Efficient partial content delivery
- **Content-Type Detection**: Automatic MIME type setting
- **Caching**: Metadata caching for improved performance
- **Async Operations**: Non-blocking I/O throughout

### **Farcaster Integration**
- **Lazy Loading**: SDK loaded only when needed
- **Caching**: User profile and social graph caching
- **Error Handling**: Graceful fallbacks for network issues

## **🧪 Testing**

### **Quick API Test**
```bash
# Test all endpoints
./test_server.sh

# Manual testing
curl http://localhost:8080/api/v1/health
curl http://localhost:8080/api/v1/audio/files
curl http://localhost:8080/api/v1/songs
```

### **Audio Streaming Test**
```bash
# List available files
curl http://localhost:8080/api/v1/audio/files

# Get metadata
curl http://localhost:8080/api/v1/audio/sample-track/metadata

# Stream audio (save to file)
curl http://localhost:8080/api/v1/audio/sample-track/stream -o test.mp3

# Range request
curl -H "Range: bytes=0-1023" \
  http://localhost:8080/api/v1/audio/sample-track/stream
```

### **Farcaster Integration Test**
```bash
# Get user profile
curl http://localhost:8080/api/v1/farcaster/profile/1

# Get recommendations
curl "http://localhost:8080/api/v1/farcaster/recommendations?fid=1"

# Get discussions
curl http://localhost:8080/api/v1/versions/song1/discussions
```

## **🔮 Coming Soon**

### **Planned Endpoints**
- `POST /versions/compare` - Compare two audio versions
- `GET /versions/{id}/waveform` - Waveform visualization data
- `POST /versions/{id}/vote` - Community voting on versions
- `GET /users/me/library` - Personal music library
- `POST /playlists` - Collaborative playlist creation
- `GET /analytics/trending` - Trending versions and discoveries

### **Enhanced Features**
- **Database Integration**: Replace mock data with PostgreSQL
- **Advanced Search**: Full-text search with filters and facets
- **Real-time Updates**: WebSocket support for live features
- **Blockchain Integration**: Arbitrum L2 for version ownership
- **Advanced Audio**: Waveform analysis and synchronized playback

### **Authentication & Security**
- **JWT Tokens**: Secure API authentication
- **Rate Limiting**: API usage limits and throttling
- **User Management**: Registration, profiles, preferences
- **Permissions**: Role-based access control

---

**🔌 Complete API for version-centric music discovery!**