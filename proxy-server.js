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
const { getEnv, getServerConfig } = require('./proxy/runtime/config');
const log = require('./proxy/runtime/logger').log;
const { createRateLimiter } = require('./proxy/runtime/rate-limit');
const {
  validateSubmissionMetadata,
  validateArcTxHash
} = require('./proxy/runtime/validation');
const { createArcAdapter } = require('./proxy/adapters/arc');
const { createSubmissionsService } = require('./proxy/services/submissions');
const { createSettlementService } = require('./proxy/services/settlement');
const { createCurationService } = require('./proxy/services/curation');
const { createFeedService } = require('./proxy/services/feed');
const { createSweeper } = require('./proxy/services/settlement-sweeper');

const PORT = Number(getEnv('PORT', '8080'));
const HOST = getEnv('HOST', '0.0.0.0');
const SERVICE = 'lepton-proxy';
const VERSION = '0.5.0-day5';

// MODULAR: single per-process instance. Reuse across requests.
const ARC_RPC_URL = getEnv('ARC_RPC_URL', '');
const ARC_USDC_CONTRACT = getEnv('ARC_USDC_CONTRACT', '');
const PLATFORM_WALLET = getEnv('PLATFORM_WALLET', '');
const UPLOAD_DIR = path.resolve(__dirname, 'data', 'uploads');
// MODULAR: the JSON body cap is the *post-base64* size of the audio
// bytes, because clients post audio as { base64: '...' } in JSON.
// 70MB JSON ≈ 52MB raw audio (base64 expands by 4/3). Day 5 web
// client posts the file this way; Phase 3's multipart upload will
// let us raise the audio cap without the base64 overhead.
const JSON_BODY_LIMIT = 70 * 1024 * 1024;
const SUBMISSION_BODY_LIMIT = JSON_BODY_LIMIT;
const DEFAULT_BODY_LIMIT = 256 * 1024;            // 256KB

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// MODULAR: rate limiters. The audio route (submissions POST + verify-payment)
// gets a tighter limit; everything else gets a higher default. The
// env-var names are documented in ENVIRONMENT_VARIABLES.md.
const serverConfig = getServerConfig();
const audioLimiter = createRateLimiter({
  windowMs: serverConfig.rateLimitWindowMs,
  max: serverConfig.rateLimitAudioMax,
  label: 'audio'
});
const generalLimiter = createRateLimiter({
  windowMs: serverConfig.rateLimitWindowMs,
  max: serverConfig.rateLimitAudioMax * 4,
  label: 'general'
});

// MODULAR: per-route request timeout. Submissions can be slow (70MB
// JSON body); everything else is fast. A timeout surfaces a 504 to
// the client rather than tying up the event loop on a slow client.
const ROUTE_TIMEOUTS = {
  'POST:/api/v1/submissions':           30_000,
  'POST:/api/v1/submissions/*/verify-payment': 30_000,
  'GET:/api/v1/uploads/*':              10_000
};
const DEFAULT_ROUTE_TIMEOUT_MS = 10_000;

// CLEAN: schema must exist before the service prepares its statements.
// Migrate first, then build services, then start listening.
let arc, submissions, settlement, curation, feed, sweeper;
try {
  const result = runMigrations(openDb());
  if (result.applied.length > 0) {
    log.info('migrations applied', { count: result.applied.length, files: result.applied });
  } else {
    log.info('schema up to date', { migrations: result.skipped.length });
  }
} catch (err) {
  log.error('migration failed', { err: err.message });
  process.exit(1);
}
arc = createArcAdapter({
  rpcUrl: ARC_RPC_URL || null,
  usdcContract: ARC_USDC_CONTRACT || null,
  platformWallet: PLATFORM_WALLET || null
});
// MODULAR: settlement depends on arc; curation depends on settlement.
// CLEAN: a single direction — services depend on adapters, not the other way.
submissions = createSubmissionsService({ arc, platformWallet: PLATFORM_WALLET || null });
settlement = createSettlementService({ arc, platformWallet: PLATFORM_WALLET || null });
curation = createCurationService({ settlement });
feed = createFeedService();
// CLEAN: sweeper takes the same db + settlement the rest of the
// proxy uses. No new state; reads existing rows.
sweeper = createSweeper({ db: openDb(), settlement });

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
      providers: { arc: { mock: !ARC_RPC_URL } }
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

