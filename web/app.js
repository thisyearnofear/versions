// MODULAR: Single entry point. Wires tabs, view logic, and the API to the
// DOM. Each view (submit / curate / feed) is a small block in this file
// because the views are simple enough that the SPA shell doesn't need
// lazy loading or templating yet.

'use strict';

import { api, baseUrl } from './lib/api.js';
import { connect, wallet, signAs, messages } from './lib/wallet.js';
import { showToast } from './lib/toast.js';
import { playFile } from './lib/audio-player.js';

// ---------- wallet state ----------

let currentAddress = null;

async function refreshWalletButton() {
  const btn = document.getElementById('walletBtn');
  const addr = document.getElementById('walletAddress');
  if (currentAddress) {
    btn.textContent = 'Disconnect';
    addr.textContent = `${currentAddress.slice(0, 4)}…${currentAddress.slice(-4)}`;
  } else {
    btn.textContent = 'Connect wallet';
    addr.textContent = '';
  }
}

document.getElementById('walletBtn').addEventListener('click', async () => {
  if (currentAddress) {
    currentAddress = null;
    await refreshWalletButton();
    return;
  }
  try {
    const { address } = await connect();
    currentAddress = address;
    await refreshWalletButton();
    showToast(`Connected ${address.slice(0, 4)}…${address.slice(-4)}`, 'success');
  } catch (err) {
    showToast(err.message, 'error', 6000);
  }
});

// ---------- tabs ----------

const tabButtons = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.view');

function showTab(name) {
  for (const btn of tabButtons) btn.classList.toggle('active', btn.dataset.tab === name);
  for (const v of views) v.classList.toggle('hidden', v.dataset.view !== name);
  if (name === 'curator') refreshQueue();
  if (name === 'feed') refreshFeed();
}

for (const btn of tabButtons) {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
}

// ---------- ARTIST: submit ----------

document.getElementById('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('submitStatus');
  const btn = document.getElementById('submitBtn');
  if (!currentAddress) {
    showToast('Connect your wallet first.', 'warning');
    return;
  }
  const form = e.currentTarget;
  const fd = new FormData(form);
  const audioFile = fd.get('audio');
  if (!audioFile || !audioFile.name) {
    showToast('Pick an audio file.', 'warning');
    return;
  }
  btn.disabled = true;
  status.textContent = 'Reading file…';
  const buf = await audioFile.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  status.textContent = 'Signing submission…';
  const { signature } = await signAs(messages.SUBMIT_MESSAGE, currentAddress);
  status.textContent = 'Uploading…';
  try {
    const r = await api.post('/api/v1/submissions', {
      artistWallet: currentAddress,
      signature,
      metadata: {
        title: fd.get('title'),
        artistName: fd.get('artistName'),
        versionType: fd.get('versionType'),
        genre: fd.get('genre') || null,
        mood: fd.get('mood') || null,
        description: fd.get('description') || null
      },
      audio: { contentType: audioFile.type || 'audio/mpeg', base64, durationSeconds: null }
    });
    status.textContent = `Submission created (id ${r.id.slice(0, 8)}…). Verifying payment…`;
    // Hackathon: the web client also acts as the Arc payer for the demo.
    // In production the artist pays via Phantom's sendTransaction; here we
    // call the verify endpoint with a mock tx hash to flip the status to
    // awaiting_curation (the real Arc flow lands when the testnet is live).
    const fakeTx = '0x' + Array.from(await crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    await api.post(`/api/v1/submissions/${r.id}/verify-payment`, { txHash: fakeTx });
    status.textContent = `Submitted — id ${r.id.slice(0, 8)}…`;
    showToast('Submission live in the queue.', 'success');
    form.reset();
  } catch (err) {
    showToast(`Submit failed: ${err.message}`, 'error', 6000);
    status.textContent = '';
  } finally {
    btn.disabled = false;
  }
});

// ---------- CURATOR: queue + rate ----------

let currentQueue = [];
let selectedSubmission = null;

async function refreshQueue() {
  if (!currentAddress) {
    document.getElementById('queueList').innerHTML = '<li class="muted">Connect your wallet to curate.</li>';
    return;
  }
  try {
    const r = await api.get('/api/v1/submissions/queue?limit=50');
    currentQueue = r || [];
    renderQueue();
  } catch (err) {
    showToast(`Queue load failed: ${err.message}`, 'error');
  }
}

document.getElementById('refreshQueueBtn').addEventListener('click', refreshQueue);

function renderQueue() {
  const ul = document.getElementById('queueList');
  if (currentQueue.length === 0) {
    ul.innerHTML = '<li class="muted">Queue is empty.</li>';
    return;
  }
  ul.innerHTML = '';
  for (const sub of currentQueue) {
    const li = document.createElement('li');
    li.className = 'queue-item' + (selectedSubmission && selectedSubmission.id === sub.id ? ' selected' : '');
    li.innerHTML = `
      <b>${escapeHtml(sub.title)}</b>
      <div class="feed-meta">${escapeHtml(sub.artist_name)} · ${escapeHtml(sub.version_type)} · ${escapeHtml(sub.genre || '')}</div>
    `;
    li.addEventListener('click', () => selectSubmission(sub));
    ul.appendChild(li);
  }
}

