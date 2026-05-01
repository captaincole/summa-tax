// API base URL. In prod (Vercel) this is set at build time to the Render
// origin so cross-origin fetches go to the right host. In dev it's empty,
// which keeps relative URLs flowing through Vite's proxy to localhost:4111.
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// Resolves a backend path against API_BASE. Pass-throughs:
//   - empty API_BASE (dev) → returns path as-is (Vite proxies it)
//   - already-absolute URL → returns unchanged
// All other paths get prefixed. Use for fetch URLs and <a href> values that
// point at the API.
export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
