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

// ---------- payment retry state machine ----------
//
// MODULAR: the submit form is a state machine with these states:
//   idle        → initial; no submission yet
//   submitting  → file read + signature + POST /submissions
//   pending     → submission created; payment not yet verified
//   verifying   → POST /verify-payment in flight
//   verified    → success
//   failed(N)   → verify-payment failed N times; show retry
//   abandoned   → max retries exceeded
//
// CLEAN: explicit states rather than booleans + timers. Each
// transition is one call. The UI re-renders from the state object.
//
// ENHANCEMENT FIRST: the retry reuses the existing submission
// id; only verify-payment is re-issued. The audio is already
// on the server.
const PAYMENT_RETRIES = 3;
let submitState = { phase: 'idle' };

function setSubmitState(state) {
  const card = document.getElementById('submitForm');
  const status = document.getElementById('submitStatus');
  const btn = document.getElementById('submitBtn');
  const submitCopy = document.getElementById('submitCopy');
  const retryArea = document.getElementById('submitRetry');
  if (!card) return;

  if (state.phase === 'idle') {
    btn.textContent = 'Submit for 0.50 USDC';
    btn.disabled = false;
    status.textContent = '';
    if (submitCopy) submitCopy.hidden = false;
    if (retryArea) { retryArea.hidden = true; retryArea.innerHTML = ''; }
    return;
  }
  if (state.phase === 'submitting') {
    btn.textContent = 'Submitting…';
    btn.disabled = true;
    status.textContent = state.message || 'Working…';
    if (submitCopy) submitCopy.hidden = false;
    if (retryArea) retryArea.hidden = true;
    return;
  }
  if (state.phase === 'pending') {
    btn.textContent = 'Verifying payment…';
    btn.disabled = true;
    status.textContent = `Submission ${state.submissionId.slice(0, 8)}… created. Verifying payment…`;
    if (submitCopy) submitCopy.hidden = false;
    if (retryArea) retryArea.hidden = true;
    return;
  }
  if (state.phase === 'verifying') {
    btn.textContent = 'Verifying…';
    btn.disabled = true;
    status.textContent = state.message || 'Awaiting payment confirmation…';
    if (submitCopy) submitCopy.hidden = false;
    if (retryArea) retryArea.hidden = true;
    return;
  }
  if (state.phase === 'verified') {
    btn.textContent = 'Submitted';
    btn.disabled = true;
    status.textContent = 'Submission live in the queue.';
    if (submitCopy) submitCopy.hidden = true;
    if (retryArea) retryArea.hidden = true;
    return;
  }
  if (state.phase === 'failed') {
    btn.textContent = 'Submit for 0.50 USDC';
    btn.disabled = false;
    status.textContent = state.message || 'Submission saved — payment not yet verified.';
    if (submitCopy) submitCopy.hidden = true;
    if (retryArea) {
      retryArea.hidden = false;
      retryArea.innerHTML = `
        <div class="retry-info">
          <strong>Payment verification failed.</strong>
          <span>${state.attempts} of ${PAYMENT_RETRIES} attempts. The submission is saved (id <code>${state.submissionId.slice(0, 8)}…</code>); only the payment needs to settle.</span>
        </div>
        <div class="retry-actions">
          <button class="btn" id="retryPayBtn">Retry payment verification</button>
          <button class="btn btn-ghost" id="abandonBtn">Start a new submission</button>
        </div>
      `;
      document.getElementById('retryPayBtn').addEventListener('click', () => retryVerifyPayment(state));
      document.getElementById('abandonBtn').addEventListener('click', () => {
        submitState = { phase: 'idle' };
        setSubmitState(submitState);
        document.getElementById('submitForm').reset();
        showToast('Submission abandoned. Fill the form to try again.', 'info', 4000);
      });
    }
    return;
  }
  if (state.phase === 'abandoned') {
    btn.textContent = 'Abandoned';
    btn.disabled = true;
    status.textContent = 'Submission abandoned after ' + PAYMENT_RETRIES + ' failed attempts.';
    if (submitCopy) submitCopy.hidden = false;
    if (retryArea) {
      retryArea.hidden = false;
      retryArea.innerHTML = `
        <div class="retry-info"><strong>This submission has been abandoned.</strong><span>The audio is still on the server but it will not publish. Refresh the page to start a new submission.</span></div>
        <button class="btn" id="resetBtn">Start a new submission</button>
      `;
      document.getElementById('resetBtn').addEventListener('click', () => {
        submitState = { phase: 'idle' };
        setSubmitState(submitState);
        document.getElementById('submitForm').reset();
      });
    }
    return;
  }
}

