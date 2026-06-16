#!/usr/bin/env node
// End-to-end Day 5 smoke: submit → verify → 3 curators claim+rate → publish
// fires (with settlement_legs settled by mock Arc) → feed shows the version
// → version detail shows the 5 settled legs.

'use strict';

const http = require('http');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const PORT = Number(process.env.PORT || '18099');
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

function expect(cond, msg) {
  if (!cond) { console.error('  ✖', msg); process.exit(1); }
  console.log('  ✓', msg);
}

async function main() {
  console.log('=== Day 5 smoke ===');

  console.log('\n--- /health/ready ---');
  const r = await request('GET', '/health/ready');
  expect(r.status === 200, 'health/ready 200');
  expect(r.body.data.service === 'lepton-proxy', 'service is lepton-proxy');

  console.log('\n--- /api/v1/arc/info ---');
  const arc = await request('GET', '/api/v1/arc/info');
  expect(arc.status === 200, 'arc/info 200');
  expect(arc.body.data.mock === true, 'arc is in mock mode');

  const artist = nacl.sign.keyPair();
  const c1 = nacl.sign.keyPair();
  const c2 = nacl.sign.keyPair();
  const c3 = nacl.sign.keyPair();

  console.log('\n--- POST /api/v1/submissions ---');
  const audio = crypto.randomBytes(1024);
  const sub = await request('POST', '/api/v1/submissions', {
    artistWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_SUBMIT', artist.secretKey),
    metadata: { title: 'Day5 Smoke', artistName: 'Smokey', versionType: 'live', genre: 'Blues', mood: 'Raw' },
    audio: { contentType: 'audio/mpeg', base64: audio.toString('base64'), durationSeconds: 240 }
  });
  expect(sub.status === 201, 'submission 201');
  const submissionId = sub.body.data.id;
  console.log('  submission_id:', submissionId);

  console.log('\n--- POST /api/v1/submissions/:id/verify-payment ---');
  const pay = await request('POST', `/api/v1/submissions/${submissionId}/verify-payment`, { txHash: randHex(32) });
  expect(pay.status === 200, 'verify-payment 200');
  expect(pay.body.data.status === 'awaiting_curation', 'status flipped to awaiting_curation');

  console.log('\n--- 3 curators claim + rate ---');
  for (const [i, curator] of [c1, c2, c3].entries()) {
    const claim = await request('POST', `/api/v1/submissions/${submissionId}/claim`, {
      curatorWallet: walletOf(curator),
      signature: sign('VERSIONS_LEPTON_CLAIM', curator.secretKey)
    });
    expect(claim.status === 201, `curator ${i + 1} claim 201`);
    const rating = {
      solo_intensity: 5 + i,
      vocal_quality: 6 + i,
      energy_vs_studio: i === 2 ? 'same' : 'higher',
      tempo_feel: i === 0 ? 'rushing' : 'locked',
      mood_tags: [['Bluesy', 'Raw'], ['Euphoric'], ['Raw']][i],
      notes: null
    };
    const rate = await request('POST', `/api/v1/submissions/${submissionId}/rate`, {
      curatorWallet: walletOf(curator),
      signature: sign('VERSIONS_LEPTON_RATE', curator.secretKey),
      rating
    });
    expect(rate.status === 201, `curator ${i + 1} rate 201`);
    if (i === 2) {
      expect(rate.body.data.published && !rate.body.data.published.alreadyPublished, 'publish fired on 3rd rating');
      const legs = rate.body.data.published.settlement_legs;
      expect(legs.length === 5, `5 settlement legs (got ${legs.length})`);
      const allSettled = legs.every((l) => l.status === 'settled' && l.tx_hash);
      expect(allSettled, 'all 5 legs settled with tx_hash');
      const total = legs.reduce((a, l) => a + Number.parseFloat(l.amount_usdc), 0);
      expect(Math.abs(total - 0.5) < 1e-9, `legs sum to 0.5 USDC (got ${total})`);
    }
  }

  console.log('\n--- GET /api/v1/feed ---');
  const feed = await request('GET', '/api/v1/feed?limit=10');
  expect(feed.status === 200, 'feed 200');
  expect(feed.body.data.total >= 1, `feed has at least 1 version (got ${feed.body.data.total})`);
  const found = feed.body.data.rows.find((r) => r.submission_id === submissionId);
  expect(!!found, 'our submission is in the feed');

  console.log('\n--- GET /api/v1/feed?mood=Bluesy ---');
  const feedM = await request('GET', '/api/v1/feed?mood=Bluesy');
  expect(feedM.status === 200, 'feed (filtered) 200');
  for (const row of feedM.body.data.rows) {
    expect(JSON.parse(row.aggregated_mood_tags).includes('Bluesy'), `row ${row.submission_id.slice(0, 8)}… has Bluesy tag`);
  }

  console.log('\n--- GET /api/v1/versions/:id ---');
  const v = await request('GET', `/api/v1/versions/${submissionId}`);
  expect(v.status === 200, 'version detail 200');
  expect(v.body.data.version.submission_id === submissionId, 'version id matches');
  expect(v.body.data.settlement_legs.length === 5, '5 settlement legs in detail');
  for (const leg of v.body.data.settlement_legs) {
    expect(leg.status === 'settled' && !!leg.tx_hash, `leg ${leg.recipient_role} settled with tx_hash`);
  }

  console.log('\n--- GET /api/v1/curators/:wallet ---');
  const c1prof = await request('GET', `/api/v1/curators/${walletOf(c1)}`);
  expect(c1prof.status === 200, 'curator profile 200');
  expect(c1prof.body.data.ratings_count === 1, `curator ratings_count=1 (got ${c1prof.body.data.ratings_count})`);
  expect(c1prof.body.data.total_earned_usdc > 0, `curator earned > 0 (got ${c1prof.body.data.total_earned_usdc})`);

  console.log('\n--- GET /api/v1/artists/:wallet ---');
  const aProf = await request('GET', `/api/v1/artists/${walletOf(artist)}`);
  expect(aProf.status === 200, 'artist profile 200');
  expect(aProf.body.data.published_count === 1, `artist published_count=1 (got ${aProf.body.data.published_count})`);

  console.log('\n--- 4th curator cannot claim a published submission ---');
  const c4 = nacl.sign.keyPair();
  const c4claim = await request('POST', `/api/v1/submissions/${submissionId}/claim`, {
    curatorWallet: walletOf(c4),
    signature: sign('VERSIONS_LEPTON_CLAIM', c4.secretKey)
  });
  expect(c4claim.status === 400, '4th curator claim 400');
  expect(/published/i.test(c4claim.body.error.message), '4th curator error mentions status');

  console.log('\n=== Day 5 smoke complete ===');
}

main().catch((err) => { console.error('smoke failed:', err); process.exit(1); });
