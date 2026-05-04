import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

if (!url || !publishableKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required (see .env.example)",
  );
}

// Single browser-side Supabase client. Handles email/password sign-in,
// background access-token refresh, and persists the session in localStorage so
// page refreshes keep the user signed in. Anything that needs the current
// access token reads it via supabase.auth.getSession() (or the helpers in
// lib/auth.ts).
export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
