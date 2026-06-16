// MODULAR: Toast notifications. Single component, one queue.
'use strict';

let nextId = 1;

export function showToast(message, type = 'info', durationMs = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  const id = nextId++;
  setTimeout(() => {
    if (el.parentNode === container) container.removeChild(el);
  }, durationMs);
  return id;
}