// ---------- Day 4: curation routes ----------

async function handleSubmissionsClaim(req, res, requestId, submissionId) {
  let body;
  try {
    body = await readJsonBody(req, DEFAULT_BODY_LIMIT);
  } catch (err) {
    return errorResponse(res, requestId, err.status || 400, err.code || 'BAD_REQUEST', err.message);
  }
  if (!body || !body.curatorWallet || !body.signature) {
    return errorResponse(res, requestId, 400, 'MISSING_FIELD', 'curatorWallet and signature are required');
  }
  const r = curation.claimSubmission({
    submissionId,
    curatorWallet: body.curatorWallet,
    signature: body.signature
  });
  if (!r.ok) {
    const status = r.error === 'Submission not found' ? 404 : 400;
    return errorResponse(res, requestId, status, 'CLAIM_REJECTED', r.error);
  }
  return jsonResponse(res, 201, { success: true, data: r.claim, claim_message: 'VERSIONS_LEPTON_CLAIM' }, requestId);
}

async function handleSubmissionsRelease(req, res, requestId, submissionId) {
  let body;
  try {
    body = await readJsonBody(req, DEFAULT_BODY_LIMIT);
  } catch (err) {
    // DELETE may carry no body; treat empty as {}
    if (err.code === 'INVALID_JSON' || err.code === 'BODY_READ_ERROR') body = {};
    else return errorResponse(res, requestId, err.status || 400, err.code || 'BAD_REQUEST', err.message);
  }
  const curatorWallet = (body && body.curatorWallet) || '';
  if (!curatorWallet) {
    return errorResponse(res, requestId, 400, 'MISSING_FIELD', 'curatorWallet is required');
  }
  const r = curation.releaseClaim({ submissionId, curatorWallet });
  return jsonResponse(res, 200, { success: true, data: { released: r.released } }, requestId);
}

async function handleSubmissionsRate(req, res, requestId, submissionId) {
  let body;
  try {
    body = await readJsonBody(req, DEFAULT_BODY_LIMIT);
  } catch (err) {
    return errorResponse(res, requestId, err.status || 400, err.code || 'BAD_REQUEST', err.message);
  }
  if (!body || !body.curatorWallet || !body.signature || !body.rating) {
    return errorResponse(res, requestId, 400, 'MISSING_FIELD', 'curatorWallet, signature, and rating are required');
  }
  // MODULAR: submitRating is async (it drives settlement via arc after
  // publish). The route awaits the full path so settle_results land in
  // the response.
  const r = await curation.submitRating({
    submissionId,
    curatorWallet: body.curatorWallet,
    signature: body.signature,
    rating: body.rating
  });
  if (!r.ok) {
    const status = r.error === 'Submission not found' ? 404 : 400;
    return errorResponse(res, requestId, status, 'RATE_REJECTED', r.error);
  }
  return jsonResponse(res, 201, {
    success: true,
    data: {
      rating_id: r.rating_id,
      rating_count: r.rating_count,
      published: r.published
    }
  }, requestId);
}

async function handleCuratorProfile(req, res, requestId, wallet) {
  const profile = curation.getCuratorProfile(wallet);
  return jsonResponse(res, 200, { success: true, data: profile }, requestId);
}

async function handleArtistProfile(req, res, requestId, wallet) {
  const profile = curation.getArtistProfile(wallet);
  return jsonResponse(res, 200, { success: true, data: profile }, requestId);
}

