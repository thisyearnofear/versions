// MODULAR: Web Audio API tone synthesis for musical UI feedback.
// No audio files, no library — just oscillators + gain envelopes.
// Every function is safe to call even if AudioContext isn't available
// (returns silently). Designed for the "musical interaction" concept
// from Codrops' MusicalInteractions: every UI event has a sound.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface ToneOptions {
  freq: number;
  duration?: number;
  type?: OscillatorType;
  volume?: number;
  delay?: number;
}

function playTone({ freq, duration = 0.3, type = "sine", volume = 0.05, delay = 0 }: ToneOptions): void {
  const audio = getCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime + delay;

  osc.type = type;
  osc.frequency.value = freq;

  // Attack-decay envelope: quick rise, smooth fall.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

// Note frequencies (C major scale + extensions).
const NOTES = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25,
  E5: 659.25, G5: 783.99,
} as const;

/** Play a note by Y position (0 = top = high, 1 = bottom = low). */
export function playNoteAt(y: number): void {
  const notes = [NOTES.C5, NOTES.B4, NOTES.A4, NOTES.G4, NOTES.F4, NOTES.E4, NOTES.D4, NOTES.C4];
  const idx = Math.min(notes.length - 1, Math.max(0, Math.floor(y * notes.length)));
  playTone({ freq: notes[idx], duration: 0.4, type: "triangle", volume: 0.08 });
}

/** Soft chime for agent review events. */
export function playReviewChime(): void {
  playTone({ freq: NOTES.E4, duration: 0.25, type: "sine", volume: 0.04 });
  playTone({ freq: NOTES.G4, duration: 0.25, type: "sine", volume: 0.04, delay: 0.08 });
}

/** Bright ping for tip verification. */
export function playTipChime(): void {
  playTone({ freq: NOTES.C5, duration: 0.2, type: "sine", volume: 0.05 });
}

/** Full major triad for batch settlement. */
export function playSettlementChime(): void {
  playTone({ freq: NOTES.C4, duration: 0.3, type: "sine", volume: 0.04 });
  playTone({ freq: NOTES.E4, duration: 0.3, type: "sine", volume: 0.04, delay: 0.06 });
  playTone({ freq: NOTES.G4, duration: 0.4, type: "sine", volume: 0.04, delay: 0.12 });
}

/** Bright ascending fanfare for a publish — C-E-G arpeggio over a
 *  soft root. Slightly louder + longer than the chimes so it reads
 *  as a win moment, not background noise. */
export function playPublishFanfare(): void {
  playTone({ freq: NOTES.C4, duration: 0.55, type: "sine", volume: 0.05 });
  playTone({ freq: NOTES.E4, duration: 0.45, type: "triangle", volume: 0.045, delay: 0.07 });
  playTone({ freq: NOTES.G4, duration: 0.4, type: "triangle", volume: 0.045, delay: 0.14 });
  playTone({ freq: NOTES.C5, duration: 0.7, type: "triangle", volume: 0.05, delay: 0.21 });
}

/** Soft sine ping for play events. */
export function playPlayChime(): void {
  playTone({ freq: NOTES.G5, duration: 0.15, type: "sine", volume: 0.03 });
}

/** Map economy event kind to the corresponding chime. */
export function playEconomySound(kind: string): void {
  switch (kind) {
    case "review": playReviewChime(); break;
    case "tip": playTipChime(); break;
    case "tip_batch_settled": playSettlementChime(); break;
    case "leg_settled": playSettlementChime(); break;
    case "play": playPlayChime(); break;
  }
}

/** Resume the audio context (call on first user interaction). */
export function resumeAudio(): void {
  getCtx();
}

// MODULAR: shared sound preference. The ticker's ♪ toggle and the
// live-demo button both control chimes, so the on/off state lives
// here (module singleton) instead of in any one component.
let soundEnabled = false;
const soundListeners = new Set<() => void>();

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function setSoundEnabled(on: boolean): void {
  if (on) resumeAudio();
  if (soundEnabled === on) return;
  soundEnabled = on;
  soundListeners.forEach((fn) => fn());
}

/** Subscribe to sound-preference changes (useSyncExternalStore shape). */
export function subscribeSound(fn: () => void): () => void {
  soundListeners.add(fn);
  return () => soundListeners.delete(fn);
}
