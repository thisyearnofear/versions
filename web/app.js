// MODULAR: Single entry point. Wires tabs, view logic, and the API to the
// DOM. Each view (submit / curate / feed) is a small block in this file
// because the views are simple enough that the SPA shell doesn't need
// lazy loading or templating yet.

'use strict';

import { api, baseUrl } from './lib/api.js';
import {
  connect, wallet, signAs, sendUsdcTransferViaEvm, hasEvmProvider, messages
} from './lib/wallet.js';
import { showToast } from './lib/toast.js';
import { playFile } from './lib/audio-player.js';
import { startTour, mountTourTrigger } from './lib/tour.js';
import { mountDropzone } from './lib/dropzone.js';
// ---------- wallet state ----------

let currentAddress = null;

async function refreshWalletButton() {
  const btn = document.getElementById('walletBtn');
  const addr = document.getElementById('walletAddress');
  if (currentAddress) {
    btn.textContent = 'Disconnect';
    // ENHANCEMENT FIRST: the persistent wallet chip lives in the
    // header (was a tiny 12px mono address in the corner). The full
    // address is in the title attribute for copy-on-hover.
    const short = `${currentAddress.slice(0, 6)}…${currentAddress.slice(-4)}`;
    addr.textContent = short;
    addr.title = `${currentAddress} (click to copy)`;
    addr.classList.add('wallet-address--connected');
  } else {
    btn.textContent = 'Connect wallet';
    addr.textContent = '';
    addr.classList.remove('wallet-address--connected');
  }
}

