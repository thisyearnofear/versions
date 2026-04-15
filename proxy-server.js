#!/usr/bin/env node
// Simple proxy server for VERSIONS hackathon demo
// Securely proxies API requests to hide API keys from frontend

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { getServerConfig, providerStatus } = require('./proxy/runtime/config');
const { sendError } = require('./proxy/runtime/errors');
const { createTtlCache } = require('./proxy/runtime/cache');
const { attachRequestContext, createRateLimitMiddleware } = require('./proxy/runtime/middleware');
const { parsePositiveInt, validateMode, validatePromptText } = require('./proxy/runtime/validation');
const { createAudiusAdapter } = require('./proxy/adapters/audius');
const { createHeliusAdapter } = require('./proxy/adapters/solana');
const { createTurbopufferAdapter } = require('./proxy/adapters/turbopuffer');
const { createElevenLabsAdapter, AUDIO_DIR } = require('./proxy/adapters/elevenlabs');
const path = require('path');
const { createAudioComposeService } = require('./proxy/services/audio-compose');

const app = express();
const PORT = process.env.SERVER_PORT || 8080;
const serverConfig = getServerConfig();

const semanticCache = createTtlCache({ ttlMs: serverConfig.semanticCacheTtlMs, maxEntries: 200 });
const audioCache = createTtlCache({ ttlMs: serverConfig.audioCacheTtlMs, maxEntries: 120 });

const audius = createAudiusAdapter({ apiKey: process.env.AUDIUS_API_KEY, requestTimeoutMs: serverConfig.requestTimeoutMs });
const helius = createHeliusAdapter({ apiKey: process.env.HELIUS_API_KEY, requestTimeoutMs: serverConfig.requestTimeoutMs });
const turbopuffer = createTurbopufferAdapter({ apiKey: process.env.TURBOPUFFER_API_KEY, requestTimeoutMs: serverConfig.requestTimeoutMs });
const elevenlabs = createElevenLabsAdapter({ apiKey: process.env.ELEVENLABS_API_KEY, requestTimeoutMs: serverConfig.requestTimeoutMs });
const composeService = createAudioComposeService({
  vectorIndex: turbopuffer,
  audioGenerator: elevenlabs
});

