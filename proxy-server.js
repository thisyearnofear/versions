#!/usr/bin/env node
// MODULAR: Lepton proxy entry. Owns HTTP listener + route registration.
// CLEAN: routes are thin; domain logic lives in services/.
// DRY: one runtime, one db, one config, one SettlementProvider (arc).
// PERFORMANT: idempotent migrate on boot; JSON body parsing with per-route
//             size cap; standard error envelope with request id.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { runMigrations } = require('./proxy/migrate');
const { openDb, closeDb, DEFAULT_DB_PATH } = require('./proxy/db');
const { getEnv } = require('./proxy/runtime/config');
const {
  validateSubmissionMetadata,
  validateArcTxHash
} = require('./proxy/runtime/validation');
const { createArcAdapter } = require('./proxy/adapters/arc');
const { createMusicBrainzAdapter } = require('./proxy/adapters/musicbrainz');
const { createSubmissionsService } = require('./proxy/services/submissions');
// AUDIUS adapter is reused (ENHANCEMENT FIRST) for musicbrainz wallet hints.
const { createAudiusAdapter } = require('./proxy/adapters/audius');

const PORT = Number(getEnv('PORT', '8080'));
const HOST = getEnv('HOST', '0.0.0.0');
const SERVICE = 'lepton-proxy';
const VERSION = '0.3.0-day3';