// ---------- Day 5: feed + version detail ----------

function parseQuery(url) {
  // MODULAR: small inline parser. Returns {} when no query string.
  const q = (url || '').split('?')[1];
  if (!q) return {};
  const out = {};
  for (const part of q.split('&')) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = v == null ? '' : decodeURIComponent(v);
  }
  return out;
}

async function handleFeed(req, res, requestId) {
  const q = parseQuery(req.url);
  const result = feed.listPublished({
    limit: q.limit,
    offset: q.offset,
    mood: q.mood,
    energy: q.energy,
    tempo: q.tempo,
    minSolo: q.minSolo != null ? Number(q.minSolo) : undefined,
    maxSolo: q.maxSolo != null ? Number(q.maxSolo) : undefined,
    artistWallet: q.artist
  });
  return jsonResponse(res, 200, { success: true, data: result }, requestId);
}

async function handleVersionGet(req, res, requestId, submissionId) {
  const result = feed.getVersion(submissionId);
  if (!result) return errorResponse(res, requestId, 404, 'NOT_FOUND', 'Version not found');
  return jsonResponse(res, 200, { success: true, data: result }, requestId);
}

// ---------- router ----------

// ---------- static file serving ----------
// MODULAR: serves the web client from the same process so Docker is
// single-port. Matched AFTER all API routes so /api/* + /health/*
// win, and any other path under / tries to serve ./web/<path>.
const WEB_DIR = path.resolve(__dirname, 'web');
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.woff2': 'font/woff2',
  '.txt':  'text/plain; charset=utf-8'
};

function serveStatic(targetPath) {
  // CLEAN: path resolution refuses anything that escapes WEB_DIR. The
  // user can never read /etc/passwd via the web route.
  const decoded = decodeURIComponent(targetPath.split('?')[0]);
  let resolved = path.resolve(WEB_DIR, '.' + decoded);
  if (!resolved.startsWith(WEB_DIR)) return null;
  // MODULAR: if the path is a directory, serve its index.html. If
  // the path has no extension, try appending .html (for /styles/main).
  let candidate = resolved;
  try {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) candidate = path.join(candidate, 'index.html');
  } catch (_) {
    if (!path.extname(candidate)) candidate = candidate + '.html';
  }
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return null;
    const ext = path.extname(candidate).toLowerCase();
    return { path: candidate, mime: STATIC_MIME[ext] || 'application/octet-stream' };
  } catch (_) {
    return null;
  }
}

function handleStatic(req, res, rid, p) {
  const file = serveStatic(p === '/' ? '/index.html' : p);
  if (!file) {
    // MODULAR: fall back to index.html so client-side routing in the
    // SPA still works for unknown paths. The API 404 only fires for
    // /api/* and /health/* (which are matched before this route).
    const idx = serveStatic('/index.html');
    if (!idx) return errorResponse(res, rid, 404, 'NOT_FOUND', 'No web files at ' + p);
    res.writeHead(200, { 'Content-Type': idx.mime, 'Cache-Control': 'no-cache' });
    return fs.createReadStream(idx.path).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'no-cache' });
  return fs.createReadStream(file.path).pipe(res);
}

