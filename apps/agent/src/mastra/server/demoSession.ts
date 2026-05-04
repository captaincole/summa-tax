// Single-user demo session config. Every route that needs to identify "who
// is this for" reads from here. When we add per-visitor auth and partitioning
// later, these get replaced by request-scoped resolution (likely via Mastra's
// RequestContext) and this module can go away entirely.
export const DEMO_TAXPAYER_ID = "demo-session";
export const DEMO_TAX_YEAR = 2025;
