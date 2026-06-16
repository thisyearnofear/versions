// MODULAR: API client. Single base URL + JSON helpers.
// DRY: every fetch goes through this; no raw fetch() anywhere else.

'use strict';

const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const baseUrl = isLocalhost ? 'http://localhost:8080' : `${location.protocol}//${location.host}`;

async function request(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { success: false, error: { message: text } }; }
  if (!res.ok) {
    const msg = json && json.error ? json.error.message : `HTTP ${res.status}`;
    const code = json && json.error ? json.error.code : 'HTTP_ERROR';
    const err = new Error(msg);
    err.code = code;
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json && json.data !== undefined ? json.data : json;
}

export const api = {
  baseUrl,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  delete: (path, body) => request('DELETE', path, body)
};

export { baseUrl };
