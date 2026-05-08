// Origin of the Mastra agent. Used by chat streaming + /app/session/reset.
// Everything else (state, activity, documents) reads Supabase directly via
// Server Components, so this is intentionally narrow.
export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "";

if (!AGENT_URL) {
  throw new Error("NEXT_PUBLIC_AGENT_URL is required (see .env.example)");
}

export function agentUrl(path: string): string {
  return `${AGENT_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
