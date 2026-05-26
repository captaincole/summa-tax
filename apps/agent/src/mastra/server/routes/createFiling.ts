import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { getServiceRoleClient } from "../../db/supabase";
import { thom } from "../../agents/thom";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// POST /app/filings
// body: { taxYear?: number }
//
// Creates a new filing for the calling user with an `owner` membership. If
// the caller already has a non-revoked owner membership for the requested
// tax_year, return that existing filing (idempotent — the home-home "Start
// your 2025 filing" button is safe to double-click). Both writes go through
// the service-role client because filings + filing_members are write-locked
// to service-role per the migration (see 20260521085200_filings.sql notes).
//
// Errors:
//   401 — no JWT / unverified caller
//   400 — taxYear out of plausible range (defensive)

const DEFAULT_TAX_YEAR = 2025;
const MIN_TAX_YEAR = 2020;
const MAX_TAX_YEAR = 2030;

// Must match apps/web/lib/returns.ts:threadIdFor — no shared package yet.
function threadIdFor(userId: string, year: number | string): string {
  return `${userId}::${year}`;
}

// Best-effort: create the per-filing Mastra thread so the chat-history
// fetch from AppShell.loadChatHistory finds a thread (empty messages list)
// instead of triggering Mastra's "Thread not found" 500. Errors are
// swallowed because creating the filing is what matters; the thread will
// be lazily created on the user's first message if this fails.
async function ensureThread(userId: string, taxYear: number): Promise<void> {
  try {
    const memory = await thom.getMemory();
    if (!memory) return;
    await memory.createThread({
      threadId: threadIdFor(userId, taxYear),
      resourceId: userId,
      title: `${taxYear} return`,
    });
  } catch {
    // No-op — thread bootstrap is best-effort.
  }
}

export const createFilingRoute = registerApiRoute("/app/filings", {
  method: "POST",
  handler: async (c) => {
    const requestContext = c.get("requestContext");
    const supabase = requestContext?.get(REQUEST_CONTEXT_KEYS.userSupabase) as
      | SupabaseClient
      | undefined;
    const callerId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
      | string
      | undefined;
    if (!supabase || !callerId) return c.json({ error: "unauthorized" }, 401);

    let body: unknown = undefined;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const taxYearRaw = (body as { taxYear?: unknown })?.taxYear;
    const taxYear =
      typeof taxYearRaw === "number" && Number.isInteger(taxYearRaw)
        ? taxYearRaw
        : DEFAULT_TAX_YEAR;
    if (taxYear < MIN_TAX_YEAR || taxYear > MAX_TAX_YEAR) {
      return c.json({ error: `taxYear out of range (${taxYear})` }, 400);
    }

    // Idempotency check via the user-scoped client — RLS scopes this to
    // filings the caller has membership on.
    const { data: existing, error: lookupErr } = await supabase
      .from("filings")
      .select("id, tax_year, status, filing_members!inner(role, revoked_at)")
      .eq("tax_year", taxYear)
      .eq("filing_members.role", "owner")
      .is("filing_members.revoked_at", null)
      .maybeSingle();
    if (lookupErr) {
      return c.json(
        { error: `filing lookup failed: ${lookupErr.message}` },
        500,
      );
    }
    if (existing) {
      const row = existing as { id: string; tax_year: number; status: string };
      // Defensive: ensure the thread exists even on the idempotent path,
      // in case an earlier filing created the row but the thread bootstrap
      // failed (or the filing pre-dates this route's thread-creation logic).
      await ensureThread(callerId, row.tax_year);
      return c.json({
        filing: { id: row.id, taxYear: row.tax_year, status: row.status },
        created: false,
      });
    }

    // Insert filing + owner membership via service-role. crypto.randomUUID()
    // lets us reuse the id across both inserts without a RETURNING roundtrip.
    const admin = getServiceRoleClient();
    const filingId = crypto.randomUUID();
    const { error: filingErr } = await admin
      .from("filings")
      .insert({ id: filingId, tax_year: taxYear, status: "draft" });
    if (filingErr) {
      return c.json(
        { error: `filings insert failed: ${filingErr.message}` },
        500,
      );
    }
    const { error: memberErr } = await admin
      .from("filing_members")
      .insert({ filing_id: filingId, user_id: callerId, role: "owner" });
    if (memberErr) {
      return c.json(
        { error: `filing_members insert failed: ${memberErr.message}` },
        500,
      );
    }

    await ensureThread(callerId, taxYear);

    return c.json({
      filing: { id: filingId, taxYear, status: "draft" },
      created: true,
    });
  },
});
