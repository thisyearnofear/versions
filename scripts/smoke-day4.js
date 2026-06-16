#!/usr/bin/env node
// Smoke test for the Day 4 routes. End-to-end:
// submit → verify-payment → 3 curators claim+rate → publish fires
// → 5 settlement legs (3 curators + platform + musicbrainz).

'use strict';

const http = require('http');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const PORT = Number(process.env.PORT || '18092');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, method, path,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': data.length } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
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

function walletOf(kp) {
  return bs58.encode(kp.publicKey);
}

async function curatorClaimAndRate({ submissionId, curator, solo, vocal, energy, tempo, mood, notes }) {
  const claim = await request('POST', `/api/v1/submissions/${submissionId}/claim`, {
    curatorWallet: walletOf(curator),
    signature: sign('VERSIONS_LEPTON_CLAIM', curator.secretKey)
  });
  if (claim.status !== 201) throw new Error(`claim failed: ${claim.status} ${JSON.stringify(claim.body)}`);

  const rate = await request('POST', `/api/v1/submissions/${submissionId}/rate`, {
    curatorWallet: walletOf(curator),
    signature: sign('VERSIONS_LEPTON_RATE', curator.secretKey),
    rating: { solo_intensity: solo, vocal_quality: vocal, energy_vs_studio: energy, tempo_feel: tempo, mood_tags: mood, notes }
  });
  if (rate.status !== 201) throw new Error(`rate failed: ${rate.status} ${JSON.stringify(rate.body)}`);
  return rate.body.data;
}

async function main() {
  const artist = nacl.sign.keyPair();
  const c1 = nacl.sign.keyPair();
  const c2 = nacl.sign.keyPair();
  const c3 = nacl.sign.keyPair();

  console.log('\n=== 1. Artist submits ===');
  const audio = crypto.randomBytes(1024);
  const create = await request('POST', '/api/v1/submissions', {
    artistWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_SUBMIT', artist.secretKey),
    metadata: { title: 'Smoke Day 4', artistName: 'Smokey', versionType: 'live', genre: 'Blues', mood: 'Raw' },
    audio: { contentType: 'audio/mpeg', base64: audio.toString('base64'), durationSeconds: 240 }
  });
  if (create.status !== 201) {
    console.error('create failed:', create.status, JSON.stringify(create.body, null, 2));
    process.exit(1);
  }
  const submissionId = create.body.data.id;
  console.log('  submission_id:', submissionId);

  console.log('\n=== 2. Verify payment (mock) ===');
  const pay = await request('POST', `/api/v1/submissions/${submissionId}/verify-payment`, { txHash: '0x' + 'a'.repeat(64) });
  if (pay.status !== 200) {
    console.error('verify-payment failed:', pay.status, JSON.stringify(pay.body));
    process.exit(1);
  }
  console.log('  status:', pay.body.data.status);

  console.log('\n=== 3. Curator 1 claims + rates (no publish yet) ===');
  const r1 = await curatorClaimAndRate({ submissionId, curator: c1, solo: 7, vocal: 8, energy: 'higher', tempo: 'rushing', mood: ['Bluesy', 'Raw'] });
  console.log('  rating_count:', r1.rating_count, 'published:', r1.published);

  console.log('\n=== 4. Curator 2 claims + rates (no publish yet) ===');
  const r2 = await curatorClaimAndRate({ submissionId, curator: c2, solo: 9, vocal: 6, energy: 'higher', tempo: 'locked', mood: ['Euphoric'] });
  console.log('  rating_count:', r2.rating_count, 'published:', r2.published);

  console.log('\n=== 5. Curator 3 claims + rates (publish fires) ===');
  const r3 = await curatorClaimAndRate({ submissionId, curator: c3, solo: 5, vocal: 7, energy: 'same', tempo: 'rushing', mood: ['Raw'] });
  console.log('  rating_count:', r3.rating_count);
  console.log('  published:', JSON.stringify(r3.published, null, 2));

  if (!r3.published || r3.published.alreadyPublished) {
    console.error('expected publish to fire on 3rd rating');
    process.exit(1);
  }
  if (r3.published.settlement_legs.length !== 5) {
    console.error(`expected 5 settlement legs, got ${r3.published.settlement_legs.length}`);
    process.exit(1);
  }

  console.log('\n=== 6. GET /api/v1/submissions/:id (post-publish) ===');
  const sub = await request('GET', `/api/v1/submissions/${submissionId}`);
  if (sub.status !== 200) {
    console.error('get failed:', sub.status);
    process.exit(1);
  }
  console.log('  status:', sub.body.data.status);
  console.log('  published_at:', sub.body.data.published_at);
  console.log('  ratings:', sub.body.data.ratings.length);
  console.log('  settlement_legs:', sub.body.data.settlement_legs.length);

  console.log('\n=== 7. Curator profile ===');
  const c1Profile = await request('GET', `/api/v1/curators/${walletOf(c1)}`);
  console.log('  ratings_count:', c1Profile.body.data.ratings_count);
  console.log('  total_earned_usdc:', c1Profile.body.data.total_earned_usdc);
  console.log('  recent titles:', c1Profile.body.data.recent_ratings.map((r) => r.title).join(', '));

  console.log('\n=== 8. Artist profile ===');
  const artistProfile = await request('GET', `/api/v1/artists/${walletOf(artist)}`);
  console.log('  submissions_count:', artistProfile.body.data.submissions_count);
  console.log('  published_count:', artistProfile.body.data.published_count);
  console.log('  total_received_usdc:', artistProfile.body.data.total_received_usdc);

  console.log('\n=== 9. Artist cannot claim own submission (expect 400) ===');
  const selfClaim = await request('POST', `/api/v1/submissions/${submissionId}/claim`, {
    curatorWallet: walletOf(artist),
    signature: sign('VERSIONS_LEPTON_CLAIM', artist.secretKey)
  });
  console.log('  status:', selfClaim.status, 'code:', selfClaim.body.error?.code, 'msg:', selfClaim.body.error?.message);

  console.log('\n=== 10. Rating without claim is rejected (expect 400) ===');
  const c4 = nacl.sign.keyPair();
  const noClaim = await request('POST', `/api/v1/submissions/${submissionId}/rate`, {
    curatorWallet: walletOf(c4),
    signature: sign('VERSIONS_LEPTON_RATE', c4.secretKey),
    rating: { solo_intensity: 5, vocal_quality: 5, energy_vs_studio: 'same', tempo_feel: 'locked', mood_tags: [] }
  });
  console.log('  status:', noClaim.status, 'code:', noClaim.body.error?.code, 'msg:', noClaim.body.error?.message);

  console.log('\n=== Smoke test complete ===');
}

main().catch((err) => { console.error('smoke failed:', err); process.exit(1); });