// PERFORMANT: extracted from the original submit handler so the
// retry path can re-use it. Returns a real EVM tx hash if Arc
// is configured + MetaMask is present; otherwise a mock hash.
async function getPaymentTxHash() {
  const arcInfo = await api.get('/api/v1/arc/info');
  if (!arcInfo.mock && arcInfo.usdcContract && hasEvmProvider()) {
    const sent = await sendUsdcTransferViaEvm({
      usdcContract: arcInfo.usdcContract,
      recipient: arcInfo.platformWallet || '0x0000000000000000000000000000000000000000',
      amountUsdc: '0.50'
    });
    return sent.txHash;
  }
  return '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function retryVerifyPayment(state) {
  submitState = { phase: 'verifying', message: 'Re-attempting payment verification…', submissionId: state.submissionId, attempts: state.attempts };
  setSubmitState(submitState);
  try {
    const txHash = await getPaymentTxHash();
    const verify = await api.post(`/api/v1/submissions/${state.submissionId}/verify-payment`, { txHash });
    if (verify.status !== 'awaiting_curation') {
      throw new Error(`Verification returned status=${verify.status}`);
    }
    submitState = { phase: 'verified', submissionId: state.submissionId };
    setSubmitState(submitState);
    showToast('Payment verified — submission is in the curator queue.', 'success', 5000);
    setTimeout(() => refreshArtistDashboard(), 800);
  } catch (err) {
    const attempts = state.attempts + 1;
    if (attempts >= PAYMENT_RETRIES) {
      submitState = { phase: 'abandoned', submissionId: state.submissionId, attempts };
      setSubmitState(submitState);
      showToast(`Payment failed after ${attempts} attempts.`, 'error', 5000);
    } else {
      submitState = { phase: 'failed', submissionId: state.submissionId, attempts, message: `Payment attempt ${attempts} failed: ${err.message}` };
      setSubmitState(submitState);
      showToast(`Payment attempt ${attempts} failed. Try again.`, 'warning', 4000);
    }
  }
}


// ---------- ARTIST: submit ----------

