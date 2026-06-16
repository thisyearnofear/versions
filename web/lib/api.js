// MODULAR: API client. Single base URL + JSON helpers.
// DRY: every fetch goes through this; no raw fetch() anywhere else.
//
// MODULAR: the proxy serves the web client AND the API on the same
// origin (Docker is single-port). The "localhost" override below is
// the dev-mode escape hatch for the case where the web is served by
// a separate python http.server on a port other than 8080 while the
// proxy runs on :8080. In any other deployment, just use the
// current origin.

'use strict';

const API_PORT = '8080';   // default; can be overridden via meta tag in production
const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const port = location.port;
const isDevMode = isLocalhost && port && port !== API_PORT;
const baseUrl = isDevMode ? `http://localhost:${API_PORT}` : `${location.protocol}//${location.host}`;

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
