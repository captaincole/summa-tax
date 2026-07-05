import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { getAppDb, ensureAppSchema } from "../../db/appDb";
import { createOwnerFiling } from "../../db/filings";
import { luca } from "../../agents/luca";

// POST /app/filings
// body: { taxYear?: number }
//
// Creates a new filing for the calling user with an `owner` membership in
// the libsql app DB. If the caller already has a non-revoked owner
// membership for the requested tax_year, return that existing filing
// (idempotent — the home-home "Start your 2025 filing" button is safe to
// double-click).
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
    const memory = await luca.getMemory();
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
    const callerId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
      | string
      | undefined;
    if (!callerId) return c.json({ error: "unauthorized" }, 401);

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

    // Idempotency check — explicit membership predicate (RLS is gone).
    await ensureAppSchema();
    const existing = await getAppDb().execute({
      sql: `SELECT f.id, f.tax_year, f.status
            FROM filings f
            JOIN filing_members m ON m.filing_id = f.id
            WHERE m.user_id = ? AND m.role = 'owner' AND m.revoked_at IS NULL
              AND f.tax_year = ?
            LIMIT 1`,
      args: [callerId, taxYear],
    });
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      // Defensive: ensure the thread exists even on the idempotent path,
      // in case an earlier filing created the row but the thread bootstrap
      // failed (or the filing pre-dates this route's thread-creation logic).
      await ensureThread(callerId, Number(row.tax_year));
      return c.json({
        filing: {
          id: String(row.id),
          taxYear: Number(row.tax_year),
          status: String(row.status),
        },
        created: false,
      });
    }

    const filingId = crypto.randomUUID();
    await createOwnerFiling({ filingId, userId: callerId, taxYear });

    await ensureThread(callerId, taxYear);

    return c.json({
      filing: { id: filingId, taxYear, status: "draft" },
      created: true,
    });
  },
});
