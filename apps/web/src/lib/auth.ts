import { supabase } from "./supabaseClient";

// Reads the current Supabase access token. supabase-js auto-refreshes in the
// background, so this returns whatever it has cached — usually a non-expired
// token, refreshed if needed. Returns null when the user isn't signed in.
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Reads the current authenticated user's UUID. Used as the Mastra resourceId
// — every memory operation (threads, messages, working memory) gets scoped to
// this value. The agent server also re-derives this from the JWT and forces
// it via MASTRA_RESOURCE_ID_KEY, so a tampered client value gets overridden
// (and a mismatched value 403s); we still send the right value from the
// client so the request body schema passes validation.
export async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Authorization header for fetch() calls. Async because supabase-js's session
// access is async (it may transparently refresh an expiring token).
export async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
