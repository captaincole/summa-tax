import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { getMembership, deleteFilingCascade } from "../../db/filings";
import { deleteFilingBlobs } from "../../db/blobStore";
import { luca } from "../../agents/luca";

// DELETE /app/filings/:filingId
//
// Owner-only filing deletion. Cascades:
//   - filings ON DELETE CASCADE (libsql app DB) → filing_members,
//     filing_invites, tax_facts, ai_decisions, open_questions,
//     user_documents, requested_actions, review_runs, review_run_steps.
//     Every domain row carries a filing_id with cascade, so a single
//     DELETE on filings is enough at the SQL level.
//   - Blob files under .data/documents/{filingId}/ are NOT cascaded by the
//     DB — we remove the directory explicitly first.
//   - Mastra thread keyed by `${userId}::${taxYear}` is also not FK-tied to
//     filings — we delete it via Memory.deleteThread so the next filing the
//     user creates for that year starts with a clean chat.
//
// Errors:
//   401 — no JWT / unverified caller
//   403 — caller is not the filing's owner (or no such filing)

function threadIdFor(userId: string, year: number | string): string {
  return `${userId}::${year}`;
}

export const deleteFilingRoute = registerApiRoute(
  "/app/filings/:filingId",
  {
    method: "DELETE",
    handler: async (c) => {
      const requestContext = c.get("requestContext");
      const callerId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
        | string
        | undefined;
      if (!callerId) return c.json({ error: "unauthorized" }, 401);

      const filingId = c.req.param("filingId");
      if (!filingId) return c.json({ error: "missing filingId" }, 400);

      // Ownership check — with RLS gone this explicit gate is the only
      // thing standing between the caller and someone else's filing.
      const ownership = await getMembership(filingId, callerId, "owner");
      if (!ownership) return c.json({ error: "forbidden" }, 403);
      const taxYear = ownership.taxYear;

      // 1. Blob files — remove the filing's whole directory.
      await deleteFilingBlobs(filingId);

      // 2. The filings row. FK cascade does the rest of the domain cleanup.
      await deleteFilingCascade(filingId);

      // 3. Mastra thread. The id format must match what the web app uses
      // when streaming (apps/web/lib/returns.ts:threadIdFor). Quietly
      // continue if Memory isn't configured or the thread is already gone.
      try {
        const memory = await luca.getMemory();
        if (memory) {
          await memory.deleteThread(threadIdFor(callerId, taxYear));
        }
      } catch {
        // No-op — thread cleanup is best-effort.
      }

      return c.json({ ok: true, filingId, taxYear });
    },
  },
);
