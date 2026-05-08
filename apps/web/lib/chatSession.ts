// Shared session keys for the demo chat. AppShell (history rehydration on
// mount) and the Chat page (streaming new turns) both need these to point
// at the same Mastra memory bucket.
//
// resourceId comes from getUserId() at call sites — each user gets their
// own (user_id, "demo-thread") pair. The agent server force-sets the same
// value via mapUserToResourceId / MASTRA_RESOURCE_ID_KEY, so a tampered
// client value would 403 rather than leak.
export const DEMO_THREAD_ID = "demo-thread";
export const THOM_AGENT_ID = "thom";
