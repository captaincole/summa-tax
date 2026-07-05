import { MastraClient } from "@mastra/client-js";

// MastraClient pointed at the same-origin /api/agent proxy — the session
// cookie authenticates; no per-request headers needed. Still async for
// call-site compatibility with the old token-refreshing version.
export async function makeMastraClient(): Promise<MastraClient> {
  return new MastraClient({ baseUrl: "/api/agent" });
}
