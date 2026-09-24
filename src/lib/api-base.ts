// MODULAR: single place for API origin. Empty NEXT_PUBLIC_API_URL keeps
// same-origin relative paths (today's monolith). When the UI is hosted
// separately (e.g. Netlify), set NEXT_PUBLIC_API_URL to the box API origin
// so every client fetch/EventSource/beacon resolves there.

export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "";
  return raw.replace(/\/$/, "");
}

/** Absolute or same-origin URL for an API path (`/api/...`). */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBase();
  return base ? `${base}${normalized}` : normalized;
}

/**
 * Fetch credentials mode. Cross-origin API needs `include` so NextAuth
 * cookies and CORS credentialed responses work; same-origin stays tight.
 */
export function apiCredentials(): RequestCredentials {
  return getApiBase() ? "include" : "same-origin";
}

/** Shared SSE constructor — applies API base + credentials when split. */
export function apiEventSource(path: string): EventSource {
  const url = apiUrl(path);
  if (getApiBase()) return new EventSource(url, { withCredentials: true });
  return new EventSource(url);
}