// Database setup
let db;
let dbReady = false;
async function initDb() {
    db = await open({
        filename: './data/versions.db',
        driver: sqlite3.Database
    });
    
    // Create tables if they don't exist (Relational Layer)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS track_relationships (
            parent_id TEXT NOT NULL,
            version_id TEXT NOT NULL,
            version_type TEXT,
            artist_id TEXT,
            PRIMARY KEY (parent_id, version_id)
        );
        
        CREATE TABLE IF NOT EXISTS version_metadata (
            track_id TEXT PRIMARY KEY,
            rarity_tier TEXT DEFAULT 'Standard',
            serial_prefix TEXT DEFAULT 'VER',
            rarity_score INTEGER DEFAULT 0
        );
    `);

    dbReady = true;
    
    console.log('✅ SQLite Database initialized');
}

initDb().catch(err => console.error('❌ DB Init failed:', err));

// Middleware
app.use(attachRequestContext);
app.use(cors({
  origin(origin, callback) {
    if (!origin || serverConfig.allowedOrigins.length === 0 || serverConfig.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('CORS origin not allowed'));
  }
}));
app.use(express.json({ limit: serverConfig.bodyLimit }));

const audioRateLimit = createRateLimitMiddleware({
  windowMs: serverConfig.rateLimitWindowMs,
  maxRequests: serverConfig.rateLimitAudioMax,
  label: 'audio-api'
});

function cacheKey(parts) {
  return JSON.stringify(parts);
}

function fail(res, req, status, message, details, code) {
  return sendError(res, status, message, details, code, req.requestId);
}

function ensureDatabaseReady(req, res) {
  if (dbReady) {
    return true;
  }

  fail(res, req, 503, 'Database not ready', null, 'DB_NOT_READY');
  return false;
}

// Relationship Endpoints
app.get('/api/v1/relationships/:parent_id', async (req, res) => {
  try {
        if (!ensureDatabaseReady(req, res)) {
            return;
        }
        const { parent_id } = req.params;
        const relations = await db.all('SELECT * FROM track_relationships WHERE parent_id = ?', [parent_id]);
        res.json({ success: true, data: relations });
    } catch (error) {
        fail(res, req, 500, 'Failed to fetch relationships', error.message, 'RELATIONSHIP_FETCH_FAILED');
    }
});

app.post('/api/v1/relationships/link', async (req, res) => {
    try {
        if (!ensureDatabaseReady(req, res)) {
            return;
        }
        const { parent_id, version_id, version_type, artist_id } = req.body;
        if (!parent_id || !version_id) {
            return fail(res, req, 400, 'parent_id and version_id are required', null, 'INVALID_INPUT');
        }

        await db.run(
            'INSERT OR REPLACE INTO track_relationships (parent_id, version_id, version_type, artist_id) VALUES (?, ?, ?, ?)',
            [parent_id, version_id, version_type, artist_id]
        );
        res.json({ success: true, message: 'Relationship linked', requestId: req.requestId });
    } catch (error) {
        fail(res, req, 500, 'Failed to link relationship', error.message, 'RELATIONSHIP_LINK_FAILED');
    }
});

app.get('/api/v1/relationships', async (req, res) => {
    try {
        if (!ensureDatabaseReady(req, res)) {
            return;
        }
        const relations = await db.all('SELECT * FROM track_relationships');
        res.json({ success: true, data: relations });
    } catch (error) {
        fail(res, req, 500, 'Failed to fetch relationships', error.message, 'RELATIONSHIP_FETCH_FAILED');
    }
});

// Health check
app.get('/api/v1/health/live', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'live',
      service: 'versions-proxy',
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/v1/health/ready', (req, res) => {
  const providers = providerStatus();
  const ready = dbReady;

  if (!ready) {
    return fail(res, req, 503, 'Service is not ready', { dbReady, providers }, 'NOT_READY');
  }

  return res.json({
    success: true,
    data: {
      status: 'ready',
      dbReady,
      providers,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/v1/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: dbReady ? 'healthy' : 'starting',
      service: 'versions-proxy',
      dbReady,
      providers: providerStatus(),
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/v1/providers', (req, res) => {
  res.json({ success: true, data: providerStatus(), requestId: req.requestId });
});

// Proxy Audius coins list
app.get('/api/v1/audius/coins', async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 100);
    if (limit === null || limit > 200) {
      return fail(res, req, 400, 'limit must be an integer between 1 and 200', null, 'INVALID_INPUT');
    }

    const data = await audius.getCoins(limit);
    res.json(data);
  } catch (error) {
    console.error('Audius coins error:', error.message);
    fail(res, req, 500, 'Failed to fetch coins', error.message, 'AUDIUS_COINS_FAILED');
  }
});

// Proxy Audius Resolve (Handle to ID)
app.get('/api/v1/audius/resolve', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return fail(res, req, 400, 'URL parameter is required', null, 'INVALID_INPUT');
    }

    const data = await audius.resolve(url);
    res.json(data);
  } catch (error) {
    console.error('Audius resolve error:', error.message);
    fail(res, req, 500, 'Failed to resolve Audius URL', error.message, 'AUDIUS_RESOLVE_FAILED');
  }
});

// Proxy Audius trending tracks
app.get('/api/v1/audius/trending', async (req, res) => {
  try {
    const data = await audius.getTrending();
    res.json(data);
  } catch (error) {
    console.error('Audius trending error:', error.message);
    fail(res, req, 500, 'Failed to fetch trending tracks', error.message, 'AUDIUS_TRENDING_FAILED');
  }
});

// Proxy Audius user coins
app.get('/api/v1/audius/user/:user_id/coins', async (req, res) => {
  try {
    const { user_id } = req.params;
    const data = await audius.getUserCoins(user_id);
    res.json(data);
  } catch (error) {
    console.error('Audius coins error:', error.message);
    fail(res, req, 500, 'Failed to fetch user coins', error.message, 'AUDIUS_USER_COINS_FAILED');
  }
});

// Proxy Audius track search
app.get('/api/v1/audius/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const limit = parsePositiveInt(req.query.limit, undefined);
    if (limit === null || (typeof limit === 'number' && limit > 100)) {
      return fail(res, req, 400, 'limit must be an integer between 1 and 100', null, 'INVALID_INPUT');
    }

    const data = await audius.searchTracks(query, limit);
    res.json(data);
  } catch (error) {
    console.error('Audius search error:', error.message);
    fail(res, req, 500, 'Failed to search tracks', error.message, 'AUDIUS_SEARCH_FAILED');
  }
});

// Proxy Audius track by ID
app.get('/api/v1/audius/track/:track_id', async (req, res) => {
  try {
    const { track_id } = req.params;
    const data = await audius.getTrack(track_id);
    res.json(data);
  } catch (error) {
    console.error('Audius track error:', error.message);
    fail(res, req, 500, 'Failed to fetch track', error.message, 'AUDIUS_TRACK_FAILED');
  }
});

// Proxy Audius track access info (gating status)
app.get('/api/v1/audius/track/:track_id/access-info', async (req, res) => {
  try {
    const { track_id } = req.params;
    const data = await audius.getTrackAccessInfo(track_id);
    res.json(data);
  } catch (error) {
    console.error('Track access info error:', error.message);
    fail(res, req, 500, 'Failed to fetch track access info', error.message, 'AUDIUS_ACCESS_INFO_FAILED');
  }
});

// Proxy Audius track streaming
app.get('/api/v1/audius/stream/:track_id', async (req, res) => {
  try {
    const { track_id } = req.params;
    const response = await audius.streamTrack(track_id);
    
    // Stream the audio data through
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Pipe the response
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Audius stream error:', error.message);
    fail(res, req, 500, 'Failed to stream track', error.message, 'AUDIUS_STREAM_FAILED');
  }
});

// Proxy Solana RPC requests through Helius
app.post('/api/v1/solana/rpc', async (req, res) => {
  try {
    const data = await helius.rpc(req.body);
    res.json(data);
  } catch (error) {
    console.error('Solana RPC error:', error.message);
    return res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: error.message || 'RPC request failed' },
      id: req.body.id,
      requestId: req.requestId
    });
  }
});

// ARTIST ENDPOINTS

// Get artist's tracks
app.get('/api/v1/artist/:user_id/tracks', async (req, res) => {
  try {
    const { user_id } = req.params;
    const data = await audius.getArtistTracks(user_id);
    res.json(data);
  } catch (error) {
    console.error('Artist tracks error:', error.message);
    fail(res, req, 500, 'Failed to fetch artist tracks', error.message, 'ARTIST_TRACKS_FAILED');
  }
});

// Get artist info
app.get('/api/v1/artist/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const data = await audius.getArtist(user_id);
    res.json(data);
  } catch (error) {
    console.error('Artist info error:', error.message);
    fail(res, req, 500, 'Failed to fetch artist info', error.message, 'ARTIST_INFO_FAILED');
  }
});

app.post('/api/v1/semantic/search', async (req, res) => {
  try {
    const { query, topK = 5, namespace } = req.body || {};
    const queryError = validatePromptText(query, 'query');
    if (queryError) {
      return fail(res, req, 400, queryError, null, 'INVALID_INPUT');
    }

    const validatedTopK = parsePositiveInt(topK, 5);
    if (validatedTopK === null || validatedTopK > 20) {
      return fail(res, req, 400, 'topK must be an integer between 1 and 20', null, 'INVALID_INPUT');
    }

    const trimmedQuery = query.trim();
    const key = cacheKey(['semantic', trimmedQuery, validatedTopK, namespace || null]);
    const cached = semanticCache.get(key);
    if (cached) {
      return res.json({ success: true, data: cached, meta: { cached: true }, requestId: req.requestId });
    }

    const data = await turbopuffer.semanticSearch({
      query: trimmedQuery,
      topK: validatedTopK,
      namespace
    });

    semanticCache.set(key, data);

    res.json({ success: true, data, meta: { cached: false }, requestId: req.requestId });
  } catch (error) {
    console.error('Semantic search error:', error.message);
    fail(res, req, 500, 'Semantic search failed', error.message, 'SEMANTIC_SEARCH_FAILED');
  }
});

app.post('/api/v1/audio/generate', audioRateLimit, async (req, res) => {
  try {
    const { mode = 'music', prompt, durationSeconds } = req.body || {};
    const promptError = validatePromptText(prompt, 'prompt');
    if (promptError) {
      return fail(res, req, 400, promptError, null, 'INVALID_INPUT');
    }

    if (!validateMode(mode)) {
      return fail(res, req, 400, 'mode must be one of: music, sfx', null, 'INVALID_INPUT');
    }

    const validatedDurationSeconds = parsePositiveInt(durationSeconds, 10);
    if (validatedDurationSeconds === null || validatedDurationSeconds > 120) {
      return fail(res, req, 400, 'durationSeconds must be between 1 and 120', null, 'INVALID_INPUT');
    }

    const trimmedPrompt = prompt.trim();
    const key = cacheKey(['generate', mode, trimmedPrompt, validatedDurationSeconds]);
    const cached = audioCache.get(key);
    if (cached) {
      return res.json({ success: true, data: cached, meta: { cached: true }, requestId: req.requestId });
    }

    const data = await elevenlabs.generate({
      mode,
      prompt: trimmedPrompt,
      durationSeconds: validatedDurationSeconds
    });

    audioCache.set(key, data);

    res.json({ success: true, data, meta: { cached: false }, requestId: req.requestId });
  } catch (error) {
    console.error('Audio generation error:', error.message);
    fail(res, req, 500, 'Audio generation failed', error.message, 'AUDIO_GENERATE_FAILED');
  }
});

app.post('/api/v1/audio/compose', audioRateLimit, async (req, res) => {
  try {
    const { query, mode = 'music', topK = 5, durationSeconds, trackContext } = req.body || {};
    const queryError = validatePromptText(query, 'query');
    if (queryError) {
      return fail(res, req, 400, queryError, null, 'INVALID_INPUT');
    }

    if (!validateMode(mode)) {
      return fail(res, req, 400, 'mode must be one of: music, sfx', null, 'INVALID_INPUT');
    }

    const validatedTopK = parsePositiveInt(topK, 5);
    if (validatedTopK === null || validatedTopK > 20) {
      return fail(res, req, 400, 'topK must be an integer between 1 and 20', null, 'INVALID_INPUT');
    }

    const validatedDurationSeconds = parsePositiveInt(durationSeconds, 10);
    if (validatedDurationSeconds === null || validatedDurationSeconds > 120) {
      return fail(res, req, 400, 'durationSeconds must be between 1 and 120', null, 'INVALID_INPUT');
    }

    const trimmedQuery = query.trim();
    const key = cacheKey(['compose', mode, trimmedQuery, validatedTopK, validatedDurationSeconds]);
    const cached = audioCache.get(key);
    if (cached) {
      return res.json({ success: true, data: cached, meta: { cached: true }, requestId: req.requestId });
    }

    const data = await composeService.compose({
      query: trimmedQuery,
      mode,
      topK: validatedTopK,
      durationSeconds: validatedDurationSeconds,
      trackContext: trackContext || null
    });

    audioCache.set(key, data);

    res.json({ success: true, data, meta: { cached: false }, requestId: req.requestId });
  } catch (error) {
    console.error('Audio compose error:', error.message);
    fail(res, req, 500, 'Audio compose failed', error.message, 'AUDIO_COMPOSE_FAILED');
  }
});

// Serve generated audio files
app.get('/api/v1/audio/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(AUDIO_DIR, filename);
  const fs = require('fs');
  if (!fs.existsSync(filepath)) {
    return fail(res, req, 404, 'Audio file not found', null, 'FILE_NOT_FOUND');
  }
  const ext = path.extname(filename).slice(1);
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };
  res.setHeader('Content-Type', mimeMap[ext] || 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(filepath).pipe(res);
});

// Upsert vectors into turbopuffer namespace
app.post('/api/v1/vectors/upsert', async (req, res) => {
  try {
    const { vectors, namespace } = req.body || {};
    if (!Array.isArray(vectors) || vectors.length === 0) {
      return fail(res, req, 400, 'vectors must be a non-empty array', null, 'INVALID_INPUT');
    }
    const data = await turbopuffer.upsert({ vectors, namespace });
    res.json({ success: true, data, count: vectors.length, requestId: req.requestId });
  } catch (error) {
    console.error('Vector upsert error:', error.message);
    fail(res, req, 500, 'Vector upsert failed', error.message, 'VECTOR_UPSERT_FAILED');
  }
});

app.use('/api/v1', (req, res) => {
  fail(res, req, 404, 'Route not found', req.path, 'NOT_FOUND');
});

app.use((error, req, res, next) => {
  if (!error) {
    return next();
  }

  if (error.message === 'CORS origin not allowed') {
    return fail(res, req, 403, 'Origin not allowed', null, 'CORS_DENIED');
  }

  console.error('Unhandled error:', error);
  return fail(res, req, 500, 'Unhandled server error', error.message, 'UNHANDLED_ERROR');
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 VERSIONS Proxy Server');
  console.log('========================');
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/v1/health`);
  console.log('');
  console.log('📋 Environment:');
  console.log(`   AUDIUS_API_KEY: ${process.env.AUDIUS_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`   HELIUS_API_KEY: ${process.env.HELIUS_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`   TURBOPUFFER_API_KEY: ${process.env.TURBOPUFFER_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`   ELEVENLABS_API_KEY: ${process.env.ELEVENLABS_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log('');
  console.log('🌐 Frontend should be at: http://localhost:3000');
});
