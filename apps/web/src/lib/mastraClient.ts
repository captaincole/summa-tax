import { MastraClient } from "@mastra/client-js";
import { getPasscode } from "./auth";
import { API_BASE } from "./apiBase";

// API_BASE is empty in dev (Vite proxy) and the Render origin in prod.
// Headers are computed per-call so passcode changes (login → chat) take
// effect without re-instantiating.
export function makeMastraClient(): MastraClient {
  const passcode = getPasscode();
  return new MastraClient({
    baseUrl: API_BASE,
    headers: passcode ? { Authorization: `Bearer ${passcode}` } : {},
  });
}
