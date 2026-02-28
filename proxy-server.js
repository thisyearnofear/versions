#!/usr/bin/env node
// Simple proxy server for VERSIONS hackathon demo
// Securely proxies API requests to hide API keys from frontend

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const PORT = process.env.SERVER_PORT || 8080;

// Database setup
let db;
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
    
    console.log('✅ SQLite Database initialized');
}

initDb().catch(err => console.error('❌ DB Init failed:', err));

// Middleware
app.use(cors());
app.use(express.json());

// Relationship Endpoints
app.get('/api/v1/relationships/:parent_id', async (req, res) => {
    try {
        const { parent_id } = req.params;
        const relations = await db.all('SELECT * FROM track_relationships WHERE parent_id = ?', [parent_id]);
        res.json({ success: true, data: relations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/v1/relationships/link', async (req, res) => {
    try {
        const { parent_id, version_id, version_type, artist_id } = req.body;
        await db.run(
            'INSERT OR REPLACE INTO track_relationships (parent_id, version_id, version_type, artist_id) VALUES (?, ?, ?, ?)',
            [parent_id, version_id, version_type, artist_id]
        );
        res.json({ success: true, message: 'Relationship linked' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/v1/relationships', async (req, res) => {
    try {
        const relations = await db.all('SELECT * FROM track_relationships');
        res.json({ success: true, data: relations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'versions-proxy',
      timestamp: new Date().toISOString()
    }
  });
});

// Proxy Audius coins list
app.get('/api/v1/audius/coins', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const limit = req.query.limit || 100;
    const url = `https://api.audius.co/v1/coins?api_key=${apiKey}&limit=${limit}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Audius coins error:', error);
    res.status(500).json({ error: 'Failed to fetch coins' });
  }
});

// Proxy Audius Resolve (Handle to ID)
app.get('/api/v1/audius/resolve', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const resolveUrl = `https://api.audius.co/v1/resolve?url=${encodeURIComponent(url)}&api_key=${apiKey}`;
    const response = await fetch(resolveUrl);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Audius resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve Audius URL' });
  }
});

// Proxy Audius trending tracks
app.get('/api/v1/audius/trending', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const url = `https://api.audius.co/v1/tracks/trending?api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Audius trending error:', error);
    res.status(500).json({ error: 'Failed to fetch trending tracks' });
  }
});

// Proxy Audius user coins
app.get('/api/v1/audius/user/:user_id/coins', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const { user_id } = req.params;
    const url = `https://api.audius.co/v1/users/${user_id}/coins?api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Audius coins error:', error);
    res.status(500).json({ error: 'Failed to fetch user coins' });
  }
});

// Proxy Audius track search
app.get('/api/v1/audius/search', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const query = req.query.q || '';
    const url = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Audius search error:', error);
    res.status(500).json({ error: 'Failed to search tracks' });
  }
});

// Proxy Audius track by ID
app.get('/api/v1/audius/track/:track_id', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const { track_id } = req.params;
    const url = `https://api.audius.co/v1/tracks/${track_id}?api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Audius track error:', error);
    res.status(500).json({ error: 'Failed to fetch track' });
  }
});

// Proxy Audius track access info (gating status)
app.get('/api/v1/audius/track/:track_id/access-info', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const { track_id } = req.params;
    const url = `https://api.audius.co/v1/tracks/${track_id}/access-info?api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Track access info error:', error);
    res.status(500).json({ error: 'Failed to fetch track access info' });
  }
});

// Proxy Audius track streaming
app.get('/api/v1/audius/stream/:track_id', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const { track_id } = req.params;
    const url = `https://discoveryprovider.audius.co/v1/tracks/${track_id}/stream?api_key=${apiKey}`;
    
    const response = await fetch(url);
    
    // Stream the audio data through
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Pipe the response
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Audius stream error:', error);
    res.status(500).json({ error: 'Failed to stream track' });
  }
});

// Proxy Solana RPC requests through Helius
app.post('/api/v1/solana/rpc', async (req, res) => {
  try {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'HELIUS_API_KEY not configured' },
        id: req.body.id
      });
    }

    const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Solana RPC error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'RPC request failed' },
      id: req.body.id
    });
  }
});

// ARTIST ENDPOINTS

// Get artist's tracks
app.get('/api/v1/artist/:user_id/tracks', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const { user_id } = req.params;
    const url = `https://api.audius.co/v1/users/${user_id}/tracks?api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Artist tracks error:', error);
    res.status(500).json({ error: 'Failed to fetch artist tracks' });
  }
});

// Get artist info
app.get('/api/v1/artist/:user_id', async (req, res) => {
  try {
    const apiKey = process.env.AUDIUS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AUDIUS_API_KEY not configured' });
    }

    const { user_id } = req.params;
    const url = `https://api.audius.co/v1/users/${user_id}?api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Artist info error:', error);
    res.status(500).json({ error: 'Failed to fetch artist info' });
  }
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
  console.log('');
  console.log('🌐 Frontend should be at: http://localhost:3000');
});
