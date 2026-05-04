// Shared session keys for the demo chat. Both Layout (history rehydration on
// mount) and Chat (streaming new turns) need these to point at the same
// Mastra memory bucket — keep them in one place.
//
// resourceId comes from getUserId() at call sites (Chat) — each user gets
// their own `(user_id, "demo-thread")` pair. The agent server force-sets the
// same value via mapUserToResourceId / MASTRA_RESOURCE_ID_KEY, so a tampered
// client value would 403 rather than leak.
export const DEMO_THREAD_ID = "demo-thread";
export const THOM_AGENT_ID = "thom";