document.getElementById('walletAddress').addEventListener('click', () => {
  if (currentAddress) {
    navigator.clipboard.writeText(currentAddress).then(
      () => showToast('Address copied', 'success', 1500),
      () => showToast('Copy failed', 'error', 2000)
    );
  }
});

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
  let submissionId;
  try {
    // MODULAR: the optional MBID is read from the form (Phase 5). The
    // server validates it; the leg routing doesn't change.
    const mbid = (fd.get('musicbrainz_id') || '').trim() || null;
    const r = await api.post('/api/v1/submissions', {
      artistWallet: currentAddress,
      signature,
      metadata: {
        title: fd.get('title'),
        artistName: fd.get('artistName'),
        versionType: fd.get('versionType'),
        genre: fd.get('genre') || null,
        mood: fd.get('mood') || null,
        description: fd.get('description') || null,
        musicbrainzId: mbid
      },
      audio: { contentType: audioFile.type || 'audio/mpeg', base64, durationSeconds: null }
    });
    submissionId = r.id;
    status.textContent = `Submission ${submissionId.slice(0, 8)}… created. Verifying payment…`;

    // CLEAN: real USDC flow when the proxy is configured for real Arc
    // AND the browser exposes an EVM provider. Otherwise fall back to
    // a deterministic mock so the demo never gets stuck on a missing
    // wallet or unreachable RPC.
    const arcInfo = await api.get('/api/v1/arc/info');
    let txHash;
    if (!arcInfo.mock && arcInfo.usdcContract && hasEvmProvider()) {
      status.textContent = 'Confirm USDC transfer in your wallet…';
      try {
        const sent = await sendUsdcTransferViaEvm({
          usdcContract: arcInfo.usdcContract,
          recipient: r.payment_address,
          amountUsdc: r.fee_quote_usdc
        });
        txHash = sent.txHash;
        status.textContent = `Payment broadcast: ${txHash.slice(0, 10)}… waiting for finality…`;
        // PERFORMANT: poll verify-payment a few times. Real Arc finality
        // is sub-second; we retry briefly while the tx propagates.
        for (let i = 0; i < 5; i++) {
          try {
            const verify = await api.post(`/api/v1/submissions/${submissionId}/verify-payment`, { txHash });
            if (verify.status === 'awaiting_curation') break;
          } catch (_) { /* keep retrying */ }
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (err) {
        // ENHANCEMENT FIRST: real EVM path failed (user rejected, wrong
        // network, etc.) — fall through to mock so the demo still flows.
        showToast(`EVM payment failed (${err.message}); using demo mock.`, 'warning', 5000);
      }
    }
    if (!txHash) {
      // PERFORMANT: mock tx hash lets the demo run end-to-end with no keys.
      txHash = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    const verify = await api.post(`/api/v1/submissions/${submissionId}/verify-payment`, { txHash });
    if (verify.status !== 'awaiting_curation') {
      throw new Error(`Payment verification failed (status=${verify.status})`);
    }
    status.textContent = `Submitted — id ${submissionId.slice(0, 8)}…`;
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
  // MODULAR: the queue is readable without a wallet — it's just a
  // public list. The wallet check happens on claim/rate, not on read.
  // ENHANCEMENT FIRST: showing the queue to anyone makes the demo land
  // (curators see what's in the inbox before connecting).
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
    ul.innerHTML = '<li class="empty-state"><strong>The queue is empty.</strong>No submissions awaiting curation right now.<div class="hint">Try seeding the catalog with <code>npm run seed</code></div></li>';
    return;
  }
  ul.innerHTML = '';
  for (const sub of currentQueue) {
    const li = document.createElement('li');
    li.className = 'queue-item' + (selectedSubmission && selectedSubmission.id === sub.id ? ' selected' : '');
    li.dataset.id = sub.id;
    li.innerHTML = `
      <div style="font-family: var(--serif); font-size: 17px; font-weight: 500;">${escapeHtml(sub.title)}</div>
      <div class="feed-meta">${escapeHtml(sub.artist_name)} · ${escapeHtml(sub.version_type)}</div>
    `;
    li.addEventListener('click', () => selectSubmission(sub));
    ul.appendChild(li);
  }
}

// MODULAR: snap the continuous radar values to the discrete energy /
// tempo strings the server validates. The bands are centred on 2/5/8
// with a ±1.7 half-width so the snap matches what the user sees
// on the radar (the L/S/H + D/L/R dots).
const ENERGY_SNAP = [
  { max: 3.4, value: 'lower'  },
  { max: 6.7, value: 'same'   },
  { max: 11,  value: 'higher' }
];
const TEMPO_SNAP = [
  { max: 3.4, value: 'dragging' },
  { max: 6.7, value: 'locked'   },
  { max: 11,  value: 'rushing'  }
];
const ENERGY_VALUE_TO_LABEL = { lower: 'LOWER', same: 'SAME', higher: 'HIGHER' };
const TEMPO_VALUE_TO_LABEL  = { dragging: 'DRAGGING', locked: 'LOCKED', rushing: 'RUSHING' };

function snapEnergy(v) { return ENERGY_SNAP.find((s) => v < s.max).value; }
function snapTempo(v)  { return TEMPO_SNAP.find((s)  => v < s.max).value; }

// MODULAR: one radar instance, mounted on submission select, queried
// on rating submit. The radar is the source of truth for the four
// quantitative dimensions; the form inputs only carry the free-text
// bits (mood tags, notes).
let rateRadar = null;

function setReadout(values) {
  const v = values || (rateRadar && rateRadar.getValues()) || { solo: 5, vocal: 5, energy: 5, tempo: 5 };
  for (const el of document.querySelectorAll('[data-out]')) {
    const key = el.getAttribute('data-out');
    if (key === 'solo' || key === 'vocal') el.textContent = Math.round(v[key]).toString();
    else if (key === 'energy') el.textContent = ENERGY_VALUE_TO_LABEL[snapEnergy(v.energy)];
    else if (key === 'tempo')  el.textContent = TEMPO_VALUE_TO_LABEL[snapTempo(v.tempo)];
  }
}

function mountRateRadar(initial) {
  // MODULAR: tear down any prior radar before mounting a new one.
  // The radar is owned by the closure; this single instance lives for
  // the duration of the rating session.
  const target = document.getElementById('interactiveRadar');
  if (!target || !window.renderInteractiveRadar) return null;
  target.innerHTML = '';
  rateRadar = window.renderInteractiveRadar(target, initial || { solo: 5, vocal: 5, energy: 5, tempo: 5 }, setReadout);
  setReadout();
  return rateRadar;
}

function selectSubmission(sub) {
  selectedSubmission = sub;
  renderQueue();
  document.getElementById('rateHint').classList.add('hidden');
  const form = document.getElementById('rateForm');
  form.classList.remove('hidden');
  document.getElementById('rateTitle').textContent = sub.title;
  document.getElementById('rateMeta').textContent = `${sub.artist_name} · ${sub.version_type} · ${sub.genre || ''}`;
  // CLEAN: clear the form's free-text inputs (mood + notes) between
  // submissions; the radar resets to 5/5/5/5.
  form.querySelector('input[name="mood_tags"]').value = '';
  form.querySelector('textarea[name="notes"]').value = '';
  mountRateRadar({ solo: 5, vocal: 5, energy: 5, tempo: 5 });
}

document.getElementById('rateReset').addEventListener('click', () => {
  mountRateRadar({ solo: 5, vocal: 5, energy: 5, tempo: 5 });
  showToast('Radar reset.', 'info', 1500);
});

document.getElementById('releaseClaimBtn').addEventListener('click', async () => {
  if (!selectedSubmission) return;
  try {
    await fetch(`${baseUrl}/api/v1/submissions/${selectedSubmission.id}/claim`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ curatorWallet: currentAddress })
    });
  } catch (_) { /* best-effort */ }
  showToast('Claim released.', 'info');
  selectedSubmission = null;
  rateRadar = null;
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
  // CLEAN: the radar owns the 4 quantitative dimensions. mood_tags +
  // notes come from the form. Energy/tempo snap from continuous to
  // discrete at submit time.
  const r = rateRadar ? rateRadar.getValues() : { solo: 5, vocal: 5, energy: 5, tempo: 5 };
  const rating = {
    solo_intensity: Math.round(r.solo),
    vocal_quality:  Math.round(r.vocal),
    energy_vs_studio: snapEnergy(r.energy),
    tempo_feel:     snapTempo(r.tempo),
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
    const resp = await api.post(`/api/v1/submissions/${selectedSubmission.id}/rate`, {
      curatorWallet: currentAddress, signature: rateSig, rating
    });
    if (resp.published && !resp.published.alreadyPublished) {
      showToast('🎉 Version published! Fee pool settled.', 'success', 6000);
    } else {
      showToast(`Rating recorded (${resp.rating_count}/3 needed for publish).`, 'info');
    }
    form.reset();
    selectedSubmission = null;
    rateRadar = null;
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

// MODULAR: Custom audio widget. Uses the .audio-player + .audio-play +
// .audio-wave + .audio-meta styles in main.css so the player is on-brand
// rather than the browser's default <audio controls>. The wave is a
// decorative element that animates while audio is playing.
function audioWidget(v) {
  const audioUrl = `${baseUrl}/api/v1/uploads/${v.audio_path.split('/').pop()}`;
  const playId = `play-${v.submission_id}`;
  const waveId = `wave-${v.submission_id}`;
  // 24 bars; deterministic heights so the wave is stable between plays.
  const bars = Array.from({ length: 24 }, (_, i) => 30 + ((i * 7) % 17) + ((i * i) % 23));
  return `
    <div class="audio-player">
      <button class="audio-play" id="${playId}" data-src="${audioUrl}" aria-label="Play ${escapeHtml(v.title)}">▶</button>
      <div class="audio-meta">
        <div class="title">${escapeHtml(v.title)}</div>
        <div class="by">${escapeHtml(v.artist_name)}</div>
      </div>
      <div class="audio-wave" id="${waveId}">${bars.map((h) => `<div class="bar" style="height:${h}%"></div>`).join('')}</div>
    </div>
  `;
}

function bindAudioWidgets() {
  // MODULAR: one delegated handler. Each play button toggles a wave
  // animation and starts/stops the underlying audio.
  for (const btn of document.querySelectorAll('.audio-play')) {
    if (btn.dataset.bound) continue;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const url = btn.dataset.src;
      const wave = document.getElementById(btn.id.replace('play-', 'wave-'));
      const audio = playFile(url, btn.getAttribute('aria-label') || '');
      audio.addEventListener('play', () => { wave.classList.add('playing'); btn.textContent = '❚❚'; });
      audio.addEventListener('pause', () => { wave.classList.remove('playing'); btn.textContent = '▶'; });
      audio.addEventListener('ended', () => { wave.classList.remove('playing'); btn.textContent = '▶'; });
    });
  }
}

