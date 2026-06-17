#!/usr/bin/env node
// scripts/seed-demo.js — populate the feed with 4 demo submissions so
// the web client's Feed tab is alive on first load.
//
// Runs against whatever proxy is on PORT (default 8080). Uses mock
// payment + a fresh set of artist/curator keypairs, so it's safe to
// run against any environment (real Arc or mock).
//
// MODULAR: each submission is a deterministic fixture — title, artist,
// metadata, ratings. The taste graph covers a range of moods so the
// feed's filter chips exercise different rows.

'use strict';

const http = require('http');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const PORT = Number(process.env.PORT || 8080);
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, method, path,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = { success: false, error: { message: text } }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sign(message, secretKey) {
  return Buffer.from(nacl.sign.detached(Buffer.from(message, 'utf8'), secretKey)).toString('base64');
}
function walletOf(kp) { return bs58.encode(kp.publicKey); }
function randHex(n) { return '0x' + crypto.randomBytes(n).toString('hex'); }

// MODULAR: minimal WAV (PCM 8 kHz, 8-bit mono, 0.25s silence). The
// browser's <audio> handles it; nothing else cares.
// MODULAR: deterministic waveform cover. Given a seed byte,
// produces a 64-peak waveform. Different seed bytes give
// different covers, so the 4 demo submissions each have a
// distinct visual identity. This mirrors what the browser
// does for real uploads (decodeAudioData → 64 peaks → SVG).
function generateCoverSvg(seedByte, size) {
  size = size || 200;
  const peaks = [];
  for (let i = 0; i < 64; i++) {
    // MODULAR: a 2D Lissajous-ish curve plus a small random
    // perturbation keyed by seed. Deterministic so the
    // covers are stable across reseeds.
    const t = (i / 63) * Math.PI * 4;
    const v = Math.abs(Math.sin(t + seedByte * 0.7) * Math.cos(t * 0.5 + seedByte * 0.3));
    peaks.push(v);
  }
  // MODULAR: normalise to [0, 1].
  let max = 0;
  for (const p of peaks) if (p > max) max = p;
  for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / max;
  const mid = size / 2;
  const inset = size * 0.04;
  const drawW = size - inset * 2;
  const upper = [];
  for (let i = 0; i < peaks.length; i++) {
    const x = inset + (i / 63) * drawW;
    const h = peaks[i] * (mid - inset);
    upper.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${(mid - h).toFixed(1)}`);
  }
  const lower = [];
  for (let i = 0; i < peaks.length; i++) {
    const x = inset + (i / 63) * drawW;
    const h = peaks[i] * (mid - inset);
    lower.push(`${x.toFixed(1)},${(mid + h).toFixed(1)}`);
  }
  const path = upper.concat(lower.slice().reverse()).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Waveform"><rect width="${size}" height="${size}" fill="#f4efe5"/><line x1="0" y1="${mid}" x2="${size}" y2="${mid}" stroke="#c84a1f" stroke-opacity="0.15" stroke-width="0.5"/><path d="${path} Z" fill="#c84a1f" fill-opacity="0.30" stroke="#c84a1f" stroke-width="1"/></svg>`;
}

function buildWav(seedByte) {
  const sampleRate = 8000;
  const numSamples = sampleRate;  // 1s of audio
  const dataSize = numSamples;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);             // fmt chunk size
  buf.writeUInt16LE(1, 20);              // PCM
  buf.writeUInt16LE(1, 22);              // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);     // byte rate
  buf.writeUInt16LE(1, 32);              // block align
  buf.writeUInt16LE(8, 34);              // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) buf[44 + i] = (i + seedByte) & 0xff;
  return buf;
}

const makeWav = buildWav;

async function submitAndPublish(meta, ratingsSpec, audio, coverSvg) {
  const artist = nacl.sign.keyPair();
  const curators = [nacl.sign.keyPair(), nacl.sign.keyPair(), nacl.sign.keyPair()];

  // 1. Submit
  const sub = await request('POST', '/api/v1/submissions', {
    artistWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_SUBMIT', artist.secretKey),
    metadata: { ...meta, coverSvg: coverSvg || null },
    audio: { contentType: 'audio/wav', base64: audio.toString('base64'), durationSeconds: 1 }
  });
  if (sub.status !== 201) throw new Error(`submit failed: ${sub.status} ${JSON.stringify(sub.body)}`);
  const submissionId = sub.body.data.id;
  console.log(`  [+] submitted "${meta.title}" (id ${submissionId.slice(0, 8)}…)`);

  // 2. Verify payment (mock tx hash is fine in dev)
  const pay = await request('POST', `/api/v1/submissions/${submissionId}/verify-payment`, { txHash: randHex(32) });
  if (pay.status !== 200) throw new Error(`verify-payment failed: ${pay.status}`);

  // 3. Claim + rate from 3 curators
  for (let i = 0; i < 3; i++) {
    const c = curators[i];
    const claim = await request('POST', `/api/v1/submissions/${submissionId}/claim`, {
      curatorWallet: walletOf(c),
      signature: sign('VERSIONS_LEPTON_CLAIM', c.secretKey)
    });
    if (claim.status !== 201) throw new Error(`claim failed: ${claim.status}`);
    const rate = await request('POST', `/api/v1/submissions/${submissionId}/rate`, {
      curatorWallet: walletOf(c),
      signature: sign('VERSIONS_LEPTON_RATE', c.secretKey),
      rating: ratingsSpec[i]
    });
    if (rate.status !== 201) throw new Error(`rate failed: ${rate.status} ${JSON.stringify(rate.body)}`);
    if (rate.body.data.published && !rate.body.data.published.alreadyPublished) {
      console.log(`  [✓] published after 3 ratings`);
    }
  }
  return submissionId;
}

