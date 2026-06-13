import { cors } from "hono/cors";

// Comma-separated list of origins allowed to call the API cross-origin.
// Supports a single leading "*." wildcard for preview-deploy patterns:
//   "https://summa-web.vercel.app,https://*.vercel.app"
// Empty / unset → allow all origins (intended for local dev only).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function matchesAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some((pattern) => {
    if (pattern === origin) return true;
    if (pattern.startsWith("*.")) return origin.endsWith(pattern.slice(1));
    if (pattern.includes("://*.")) {
      const [scheme, suffix] = pattern.split("://*.");
      return origin.startsWith(`${scheme}://`) && origin.endsWith(`.${suffix}`);
    }
    return false;
  });
}

// Hono's cors() returns a (c, next) middleware that handles preflights and
// stamps response headers. Echoing the request origin (rather than "*") is
// required because we send credentials (Authorization: Bearer …).
export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return null;
    if (ALLOWED_ORIGINS.length === 0) return origin;
    return matchesAllowed(origin) ? origin : null;
  },
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});