// MODULAR: single per-process instance. Reuse across requests.
const ARC_RPC_URL = getEnv('ARC_RPC_URL', '');
const ARC_USDC_CONTRACT = getEnv('ARC_USDC_CONTRACT', '');
const PLATFORM_WALLET = getEnv('PLATFORM_WALLET', '');
const AUDIUS_API_KEY = getEnv('AUDIUS_API_KEY', '');
const UPLOAD_DIR = path.resolve(__dirname, 'data', 'uploads');
const SUBMISSION_BODY_LIMIT = 70 * 1024 * 1024;   // ~50MB binary as base64
const DEFAULT_BODY_LIMIT = 256 * 1024;            // 256KB

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// CLEAN: schema must exist before the service prepares its statements.
// Migrate first, then build services, then start listening.
let arc, musicbrainz, audius, submissions;
try {
  const result = runMigrations(openDb());
  if (result.applied.length > 0) {
    console.log(`[lepton] applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
  } else {
    console.log(`[lepton] schema up to date (${result.skipped.length} migration(s))`);
  }
} catch (err) {
  console.error('[lepton] migration failed:', err.message);
  process.exit(1);
}

arc = createArcAdapter({
  rpcUrl: ARC_RPC_URL || null,
  usdcContract: ARC_USDC_CONTRACT || null,
  platformWallet: PLATFORM_WALLET || null
});
audius = createAudiusAdapter({ apiKey: AUDIUS_API_KEY || null, requestTimeoutMs: 8000 });
musicbrainz = createMusicBrainzAdapter({ requestTimeoutMs: 8000, audius });
submissions = createSubmissionsService({ arc, platformWallet: PLATFORM_WALLET || null });

// ---------- helpers ----------

function jsonResponse(res, status, body, requestId) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'x-request-id': requestId
  });
  res.end(payload);
}

function errorResponse(res, requestId, status, code, message, details) {
  return jsonResponse(res, status, {
    success: false,
    error: { code, message, details: details || null, requestId }
  }, requestId);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('Body too large'), { status: 413, code: 'BODY_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : null);
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON: ' + err.message), { status: 400, code: 'INVALID_JSON' }));
      }
    });
    req.on('error', (err) => reject(Object.assign(err, { status: 400, code: 'BODY_READ_ERROR' })));
  });
}

function requestContext(req) {
  const incoming = req.headers['x-request-id'];
  return (typeof incoming === 'string' && incoming.trim()) ? incoming.trim() : crypto.randomUUID();
}

const MIME = {
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm'
};

function safeUploadPath(filename) {
  // path.basename + reject ".." so traversal cannot escape UPLOAD_DIR.
  const base = path.basename(filename);
  if (!base || base.includes('..') || base.includes('/') || base.includes('\\')) return null;
  return path.join(UPLOAD_DIR, base);
}

// ---------- route table (CLEAN: thin handlers) ----------

async function handleHealthLive(req, res, requestId) {
  return jsonResponse(res, 200, {
    success: true,
    data: { status: 'ok', service: SERVICE, version: VERSION }
  }, requestId);
}

async function handleHealthReady(req, res, requestId) {
  // PERFORMANT: cheap reachability probe. The migrations on boot guarantee
  // the schema is up to date; the live check is just "are we listening".
  return jsonResponse(res, 200, {
    success: true,
    data: {
      status: 'ready',
      service: SERVICE,
      version: VERSION,
      providers: { arc: { mock: !ARC_RPC_URL }, musicbrainz: true, audius: Boolean(AUDIUS_API_KEY) }
    }
  }, requestId);
}

async function handleArcInfo(req, res, requestId) {
  const info = await arc.getInfo();
  return jsonResponse(res, 200, { success: true, data: info }, requestId);
}

async function handleSubmissionsCreate(req, res, requestId) {
  let body;
  try {
    body = await readJsonBody(req, SUBMISSION_BODY_LIMIT);
  } catch (err) {
    return errorResponse(res, requestId, err.status || 400, err.code || 'BAD_REQUEST', err.message);
  }

  const metadata = body && body.metadata;
  const validation = validateSubmissionMetadata(metadata);
  if (!validation.ok) {
    return errorResponse(res, requestId, 400, 'INVALID_METADATA', 'metadata validation failed', validation.errors);
  }
  if (!body.artistWallet) {
    return errorResponse(res, requestId, 400, 'MISSING_FIELD', 'artistWallet is required');
  }
  if (!body.signature) {
    return errorResponse(res, requestId, 400, 'MISSING_FIELD', 'signature is required');
  }
  if (!body.audio || typeof body.audio !== 'object' || !body.audio.base64) {
    return errorResponse(res, requestId, 400, 'MISSING_FIELD', 'audio.base64 is required');
  }

  // MODULAR: decode + write the audio file. Routes handle I/O; service handles DB.
  let audioBuffer;
  try {
    audioBuffer = Buffer.from(body.audio.base64, 'base64');
  } catch (err) {
    return errorResponse(res, requestId, 400, 'INVALID_AUDIO', 'audio.base64 could not be decoded');
  }
  if (audioBuffer.length === 0) {
    return errorResponse(res, requestId, 400, 'INVALID_AUDIO', 'audio is empty');
  }

  const ext = (body.audio.contentType || 'audio/mpeg')
    .replace(/^audio\//, '')
    .replace(/[^a-z0-9]/gi, '') || 'mp3';
  const filename = `${crypto.randomUUID()}.${ext}`;
  const audioPath = `data/uploads/${filename}`;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), audioBuffer);
  } catch (err) {
    return errorResponse(res, requestId, 500, 'UPLOAD_FAILED', err.message);
  }

  const result = submissions.createSubmission({
    audioPath,
    contentType: body.audio.contentType || 'audio/mpeg',
    sizeBytes: audioBuffer.length,
    durationSeconds: body.audio.durationSeconds || null,
    metadata: { ...metadata, audiusTrackId: body.audio.audiusTrackId },
    artistWallet: body.artistWallet,
    signature: body.signature
  });

  if (!result.ok) {
    // Clean up the orphan file on auth/validation failure.
    try { fs.unlinkSync(path.join(UPLOAD_DIR, filename)); } catch (_) { /* ignore */ }
    return errorResponse(res, requestId, 400, 'SUBMISSION_REJECTED', result.error);
  }

  return jsonResponse(res, 201, {
    success: true,
    data: {
      id: result.submission.id,
      fee_quote_usdc: result.submission.fee_quote_usdc,
      payment_address: PLATFORM_WALLET || null,
      status: result.submission.status,
      audio_url: `/api/v1/uploads/${filename}`,
      submission_message: 'VERSIONS_LEPTON_SUBMIT'
    }
  }, requestId);
}

async function handleSubmissionsQueue(req, res, requestId) {
  const limit = Number(req.url.split('?')[1]?.match(/limit=(\d+)/)?.[1]) || 20;
  const offset = Number(req.url.split('?')[1]?.match(/offset=(\d+)/)?.[1]) || 0;
  const rows = submissions.listQueue({ limit, offset });
  return jsonResponse(res, 200, { success: true, data: rows }, requestId);
}

async function handleSubmissionsGet(req, res, requestId, id) {
  const row = submissions.getSubmission(id);
  if (!row) return errorResponse(res, requestId, 404, 'NOT_FOUND', 'Submission not found');
  return jsonResponse(res, 200, { success: true, data: row }, requestId);
}

async function handleSubmissionsVerifyPayment(req, res, requestId, id) {
  let body;
  try {
    body = await readJsonBody(req, DEFAULT_BODY_LIMIT);
  } catch (err) {
    return errorResponse(res, requestId, err.status || 400, err.code || 'BAD_REQUEST', err.message);
  }
  const txError = validateArcTxHash(body && body.txHash);
  if (txError) {
    return errorResponse(res, requestId, 400, 'INVALID_TX_HASH', txError);
  }
  const r = await submissions.verifyPayment(id, body.txHash);
  if (!r.ok) {
    const status = r.error === 'Submission not found' ? 404 : 400;
    return errorResponse(res, requestId, status, 'VERIFY_PAYMENT_FAILED', r.error);
  }
  return jsonResponse(res, 200, { success: true, data: r.submission }, requestId);
}

async function handleUploadGet(req, res, requestId, filename) {
  // CLEAN: uploads are unguessable UUIDs. Day 3 keeps the gate loose so the
  // demo flow works; Day 5 wires a proper claim/owner check.
  const safe = safeUploadPath(filename);
  if (!safe) return errorResponse(res, requestId, 400, 'BAD_FILENAME', 'Invalid filename');
  if (!fs.existsSync(safe)) return errorResponse(res, requestId, 404, 'NOT_FOUND', 'Audio not found');
  const ext = path.extname(safe).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'x-request-id': requestId
  });
  fs.createReadStream(safe).pipe(res);
}

// ---------- router ----------

const ROUTES = [
  { method: 'GET',    match: (p) => p === '/health/live',                              handler: handleHealthLive },
  { method: 'GET',    match: (p) => p === '/health/ready',                             handler: handleHealthReady },
  { method: 'GET',    match: (p) => p === '/api/v1/arc/info',                          handler: handleArcInfo },
  { method: 'POST',   match: (p) => p === '/api/v1/submissions',                       handler: handleSubmissionsCreate },
  { method: 'GET',    match: (p) => p === '/api/v1/submissions/queue',                  handler: handleSubmissionsQueue },
  { method: 'POST',   match: (p) => /^\/api\/v1\/submissions\/[^/]+\/verify-payment$/.test(p),
            handler: (req, res, rid, p) => handleSubmissionsVerifyPayment(req, res, rid, p.split('/')[4]) },
  { method: 'GET',    match: (p) => /^\/api\/v1\/submissions\/[^/]+$/.test(p),
            handler: (req, res, rid, p) => handleSubmissionsGet(req, res, rid, p.split('/')[4]) },
  { method: 'GET',    match: (p) => /^\/api\/v1\/uploads\/[^/]+$/.test(p),
            handler: (req, res, rid, p) => handleUploadGet(req, res, rid, p.split('/')[4]) }
];

const server = http.createServer(async (req, res) => {
  const requestId = requestContext(req);
  const url = (req.url || '/').split('?')[0];
  try {
    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      if (r.match(url)) return await r.handler(req, res, requestId, url);
    }
    return errorResponse(res, requestId, 404, 'NOT_FOUND', `No route for ${req.method} ${url}`);
  } catch (err) {
    console.error(`[lepton] ${req.method} ${url} failed:`, err);
    return errorResponse(res, requestId, 500, 'INTERNAL', err.message);
  }
});

// ---------- shutdown + boot ----------

function shutdown(signal) {
  console.log(`[lepton] ${signal} received, closing`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, HOST, () => {
  console.log(`[lepton] listening on http://${HOST}:${PORT} (${VERSION})`);
  console.log(`[lepton] arc: ${ARC_RPC_URL ? 'real' : 'mock'}, audius: ${AUDIUS_API_KEY ? 'configured' : 'no-key'}, uploads: ${UPLOAD_DIR}`);
});
