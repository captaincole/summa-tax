import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { getServiceRoleClient } from "../../db/supabase";
import { thom } from "../../agents/thom";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// DELETE /app/filings/:filingId
//
// Owner-only filing deletion. Cascades:
//   - public.filings ON DELETE CASCADE → filing_members, filing_invites,
//     tax_facts, ai_decisions, open_questions, user_documents,
//     requested_actions, review_runs, review_run_steps. Every domain row
//     carries a filing_id with cascade, so a single DELETE on filings is
//     enough at the SQL level.
//   - Storage objects under {filingId}/... are NOT cascaded by FK (storage
//     is a separate subsystem). We list + remove them explicitly first.
//   - Mastra thread keyed by `${userId}::${taxYear}` is also not FK-tied to
//     filings — we delete it via Memory.deleteThread so the next filing the
//     user creates for that year starts with a clean chat.
//
// Errors:
//   401 — no JWT / unverified caller
//   403 — caller is not the filing's owner
//   404 — no such filing (or RLS hides it from the caller)

const STORAGE_BUCKET = "user-documents";

function threadIdFor(userId: string, year: number | string): string {
  return `${userId}::${year}`;
}

export const deleteFilingRoute = registerApiRoute(
  "/app/filings/:filingId",
  {
    method: "DELETE",
    handler: async (c) => {
      const requestContext = c.get("requestContext");
      const supabase = requestContext?.get(REQUEST_CONTEXT_KEYS.userSupabase) as
        | SupabaseClient
        | undefined;
      const callerId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
        | string
        | undefined;
      if (!supabase || !callerId) return c.json({ error: "unauthorized" }, 401);

      const filingId = c.req.param("filingId");
      if (!filingId) return c.json({ error: "missing filingId" }, 400);

      // Ownership check via the user-scoped client. RLS already restricts
      // visibility to the caller's filings; the explicit role='owner' makes
      // the gate readable in logs.
      const { data: ownership, error: ownerErr } = await supabase
        .from("filing_members")
        .select("filing_id, filings!inner(id, tax_year)")
        .eq("filing_id", filingId)
        .eq("user_id", callerId)
        .eq("role", "owner")
        .is("revoked_at", null)
        .maybeSingle();
      if (ownerErr) {
        return c.json(
          { error: `ownership check failed: ${ownerErr.message}` },
          500,
        );
      }
      if (!ownership) return c.json({ error: "forbidden" }, 403);
      // PostgREST returns the joined `filings` as either an object or an
      // array depending on the relationship cardinality — TypeScript types
      // it as an array. Normalize defensively.
      const filingsJoin = (ownership as { filings: unknown }).filings;
      const filingRow = Array.isArray(filingsJoin) ? filingsJoin[0] : filingsJoin;
      const taxYear = (filingRow as { tax_year: number }).tax_year;

      const admin = getServiceRoleClient();

      // 1. Storage objects. List by folder prefix, then bulk-remove. Storage
      // RLS would block the user-scoped client from seeing peer reviewers'
      // uploads (none today, but defensive), so admin is the safer client.
      const { data: objects, error: listErr } = await admin.storage
        .from(STORAGE_BUCKET)
        .list(filingId, { limit: 1000 });
      if (listErr) {
        return c.json(
          { error: `storage list failed: ${listErr.message}` },
          500,
        );
      }
      const paths = (objects ?? []).map((o) => `${filingId}/${o.name}`);
      if (paths.length > 0) {
        const { error: removeErr } = await admin.storage
          .from(STORAGE_BUCKET)
          .remove(paths);
        if (removeErr) {
          return c.json(
            { error: `storage remove failed: ${removeErr.message}` },
            500,
          );
        }
      }

      // 2. The filings row. FK cascade does the rest of the domain cleanup.
      const { error: deleteErr } = await admin
        .from("filings")
        .delete()
        .eq("id", filingId);
      if (deleteErr) {
        return c.json(
          { error: `filings delete failed: ${deleteErr.message}` },
          500,
        );
      }

      // 3. Mastra thread. The id format must match what the web app uses
      // when streaming (apps/web/lib/returns.ts:threadIdFor). Quietly
      // continue if Memory isn't configured or the thread is already gone.
      try {
        const memory = await thom.getMemory();
        if (memory) {
          await memory.deleteThread(threadIdFor(callerId, taxYear));
        }
      } catch {
        // No-op — thread cleanup is best-effort.
      }

      return c.json({
        ok: true,
        filingId,
        taxYear,
        storageObjectsDeleted: paths.length,
      });
    },
  },
);
