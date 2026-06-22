// MODULAR: pure helpers shared across pages and components.

// CLEAN: HTML-escape untrusted strings before injecting into dangerouslySetInnerHTML.
export function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// MODULAR: clamp helper used by the taste graph and any other code that
// needs to keep a value inside [min, max].
export function clamp(v: number, min: number, max: number, fallback = min): number {
  if (typeof v !== "number" || Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

// MODULAR: copy a string to the clipboard with a best-effort fallback.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

// MODULAR: a class-name joiner. Filters out falsy values; small replacement
// for the `clsx` library (which is not currently a dependency).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
