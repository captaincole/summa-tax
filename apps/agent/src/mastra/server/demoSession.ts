// Tax year used by routes and the agent until we expose a year selector.
// Identity is now provided by Supabase Auth (see userSupabaseMiddleware);
// these constants are what survived from the old demo-session config.
export const DEMO_TAX_YEAR = 2025;

// Mirrors apps/web/lib/chatSession.ts — single thread per user for the demo.
// Used by /app/state to look up Thom's working-memory plan for that thread.
// Move to per-tax-year threads when we introduce a year selector.
export const DEMO_THREAD_ID = "demo-thread";
