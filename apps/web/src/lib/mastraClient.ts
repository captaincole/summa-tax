import { MastraClient } from "@mastra/client-js";
import { getPasscode } from "./auth";

// baseUrl is empty so MastraClient hits the current origin — vite proxy in
// dev, same-origin in prod. Headers are computed per-call so passcode changes
// (login → chat) take effect without re-instantiating.
export function makeMastraClient(): MastraClient {
  const passcode = getPasscode();
  return new MastraClient({
    baseUrl: "",
    headers: passcode ? { Authorization: `Bearer ${passcode}` } : {},
  });
}