function selectSubmission(sub) {
  selectedSubmission = sub;
  renderQueue();
  document.getElementById('rateHint').classList.add('hidden');
  const form = document.getElementById('rateForm');
  form.classList.remove('hidden');
  document.getElementById('rateTitle').textContent = sub.title;
  document.getElementById('rateMeta').textContent = `${sub.artist_name} · ${sub.version_type} · ${sub.genre || ''}`;
}

document.getElementById('releaseClaimBtn').addEventListener('click', async () => {
  if (!selectedSubmission) return;
  try {
    await api.post(`/api/v1/submissions/${selectedSubmission.id}/claim`, { curatorWallet: currentAddress, _method: 'DELETE' });
  } catch (_) { /* best-effort */ }
  // Use the actual DELETE route via fetch.
  try {
    await fetch(`${baseUrl}/api/v1/submissions/${selectedSubmission.id}/claim`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ curatorWallet: currentAddress })
    });
  } catch (_) { /* best-effort */ }
  showToast('Claim released.', 'info');
  selectedSubmission = null;
  document.getElementById('rateForm').classList.add('hidden');
  document.getElementById('rateHint').classList.remove('hidden');
  await refreshQueue();
});

document.getElementById('rateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedSubmission) return;
  const form = e.currentTarget;
  const fd = new FormData(form);
  const mood = (fd.get('mood_tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rating = {
    solo_intensity: Number(fd.get('solo_intensity')),
    vocal_quality: Number(fd.get('vocal_quality')),
    energy_vs_studio: fd.get('energy_vs_studio'),
    tempo_feel: fd.get('tempo_feel'),
    mood_tags: mood,
    notes: fd.get('notes') || null
  };
  try {
    // Claim first (idempotent for the active curator).
    const { signature: claimSig } = await signAs(messages.CLAIM_MESSAGE, currentAddress);
    const claim = await api.post(`/api/v1/submissions/${selectedSubmission.id}/claim`, {
      curatorWallet: currentAddress, signature: claimSig
    });
    if (!claim.ok && claim.error && !/active claim/i.test(claim.error)) {
      throw new Error(claim.error);
    }
    // Sign + rate.
    const { signature: rateSig } = await signAs(messages.RATE_MESSAGE, currentAddress);
    const r = await api.post(`/api/v1/submissions/${selectedSubmission.id}/rate`, {
      curatorWallet: currentAddress, signature: rateSig, rating
    });
    if (r.published && !r.published.alreadyPublished) {
      showToast('🎉 Version published! Fee pool settled.', 'success', 6000);
    } else {
      showToast(`Rating recorded (${r.rating_count}/3 needed for publish).`, 'info');
    }
    form.reset();
    selectedSubmission = null;
    document.getElementById('rateForm').classList.add('hidden');
    document.getElementById('rateHint').classList.remove('hidden');
    await refreshQueue();
  } catch (err) {
    showToast(`Rate failed: ${err.message}`, 'error', 6000);
  }
});

// ---------- FEED ----------

async function refreshFeed() {
  try {
    const r = await api.get('/api/v1/feed?limit=50');
    renderFeed(r.rows || []);
  } catch (err) {
    showToast(`Feed load failed: ${err.message}`, 'error');
  }
}

document.getElementById('feedFilter').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const params = new URLSearchParams();
  for (const [k, v] of fd.entries()) {
    if (v) params.set(k, v);
  }
  try {
    const r = await api.get(`/api/v1/feed?${params.toString()}`);
    renderFeed(r.rows || []);
  } catch (err) {
    showToast(`Filter failed: ${err.message}`, 'error');
  }
});

function renderFeed(rows) {
  const ul = document.getElementById('feedList');
  if (rows.length === 0) {
    ul.innerHTML = '<li class="muted">No published versions yet.</li>';
    return;
  }
  ul.innerHTML = '';
  for (const v of rows) {
    const li = document.createElement('li');
    li.className = 'feed-item';
    const tags = JSON.parse(v.aggregated_mood_tags || '[]');
    const audioUrl = `${baseUrl}/api/v1/uploads/${v.audio_path.split('/').pop()}`;
    li.innerHTML = `
      <h4>${escapeHtml(v.title)}</h4>
      <div class="feed-meta">${escapeHtml(v.artist_name)} · ${escapeHtml(v.version_type)}</div>
      <div class="feed-meta">solo ${v.avg_solo_intensity?.toFixed?.(1) || '-'} · vocal ${v.avg_vocal_quality?.toFixed?.(1) || '-'} · energy ${escapeHtml(v.energy_consensus || '-')} · tempo ${escapeHtml(v.tempo_consensus || '-')} · ${v.rating_count} ratings</div>
      <div class="feed-tags">${tags.map((t) => `<span class="feed-tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="audio-player"><audio controls preload="none" src="${audioUrl}"></audio></div>
    `;
    ul.appendChild(li);
  }
}

// ---------- helpers ----------

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------- init ----------

(async function init() {
  currentAddress = wallet();
  await refreshWalletButton();
  if (currentAddress) {
    showToast(`Welcome back, ${currentAddress.slice(0, 4)}…${currentAddress.slice(-4)}`, 'info', 2500);
  }
  await refreshQueue();
  await refreshFeed();
})();