const ROUTES = [
  { method: 'GET',    match: (p) => p === '/health/live',                              handler: handleHealthLive },
  { method: 'GET',    match: (p) => p === '/health/ready',                             handler: handleHealthReady },
  { method: 'GET',    match: (p) => p === '/api/v1/arc/info',                          handler: handleArcInfo },
  { method: 'POST',   match: (p) => p === '/api/v1/submissions',                       handler: handleSubmissionsCreate },
  { method: 'GET',    match: (p) => p === '/api/v1/submissions/queue',                  handler: handleSubmissionsQueue },
  // Day 4: claim/release/rate must come BEFORE the bare :id pattern.
  { method: 'POST',   match: (p) => /^\/api\/v1\/submissions\/[^/]+\/claim$/.test(p),
            handler: (req, res, rid, p) => handleSubmissionsClaim(req, res, rid, p.split('/')[4]) },
  { method: 'DELETE', match: (p) => /^\/api\/v1\/submissions\/[^/]+\/claim$/.test(p),
            handler: (req, res, rid, p) => handleSubmissionsRelease(req, res, rid, p.split('/')[4]) },
  { method: 'POST',   match: (p) => /^\/api\/v1\/submissions\/[^/]+\/rate$/.test(p),
            handler: (req, res, rid, p) => handleSubmissionsRate(req, res, rid, p.split('/')[4]) },
  { method: 'POST',   match: (p) => /^\/api\/v1\/submissions\/[^/]+\/verify-payment$/.test(p),
            handler: (req, res, rid, p) => handleSubmissionsVerifyPayment(req, res, rid, p.split('/')[4]) },
  { method: 'GET',    match: (p) => /^\/api\/v1\/submissions\/[^/]+$/.test(p),
            handler: (req, res, rid, p) => handleSubmissionsGet(req, res, rid, p.split('/')[4]) },
  { method: 'GET',    match: (p) => /^\/api\/v1\/uploads\/[^/]+$/.test(p),
            handler: (req, res, rid, p) => handleUploadGet(req, res, rid, p.split('/')[4]) },
  { method: 'GET',    match: (p) => /^\/api\/v1\/curators\/[^/]+$/.test(p),
            handler: (req, res, rid, p) => handleCuratorProfile(req, res, rid, p.split('/')[4]) },
  { method: 'GET',    match: (p) => /^\/api\/v1\/artists\/[^/]+$/.test(p),
            handler: (req, res, rid, p) => handleArtistProfile(req, res, rid, p.split('/')[4]) },
  // Day 5: feed + version detail. The /api/v1/versions/:id route must
  // not collide with /api/v1/submissions/:id, so we keep them apart.
  { method: 'GET',    match: (p) => p === '/api/v1/feed',                              handler: handleFeed },
  { method: 'GET',    match: (p) => /^\/api\/v1\/versions\/[^/]+$/.test(p),
            handler: (req, res, rid, p) => handleVersionGet(req, res, rid, p.split('/')[4]) },
  // MODULAR: static-file fallback. Anything not matched above is
  // served from ./web/. Unknown paths fall through to index.html so
  // the SPA can take over (we have no client-side router yet, but
  // this keeps the door open).
  { method: 'GET',    match: (p) => !p.startsWith('/api/') && !p.startsWith('/health/'),
            handler: handleStatic }
];

// MODULAR: in-flight request tracking for graceful shutdown. The Set
// is bounded by the request rate; each request adds itself on entry
// and removes itself on completion.
const inFlight = new Set();
let shuttingDown = false;