function renderFeed(rows) {
  const ul = document.getElementById('feedList');
  if (rows.length === 0) {
    ul.innerHTML = '<li class="empty-state"><strong>The feed is empty.</strong>Once 3 curators rate a submission it lands here.<div class="hint">Seed the catalog with <code>npm run seed</code></div></li>';
    return;
  }
  ul.innerHTML = '';
  for (const v of rows) {
    const li = document.createElement('li');
    li.className = 'feed-item';
    const tags = JSON.parse(v.aggregated_mood_tags || '[]');
    li.innerHTML = `
      <div>
        <h4>${escapeHtml(v.title)}</h4>
        <div class="feed-meta">${escapeHtml(v.artist_name)} · ${escapeHtml(v.version_type)}</div>
        <div class="feed-meta" style="margin-top:6px;">solo ${(v.avg_solo_intensity || 0).toFixed(1)} · vocal ${(v.avg_vocal_quality || 0).toFixed(1)} · ${escapeHtml(v.energy_consensus || '-')} · ${escapeHtml(v.tempo_consensus || '-')} · ${v.rating_count} ratings</div>
        <div class="feed-tags">${tags.map((t) => `<span class="feed-tag">${escapeHtml(t)}</span>`).join('')}</div>
      </div>
      <div class="feed-graph" id="graph-${v.submission_id}" aria-label="Taste graph"></div>
      <div class="feed-audio">${audioWidget(v)}</div>
    `;
    ul.appendChild(li);
    // MODULAR: render the taste-graph radar inside the placeholder.
    const graphEl = li.querySelector(`#graph-${v.submission_id}`);
    if (graphEl && window.renderTasteGraph) {
      window.renderTasteGraph(graphEl, {
        solo: v.avg_solo_intensity || 0,
        vocal: v.avg_vocal_quality || 0,
        energy: energyToNumber(v.energy_consensus),
        tempo: tempoToNumber(v.tempo_consensus)
      });
    }
  }
  bindAudioWidgets();
}

