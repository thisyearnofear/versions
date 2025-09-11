# 🔌 VERSIONS - API Reference

## **Base URL**
```
Production: https://api.versions.app/v1
Development: http://localhost:3000/api/v1
```

## **Authentication**

### **JWT Bearer Token**
```http
Authorization: Bearer <jwt_token>
```

### **Get Token**
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

**Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "expires_in": 3600,
  "user": {
    "id": "123",
    "username": "musiclover",
    "email": "user@example.com"
  }
}
```

## **Songs**

### **List Songs**
```http
GET /songs?page=1&limit=20&sort=created_at&order=desc
```

**Query Parameters:**
- `page` (int): Page number (default: 1)
- `limit` (int): Items per page (max: 100, default: 20)
- `sort` (string): Sort field (`created_at`, `title`, `play_count`)
- `order` (string): Sort order (`asc`, `desc`)
- `search` (string): Search query

**Response:**
```json
{
  "songs": [
    {
      "id": "song_123",
      "canonical_title": "Bohemian Rhapsody",
      "artists": [
        {
          "id": "artist_456",
          "name": "Queen",
          "verified": true
        }
      ],
      "version_count": 15,
      "latest_version": {
        "id": "version_789",
        "title": "Bohemian Rhapsody (2011 Remaster)",
        "version_type": "remaster",
        "upload_date": "2023-10-15T14:30:00Z"
      },
      "created_at": "2023-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

### **Get Song Details**
```http
GET /songs/{song_id}
```

**Response:**
```json
{
  "id": "song_123",
  "canonical_title": "Bohemian Rhapsody",
  "artists": [...],
  "versions": [
    {
      "id": "version_789",
      "title": "Bohemian Rhapsody (Original 1975)",
      "version_type": "original",
      "duration": 355,
      "file_size": 8450000,
      "format": "flac",
      "bitrate": 1411,
      "sample_rate": 44100,
      "upload_date": "2023-01-15T10:00:00Z",
      "uploader": {
        "id": "user_456",
        "username": "queenfan1975"
      },
      "community_data": {
        "vote_count": 1250,
        "average_rating": 4.8,
        "play_count": 50000,
        "comment_count": 89
      }
    }
  ],
  "timeline": [
    {
      "version_id": "version_789",
      "date": "1975-10-31",
      "event": "original_release"
    },
    {
      "version_id": "version_790",
      "date": "2011-09-05",
      "event": "remaster"
    }
  ]
}
```

## **Versions**

### **Get Version Details**
```http
GET /versions/{version_id}
```

**Response:**
```json
{
  "id": "version_789",
  "song_id": "song_123",
  "title": "Bohemian Rhapsody (Original 1975)",
  "version_type": "original",
  "metadata": {
    "duration": 355,
    "format": "flac",
    "bitrate": 1411,
    "sample_rate": 44100,
    "channels": 2,
    "file_size": 8450000
  },
  "stream_urls": {
    "original": "https://cdn.versions.app/audio/version_789.flac",
    "mp3_320": "https://cdn.versions.app/audio/version_789_320.mp3",
    "mp3_128": "https://cdn.versions.app/audio/version_789_128.mp3"
  },
  "waveform_url": "https://cdn.versions.app/waveforms/version_789.json",
  "relationships": [
    {
      "related_version_id": "version_790",
      "relationship_type": "remaster_of",
      "similarity_score": 0.95
    }
  ],
  "community_data": {
    "vote_count": 1250,
    "average_rating": 4.8,
    "play_count": 50000,
    "user_vote": 5
  }
}
```

### **Upload Version**
```http
POST /versions
Content-Type: multipart/form-data
Authorization: Bearer <token>

{
  "song_id": "song_123",
  "title": "Bohemian Rhapsody (Live at Wembley)",
  "version_type": "live",
  "audio_file": <binary_data>,
  "metadata": {
    "recorded_date": "1986-07-12",
    "venue": "Wembley Stadium",
    "description": "Live performance from Live Aid concert"
  }
}
```

**Response:**
```json
{
  "id": "version_new",
  "status": "processing",
  "upload_url": "https://upload.versions.app/version_new",
  "estimated_processing_time": 120
}
```

### **Update Version**
```http
PUT /versions/{version_id}
Content-Type: application/json
Authorization: Bearer <token>

{
  "title": "Updated Title",
  "description": "Updated description",
  "metadata": {
    "venue": "Updated venue"
  }
}
```

### **Delete Version**
```http
DELETE /versions/{version_id}
Authorization: Bearer <token>
```

## **Search**

### **Search Songs and Versions**
```http
GET /search?q=bohemian+rhapsody&type=songs&page=1&limit=20
```

**Query Parameters:**
- `q` (string): Search query
- `type` (string): Search type (`songs`, `versions`, `artists`, `all`)
- `filters` (object): Additional filters
- `page`, `limit`: Pagination

**Response:**
```json
{
  "results": {
    "songs": [...],
    "versions": [...],
    "artists": [...]
  },
  "total_results": 45,
  "search_time": 0.023
}
```

## **Community Features**

### **Vote on Version**
```http
POST /versions/{version_id}/vote
Content-Type: application/json
Authorization: Bearer <token>

{
  "vote": 5
}
```

### **Get Comments**
```http
GET /versions/{version_id}/comments?page=1&limit=20
```

**Response:**
```json
{
  "comments": [
    {
      "id": "comment_123",
      "user": {
        "id": "user_456",
        "username": "musiccritic",
        "avatar_url": "https://cdn.versions.app/avatars/user_456.jpg"
      },
      "content": "This version has incredible energy!",
      "timestamp": 125.5,
      "created_at": "2023-10-15T14:30:00Z",
      "likes": 23,
      "user_liked": false
    }
  ],
  "pagination": {...}
}
```

### **Add Comment**
```http
POST /versions/{version_id}/comments
Content-Type: application/json
Authorization: Bearer <token>

{
  "content": "Amazing version!",
  "timestamp": 125.5
}
```

## **User Management**

### **Get User Profile**
```http
GET /users/{user_id}
```

### **Update Profile**
```http
PUT /users/me
Content-Type: application/json
Authorization: Bearer <token>

{
  "username": "newusername",
  "bio": "Music enthusiast and collector",
  "avatar": <base64_image>
}
```

## **WebSocket Events**

### **Connection**
```javascript
const ws = new WebSocket('wss://api.versions.app/ws');
ws.send(JSON.stringify({
  type: 'authenticate',
  token: 'jwt_token'
}));
```

### **Event Types**
```javascript
// New version uploaded
{
  "type": "version.uploaded",
  "data": {
    "version_id": "version_new",
    "song_id": "song_123",
    "uploader": "user_456"
  }
}

// Comment added
{
  "type": "comment.added",
  "data": {
    "comment_id": "comment_new",
    "version_id": "version_789",
    "user": "user_456"
  }
}

// Vote changed
{
  "type": "vote.changed",
  "data": {
    "version_id": "version_789",
    "new_average": 4.9,
    "vote_count": 1251
  }
}
```

## **Error Responses**

### **Standard Error Format**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "field": "email",
      "reason": "Invalid email format"
    }
  }
}
```

### **HTTP Status Codes**
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `422` - Validation Error
- `429` - Rate Limited
- `500` - Internal Server Error

## **Rate Limits**

### **Default Limits**
- **Authenticated**: 1000 requests/hour
- **Anonymous**: 100 requests/hour
- **Upload**: 10 files/hour
- **Search**: 100 queries/hour

### **Headers**
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```