const server = http.createServer(async (req, res) => {
  // PERFORMANT: refuse new requests immediately when shutting down.
  if (shuttingDown) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Connection': 'close' });
    res.end(JSON.stringify({ success: false, error: { code: 'SHUTTING_DOWN', message: 'Server is shutting down' } }));
    return;
  }

  const requestId = requestContext(req);
  const url = (req.url || '/').split('?')[0];
  inFlight.add(requestId);
  // PERFORMANT: per-route timeout. The request is aborted if the
  // handler doesn't return within the budget. The budget is computed
  // by matching the route + method against ROUTE_TIMEOUTS.
  const timeoutKey = `${req.method}:${url.replace(/\/[^/]+$/, '/*')}`;
  const timeoutMs = ROUTE_TIMEOUTS[timeoutKey] || ROUTE_TIMEOUTS[`${req.method}:${url}`] || DEFAULT_ROUTE_TIMEOUT_MS;
  const timer = setTimeout(() => {
    log.warn('request timeout', { request_id: requestId, method: req.method, url, timeoutMs });
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'TIMEOUT', message: `Request exceeded ${timeoutMs}ms`, requestId } }));
    }
    try { req.destroy(); } catch (_) { /* noop */ }
  }, timeoutMs);

  // MODULAR: CORS preflight + actual CORS headers. Manual because the
  // proxy is raw http (no express). Without these, the web client on
  // :3000 can't call the proxy on :8080 from a browser.
  if (req.method === 'OPTIONS') {
    clearTimeout(timer);
    inFlight.delete(requestId);
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-request-id',
      'Access-Control-Max-Age': '600',
      'x-request-id': requestId
    });
    res.end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');

  // MODULAR: rate limit check. The audio routes get the tighter
  // bucket; everything else gets the general bucket. Both limits
  // are per-IP and rate-limited to 429 with the standard envelope.
  const isAudioRoute = (url === '/api/v1/submissions' ||
                       /^\/api\/v1\/submissions\/[^/]+\/verify-payment$/.test(url) ||
                       /^\/api\/v1\/uploads\/[^/]+$/.test(url));
  const limiter = isAudioRoute ? audioLimiter : generalLimiter;
  if (!limiter.allow(req)) {
    clearTimeout(timer);
    inFlight.delete(requestId);
    res.setHeader('Retry-After', '60');
    return errorResponse(res, requestId, 429, 'RATE_LIMITED', 'Too many requests — try again in 60s');
  }

  const startMs = Date.now();
  try {
    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      if (r.match(url)) {
        const out = await r.handler(req, res, requestId, url);
        log.info('request', { request_id: requestId, method: req.method, url, duration_ms: Date.now() - startMs, status: res.statusCode });
        return out;
      }
    }
    const out = errorResponse(res, requestId, 404, 'NOT_FOUND', `No route for ${req.method} ${url}`);
    log.info('request', { request_id: requestId, method: req.method, url, duration_ms: Date.now() - startMs, status: 404 });
    return out;
  } catch (err) {
    log.error('handler failed', { request_id: requestId, method: req.method, url, err: err.message, stack: err.stack });
    if (!res.headersSent) return errorResponse(res, requestId, 500, 'INTERNAL', err.message);
  } finally {
    clearTimeout(timer);
    inFlight.delete(requestId);
  }
});

// MODULAR: graceful shutdown. On SIGTERM/SIGINT, stop accepting new
// requests (shuttingDown flag), wait up to 10s for the in-flight set
// to drain, stop the sweeper, close the DB, then exit. The structured
// logger is the last thing to run so a final 'shutdown complete'
// line lands in the log aggregator.
let shutdownInProgress = null;
function shutdown(signal) {
  if (shutdownInProgress) return shutdownInProgress;
  shutdownInProgress = (async () => {
    log.info('shutdown initiated', { signal, in_flight: inFlight.size });
    shuttingDown = true;
    // CLEAN: server.close() stops accepting new connections; existing
    // ones are allowed to finish. The 10s cap protects against a
    // stuck client holding the process open.
    await new Promise((resolve) => {
      const closeTimer = setTimeout(() => {
        log.warn('shutdown timeout — forcing close', { in_flight: inFlight.size });
        resolve();
      }, 10_000);
      server.close(() => { clearTimeout(closeTimer); resolve(); });
    });
    sweeper.stop();
    closeDb();
    log.info('shutdown complete');
    process.exit(0);
  })();
  return shutdownInProgress;
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

sweeper.start({ intervalMs: 60_000 });
log.info('proxy listening', { host: HOST, port: PORT, version: VERSION, arc: ARC_RPC_URL ? 'real' : 'mock' });

server.listen(PORT, HOST, () => {
  // Boot line. The structured log above is the canonical record;
  // this one is for human greps of stdout.
  process.stdout.write(`[lepton] listening on http://${HOST}:${PORT} (${VERSION})\n`);
});
