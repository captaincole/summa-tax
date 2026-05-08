import { createClient } from "@/lib/supabase/client";

// Read helpers backed by the browser Supabase client. supabase-js handles
// background access-token refresh (the cookie gets updated by the proxy on
// navigation and by supabase-js on token rotation). These helpers exist so
// chat streaming + uploads can read the current JWT / user-id without
// importing the client directly everywhere.

export async function getAccessToken(): Promise<string | null> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getUserId(): Promise<string | null> {
  const { data } = await createClient().auth.getSession();
  return data.session?.user.id ?? null;
}

// Authorization header for cross-origin agent requests (chat streaming +
// /app/session/reset). Same-origin Server Component reads use the cookie
// instead via lib/supabase/server.ts.
export async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
