// MODULAR: Custom audio dropzone. Wraps a hidden <input type="file">
// in a styled, drag-friendly zone. The native input is still
// keyboard-accessible; clicking the zone opens the picker.
//
// ENHANCEMENT FIRST: the native input is the source of truth; the
// dropzone is pure CSS + event wiring. If the user clicks "remove",
// the underlying input's value is cleared + the change event fires,
// so any code reading `fd.get('audio')` from a FormData sees the
// right thing.

'use strict';

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(seconds) {
  // MODULAR: round to seconds + format as M:SS. The audio.duration
  // is in seconds (decimal) on HTMLAudioElement. If the browser
  // doesn't know the duration yet, return null.
  if (!Number.isFinite(seconds)) return null;
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function mountDropzone(input, dropzone) {
  // MODULAR: a hidden <input type="file"> plus a <label> / <div>
  // dropzone. The native input is what the form submits; the
  // dropzone is purely visual + interaction.
  const fileName = dropzone.querySelector('.dropzone-filename');
  const fileSize = dropzone.querySelector('.dropzone-size');
  const fileDuration = dropzone.querySelector('.dropzone-duration');
  const placeholder = dropzone.querySelector('.dropzone-placeholder');
  const fileInfo = dropzone.querySelector('.dropzone-info');
  const removeBtn = dropzone.querySelector('.dropzone-remove');

  // MODULAR: read the file + populate the meta block. Uses an
  // HTMLAudioElement to extract the duration (the only browser
  // API that exposes decoded audio metadata). No upload happens
  // here — the form's submit handler reads input.files[0].
  function showFile(file) {
    if (!file) return;
    fileName.textContent = file.name;
    fileSize.textContent = fmtSize(file.size);
    fileDuration.textContent = '…';
    placeholder.hidden = true;
    fileInfo.hidden = false;
    // MODULAR: try to read the duration. If the browser doesn't
    // support the format (rare), the duration just stays '?'.
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = URL.createObjectURL(file);
    probe.addEventListener('loadedmetadata', () => {
      const d = fmtDuration(probe.duration);
      fileDuration.textContent = d ? `${d}` : '?';
      URL.revokeObjectURL(probe.src);
    });
    probe.addEventListener('error', () => {
      fileDuration.textContent = '?';
    });
  }

  function clearFile() {
    input.value = '';
    placeholder.hidden = false;
    fileInfo.hidden = true;
    // CLEAN: a fresh change event so any code listening on
    // 'change' sees the clear.
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('change', () => showFile(input.files[0]));
  if (removeBtn) removeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); clearFile(); });

  // MODULAR: drag-and-drop. The drop event is the trigger;
  // dragenter/dragleave manage the visual hover state.
  let dragDepth = 0;
  dropzone.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropzone.classList.add('is-drag'); });
  dropzone.addEventListener('dragover',  (e) => { e.preventDefault(); });
  dropzone.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) dropzone.classList.remove('is-drag'); });
  dropzone.addEventListener('drop',      (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-drag');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    // CLEAN: DataTransfer.files isn't a real FileList; build a
    // DataTransfer + set input.files so the form's submit handler
    // sees the dropped file via the standard input.files API.
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
