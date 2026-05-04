import { MastraClient } from "@mastra/client-js";
import { getAccessToken } from "./auth";
import { API_BASE } from "./apiBase";

// API_BASE is empty in dev (Vite proxy) and the Render origin in prod.
// MastraClient takes a static headers object at construction, so we recreate
// the client per call to pick up token changes (sign-in, refresh) without
// keeping a stale instance around.
export async function makeMastraClient(): Promise<MastraClient> {
  const token = await getAccessToken();
  return new MastraClient({
    baseUrl: API_BASE,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
