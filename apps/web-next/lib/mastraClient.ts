import { MastraClient } from "@mastra/client-js";
import { getAccessToken } from "@/lib/auth";
import { AGENT_URL } from "@/lib/agentBase";

// MastraClient takes a static headers object at construction. We rebuild per
// call so the JWT is current at request time (token refreshes get picked up
// without keeping a stale instance around).
export async function makeMastraClient(): Promise<MastraClient> {
  const token = await getAccessToken();
  return new MastraClient({
    baseUrl: AGENT_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
