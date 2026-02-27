#!/usr/bin/env node
// Simple proxy server for VERSIONS hackathon demo
// Securely proxies API requests to hide API keys from frontend

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.SERVER_PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

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
