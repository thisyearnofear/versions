// MODULAR: Audio player. A single <audio> element the app can reuse.

'use strict';

let currentAudio = null;

export function playFile(url, title) {
  stop();
  const audio = new Audio(url);
  audio.preload = 'metadata';
  audio.title = title || '';
  audio.controls = true;
  currentAudio = audio;
  return audio;
}

export function stop() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}
