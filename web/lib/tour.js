// MODULAR: First-visit guided tour. A 3-step overlay that points at
// the Submit, Curate, and Feed tabs. Re-appears if the user clears
// the cookie. One startTour() function; the styles live in
// /styles/tour.css.
//
// DRY: tour state (seen, current step) lives in this module's
// closure. The DOM hooks are element refs, not duplicated logic.

'use strict';

const COOKIE_NAME = 'lepton_tour_seen';
const STEPS = [
  {
    tab: 'artist',
    title: '01 · Submit a version',
    body: 'Pay 0.50 USDC to put a take in the queue. The fee funds the curator pool — split 70/20/10 between the curators, the platform, and your own attribution. After three ratings your version publishes to the feed.'
  },
  {
    tab: 'curator',
    title: '02 · Curate via the taste graph',
    body: 'Claim a submission and rate it across four quantitative dimensions on the radar. The polygon is your rating; the readout below shows the live values. Energy and tempo snap to lower/same/higher and dragging/locked/rushing at submit time.'
  },
  {
    tab: 'feed',
    title: '03 · Discover the feed',
    body: 'The feed is the catalog of published versions. Each row carries the aggregated taste graph (right), the rating dimensions, the mood tags, and a player. Filter by mood, energy, tempo, or solo intensity.'
  }
];

function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 86400 * 1000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}

let currentStep = 0;
let tourEl = null;
let tooltipEl = null;
let activeTabButtons = null;
let activeViews = null;

function renderTour() {
  if (tourEl) tourEl.remove();
  if (tooltipEl) tooltipEl.remove();
  if (currentStep >= STEPS.length) return;

  const step = STEPS[currentStep];

  // MODULAR: dim the entire app, show a centered card with the step.
  tourEl = document.createElement('div');
  tourEl.className = 'tour-overlay';
  tourEl.innerHTML = `
    <div class="tour-card">
      <p class="eyebrow">Step ${currentStep + 1} of ${STEPS.length}</p>
      <h3>${step.title}</h3>
      <p class="muted">${step.body}</p>
      <div class="tour-actions">
        <button class="btn btn-ghost" id="tourSkip">Skip</button>
        <button class="btn btn-primary" id="tourNext">${currentStep === STEPS.length - 1 ? 'Got it' : 'Next'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(tourEl);
  document.getElementById('tourSkip').addEventListener('click', endTour);
  document.getElementById('tourNext').addEventListener('click', nextStep);

  // MODULAR: switch to the relevant tab so the user can see the
  // tab + view it's pointing at. The header is still visible above
  // the dim overlay.
  const targetTab = document.querySelector(`.tab[data-tab="${step.tab}"]`);
  if (targetTab && !targetTab.classList.contains('active')) targetTab.click();
}

function nextStep() {
  currentStep++;
  if (currentStep >= STEPS.length) {
    endTour();
  } else {
    renderTour();
  }
}

function endTour() {
  if (tourEl) tourEl.remove();
  if (tooltipEl) tooltipEl.remove();
  tourEl = null;
  tooltipEl = null;
  setCookie(COOKIE_NAME, '1', 365);
}

export function startTour(force = false) {
  if (!force && getCookie(COOKIE_NAME)) return;
  currentStep = 0;
  renderTour();
}

export function resetTour() {
  setCookie(COOKIE_NAME, '', -1);
  currentStep = 0;
  renderTour();
}

// MODULAR: a small "?" button that reopens the tour on demand.
// Wired in app.js init.
export function mountTourTrigger() {
  const btn = document.createElement('button');
  btn.className = 'tour-trigger';
  btn.textContent = '?';
  btn.title = 'Restart the tour';
  btn.addEventListener('click', () => startTour(true));
  document.body.appendChild(btn);
}