async function main() {
  // DRY: confirm the proxy is up before we generate any state.
  const health = await request('GET', '/health/ready');
  if (health.status !== 200) {
    console.error(`Proxy not reachable on ${BASE}. Start it first: node proxy-server.js`);
    process.exit(1);
  }
  console.log(`Seeding ${BASE}…\n`);

  const fixtures = [
    {
      meta: { title: 'Gravity (Acoustic Demo)', artistName: 'JMayer', versionType: 'demo', genre: 'Folk', mood: 'Intimate' },
      ratings: [
        { solo_intensity: 9, vocal_quality: 8, energy_vs_studio: 'lower', tempo_feel: 'dragging', mood_tags: ['Bluesy', 'Intimate'], notes: 'Stunning phrasing.' },
        { solo_intensity: 8, vocal_quality: 9, energy_vs_studio: 'lower', tempo_feel: 'locked',   mood_tags: ['Intimate', 'Raw'], notes: null },
        { solo_intensity: 7, vocal_quality: 7, energy_vs_studio: 'same',  tempo_feel: 'dragging', mood_tags: ['Acoustic', 'Bluesy'], notes: null }
      ]
    },
    {
      meta: { title: 'Rolling in the Deep (Live at Brixton)', artistName: 'AdeleS', versionType: 'live', genre: 'Soul', mood: 'Raw' },
      ratings: [
        { solo_intensity: 6, vocal_quality: 10, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: ['Euphoric', 'Powerful'], notes: 'Vocal runs for days.' },
        { solo_intensity: 5, vocal_quality: 9,  energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: ['Euphoric', 'Raw'], notes: null },
        { solo_intensity: 7, vocal_quality: 10, energy_vs_studio: 'higher', tempo_feel: 'rushing', mood_tags: ['Powerful', 'Anthemic'], notes: null }
      ]
    },
    {
      meta: { title: 'Black (Studio Cut, Take 3)', artistName: 'JackW', versionType: 'studio', genre: 'Indie', mood: 'Melancholic' },
      ratings: [
        { solo_intensity: 4, vocal_quality: 7, energy_vs_studio: 'same', tempo_feel: 'locked',  mood_tags: ['Brooding', 'Raw'], notes: null },
        { solo_intensity: 5, vocal_quality: 6, energy_vs_studio: 'same', tempo_feel: 'locked',  mood_tags: ['Intimate'], notes: null },
        { solo_intensity: 3, vocal_quality: 7, energy_vs_studio: 'same', tempo_feel: 'locked',  mood_tags: ['Melancholic'], notes: null }
      ]
    },
    {
      meta: { title: 'Tumbling Dice (Acoustic Blues)', artistName: 'JRich', versionType: 'acoustic', genre: 'Blues', mood: 'Euphoric' },
      ratings: [
        { solo_intensity: 8, vocal_quality: 6, energy_vs_studio: 'lower', tempo_feel: 'dragging', mood_tags: ['Bluesy', 'Euphoric'], notes: 'Honest.' },
        { solo_intensity: 9, vocal_quality: 7, energy_vs_studio: 'lower', tempo_feel: 'dragging', mood_tags: ['Bluesy'], notes: null },
        { solo_intensity: 7, vocal_quality: 6, energy_vs_studio: 'same',  tempo_feel: 'dragging', mood_tags: ['Euphoric'], notes: null }
      ]
    }
  ];

  for (let i = 0; i < fixtures.length; i++) {
    const seedByte = i * 17;
    const audio = makeWav(seedByte);
    // MODULAR: Move 3 — each demo submission gets a unique
    // cover derived from its seed byte. Stable across
    // reseeds (deterministic).
    const coverSvg = generateCoverSvg(seedByte);
    await submitAndPublish(fixtures[i].meta, fixtures[i].ratings, audio, coverSvg);
  }

  console.log(`\nDone. The feed now has ${fixtures.length} published versions.`);
  console.log(`Open http://localhost:3000 and click the Feed tab.`);
}

main().catch((err) => { console.error('seed failed:', err); process.exit(1); });