document.getElementById('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentAddress) {
    showToast('Connect your wallet first.', 'warning');
    return;
  }
  // ENHANCEMENT FIRST: the state machine owns the UI. This handler
  // is the only entry point; the retry path re-uses the same
  // getPaymentTxHash() helper.
  submitState = { phase: 'submitting', message: 'Signing submission…' };
  setSubmitState(submitState);

  const form = e.currentTarget;
  const fd = new FormData(form);
  const audioFile = fd.get('audio');
  if (!audioFile || !audioFile.name) {
    showToast('Pick an audio file.', 'warning');
    submitState = { phase: 'idle' };
    setSubmitState(submitState);
    return;
  }

  let signature, submissionId;
  try {
    const { signature: sig } = await signAs(messages.SUBMIT_MESSAGE, currentAddress);
    signature = sig;
    const mbid = (fd.get('musicbrainz_id') || '').trim() || null;
    const metadata = {
      title: fd.get('title'),
      artistName: fd.get('artistName'),
      versionType: fd.get('versionType'),
      genre: fd.get('genre') || null,
      mood: fd.get('mood') || null,
      description: fd.get('description') || null,
      musicbrainzId: mbid
    };
    const fd2 = new FormData();
    fd2.set('signature', signature);
    fd2.set('artistWallet', currentAddress);
    fd2.set('metadata', JSON.stringify(metadata));
    fd2.set('audio', audioFile, audioFile.name || 'audio.wav');
    submitState = { phase: 'submitting', message: 'Uploading audio…' };
    setSubmitState(submitState);
    const r = await fetch(`${baseUrl}/api/v1/submissions`, { method: 'POST', body: fd2 });
    const text = await r.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = { success: false, error: { message: text } }; }
    if (!r.ok) {
      const err = (parsed && parsed.error) || {};
      throw new Error(err.message || `HTTP ${r.status}`);
    }
    const data = parsed.data || parsed;
    submissionId = data.id;

    // CLEAN: same flow as before, but the state machine drives the UI.
    submitState = { phase: 'pending', submissionId };
    setSubmitState(submitState);
    let txHash;
    try {
      txHash = await getPaymentTxHash();
    } catch (payErr) {
      throw new Error(`payment failed: ${payErr.message}`);
    }
    submitState = { phase: 'verifying', submissionId, message: 'Awaiting finality…' };
    setSubmitState(submitState);
    const verify = await api.post(`/api/v1/submissions/${submissionId}/verify-payment`, { txHash });
    if (verify.status !== 'awaiting_curation') {
      throw new Error(`Verification returned status=${verify.status}`);
    }
    submitState = { phase: 'verified', submissionId };
    setSubmitState(submitState);
    showToast('Submission live in the queue.', 'success');
    form.reset();
    setTimeout(() => refreshArtistDashboard(), 800);
  } catch (err) {
    // ENHANCEMENT FIRST: a successful submission that fails to
    // verify-payment is recoverable. The submission is on disk;
    // only the payment step failed. Move to 'failed' state so
    // the user can retry.
    if (submissionId) {
      submitState = { phase: 'failed', submissionId, attempts: 1, message: err.message };
    } else {
      // The submission itself failed; show the error and stay
      // on the form so the user can correct the metadata and
      // re-submit.
      submitState = { phase: 'idle' };
      showToast(`Submit failed: ${err.message}`, 'error', 6000);
    }
    setSubmitState(submitState);
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
//
// Move 2: the play button carries the radar target + the baseline
// values (curator consensus) on data-* attributes so bindAudioWidgets()
// can wire the audio-reactive loop without re-looking them up.
function audioWidget(v) {
  const audioUrl = `${baseUrl}/api/v1/uploads/${v.audio_path.split('/').pop()}`;
  const playId = `play-${v.submission_id}`;
  const waveId = `wave-${v.submission_id}`;
  const graphId = `graph-${v.submission_id}`;
  // 24 bars; deterministic heights so the wave is stable between plays.
  const bars = Array.from({ length: 24 }, (_, i) => 30 + ((i * 7) % 17) + ((i * i) % 23));
  return `
    <div class="audio-player">
      <button class="audio-play" id="${playId}" data-src="${audioUrl}" aria-label="Play ${escapeHtml(v.title)}"
        data-radar-id="${graphId}"
        data-baseline-solo="${v.avg_solo_intensity || 0}"
        data-baseline-vocal="${v.avg_vocal_quality || 0}"
        data-baseline-energy="${escapeHtml(v.energy_consensus || 'same')}"
        data-baseline-tempo="${escapeHtml(v.tempo_consensus || 'locked')}">▶</button>
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
  // animation and starts/stops the underlying audio. The
  // audio-reactive radar loop is wired in playFile() (audio-player.js)
  // via the data-radar-id + data-baseline-* attributes the
  // audioWidget() rendered.
  for (const btn of document.querySelectorAll('.audio-play')) {
    if (btn.dataset.bound) continue;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const url = btn.dataset.src;
      const wave = document.getElementById(btn.id.replace('play-', 'wave-'));
      const radarTarget = btn.dataset.radarId
        ? document.getElementById(btn.dataset.radarId)
        : null;
      const baselineValues = radarTarget ? {
        solo:   Number(btn.dataset.baselineSolo)   || 0,
        vocal:  Number(btn.dataset.baselineVocal)  || 0,
        energy: energyToNumber(btn.dataset.baselineEnergy),
        tempo:  tempoToNumber(btn.dataset.baselineTempo)
      } : null;
      const audio = playFile(url, btn.getAttribute('aria-label') || '',
        radarTarget && baselineValues ? { radarTarget, baselineValues } : undefined);
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
    // MODULAR: Edition No (first 4 hex of the submission id,
    // capitalized) + Pressed date (YYYY-MM-DD from
    // published_at). Both come from the published_versions
    // row; no extra work needed. The Mono small-caps treatment
    // activates the 'record release' frame.
    const edition = (v.submission_id || '').replace(/-/g, '').slice(0, 4).toUpperCase();
    const pressed = (v.published_at || '').slice(0, 10);
    li.innerHTML = `
      <div>
        <div class="feed-edition">Edition No <span>${escapeHtml(edition)}</span> · Pressed <span>${escapeHtml(pressed)}</span></div>
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

// MODULAR: per-wallet earnings card. The same wallet can earn in
// multiple roles (artist + curator + platform) — the breakdown
// surfaces the marketplace's economic story.
async function refreshEarnings() {
  const card = document.getElementById('earningsCard');
  const totalEl = document.getElementById('earningsTotal');
  const byRoleEl = document.getElementById('earningsByRole');
  const recentEl = document.getElementById('earningsRecent');
  if (!currentAddress) {
    card.hidden = true;
    return;
  }
  try {
    const r = await api.get(`/api/v1/artists/${encodeURIComponent(currentAddress)}/earnings?limit=20`);
    if (!r.recent || r.recent.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    totalEl.textContent = `${r.total.toFixed(4)} USDC earned`;
    // MODULAR: by-role breakdown. Each role has a label + a tiny
    // mono total + a per-leg hint. The bars are pure CSS.
    byRoleEl.innerHTML = (r.by_role || []).map((row) => {
      const pct = r.total > 0 ? Math.round((row.total / r.total) * 100) : 0;
      return `
        <div class="earnings-row">
          <div class="earnings-row-label">
            <span class="earnings-role">${escapeHtml(row.role)}</span>
            <span class="earnings-count">${row.leg_count} leg${row.leg_count === 1 ? '' : 's'}</span>
          </div>
          <div class="earnings-bar"><span style="width: ${pct}%"></span></div>
          <div class="earnings-amount">${row.total.toFixed(4)} USDC</div>
        </div>
      `;
    }).join('');
    // MODULAR: the recent-legs list. Each row shows the role +
    // amount + the submission title it came from. The artist
    // can see "I earned 0.05 USDC from <My Song Title> as musicbrainz".
    recentEl.innerHTML = '';
    for (const leg of r.recent) {
      const li = document.createElement('li');
      li.className = 'version-item';
      li.innerHTML = `
        <div>
          <h4>${escapeHtml(leg.submission_title || leg.submission_id.slice(0, 8))}</h4>
          <div class="feed-meta">${escapeHtml(leg.artist_name || '')} · <span class="version-badge version-badge--${leg.role}">${leg.role}</span></div>
          <div class="version-status">
            <span class="version-progress">${parseFloat(leg.amount).toFixed(4)} USDC · settled ${leg.settled_at ? leg.settled_at.slice(0, 16).replace('T', ' ') : 'recently'}</span>
          </div>
        </div>
      `;
      recentEl.appendChild(li);
    }
  } catch (err) {
    card.hidden = true;
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
  await refreshEarnings();
  // MODULAR: the first-visit tour starts on boot if the cookie is
  // absent; the ? trigger in the bottom-left restarts it on demand.
  startTour(false);
  mountTourTrigger();
})();