function energyToNumber(s) {
  return s === 'higher' ? 8 : s === 'lower' ? 2 : 5;
}
function tempoToNumber(s) {
  return s === 'rushing' ? 8 : s === 'dragging' ? 2 : 5;
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

// ---------- ARTIST: dashboard (Phase 5) ----------

// MODULAR: per-artist dashboard. Calls /api/v1/artists/:wallet/versions
// and renders a 2-column table (title + status badge + rating count
// when in curation, or aggregated taste graph when published).
async function refreshArtistDashboard() {
  const dash = document.getElementById('artistDashboard');
  const list = document.getElementById('versionList');
  const count = document.getElementById('dashboardCount');
  if (!currentAddress) {
    dash.hidden = true;
    return;
  }
  try {
    const r = await api.get(`/api/v1/artists/${encodeURIComponent(currentAddress)}/versions?limit=20`);
    if (!r.rows || r.rows.length === 0) {
      dash.hidden = true;
      return;
    }
    dash.hidden = false;
    count.textContent = `${r.total} total`;
    list.innerHTML = '';
    for (const v of r.rows) {
      const li = document.createElement('li');
      li.className = 'version-item';
      li.innerHTML = `
        <div>
          <h4>${escapeHtml(v.title)}</h4>
          <div class="feed-meta">${escapeHtml(v.artist_name)} · ${escapeHtml(v.version_type)} · ${escapeHtml(v.genre || '')}</div>
          <div class="version-status">
            <span class="version-badge version-badge--${v.status}">${v.status.replace('_', ' ')}</span>
            ${v.status === 'in_curation' ? `<span class="version-progress">${v.rating_count} / 3 curators</span>` : ''}
            ${v.status === 'awaiting_curation' ? `<span class="version-progress">${v.rating_count} / 3 curators</span>` : ''}
            ${v.published ? `<span class="version-progress">solo ${v.published.avg_solo_intensity.toFixed(1)} · vocal ${v.published.avg_vocal_quality.toFixed(1)} · ${escapeHtml(v.published.energy_consensus)} · ${escapeHtml(v.published.tempo_consensus)}</span>` : ''}
          </div>
        </div>
      `;
      list.appendChild(li);
    }
  } catch (err) {
    // ENHANCEMENT FIRST: dashboard is best-effort. If the API is
    // down, just hide the card — the form still works.
    dash.hidden = true;
  }
}

// ---------- init ----------

// MODULAR: mount the audio dropzone. The hidden <input> stays
// keyboard-accessible; the dropzone owns the visual + drag/drop.
const audioInput = document.getElementById('audioInput');
const audioDropzone = document.getElementById('audioDropzone');
if (audioInput && audioDropzone) mountDropzone(audioInput, audioDropzone);

(async function init() {
  currentAddress = wallet();
  await refreshWalletButton();
  if (currentAddress) {
    showToast(`Welcome back, ${currentAddress.slice(0, 4)}…${currentAddress.slice(-4)}`, 'info', 2500);
  }
  await refreshQueue();
  await refreshFeed();
  await refreshArtistDashboard();
  // MODULAR: the first-visit tour starts on boot if the cookie is
  // absent; the ? trigger in the bottom-left restarts it on demand.
  startTour(false);
  mountTourTrigger();
})();
