import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { listDocuments, type UserDocumentRow } from "../../db/userDocuments";
import { buildCaseStateForFiling } from "../../tools/caseState";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// Read-only case-state endpoint for CPA reviewers.
//
// Mirrors /app/state but takes filingId from the path instead of resolving
// the caller's owner filing. The caller is verified to hold a non-revoked
// cpa_reviewer membership on the requested filing before the engine runs.
//
// Differences from /app/state, all intentional:
//   - No `plan` field. Thom's plan / working memory is keyed on the
//     OWNER's userId+threadId; pulling the right thread for the CPA would
//     require an owner-userId lookup that we don't need yet. The CPA's
//     forms tab doesn't render the plan.
//   - No `pendingFacts` / `pendingDecisions` — same reasoning; these are
//     owner-facing prompts ("what should Thom ask the user next?").
//     Build them back in when the CPA needs a "what's blocking this
//     return?" view.
//
// Engine evaluation itself is pure — running it on the CPA's behalf
// reads facts/decisions but writes nothing, so this stays a true GET.

export const cpaFilingStateRoute = registerApiRoute(
  "/app/cpa/filings/:filingId/state",
  {
    method: "GET",
    handler: async (c) => {
      const requestContext = c.get("requestContext");
      const supabase = requestContext?.get(REQUEST_CONTEXT_KEYS.userSupabase) as
        | SupabaseClient
        | undefined;
      const userId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
        | string
        | undefined;
      if (!supabase || !userId) return c.json({ error: "unauthorized" }, 401);

      const filingId = c.req.param("filingId");
      if (!filingId) return c.json({ error: "missing filingId" }, 400);

      // Membership gate via the filings table with an !inner join on the
      // membership predicate. RLS would naturally hide non-member rows
      // anyway; the explicit role/user_id eq() makes the gate readable in
      // logs and keeps the query result a clean { id, tax_year } shape.
      const { data: filing, error: filingErr } = await supabase
        .from("filings")
        .select("id, tax_year, filing_members!inner(role, revoked_at, user_id)")
        .eq("id", filingId)
        .eq("filing_members.user_id", userId)
        .eq("filing_members.role", "cpa_reviewer")
        .is("filing_members.revoked_at", null)
        .maybeSingle();
      if (filingErr) {
        return c.json(
          { error: `filing lookup failed: ${filingErr.message}` },
          500,
        );
      }
      if (!filing) return c.json({ error: "forbidden" }, 403);
      const resolvedYear = (filing as { tax_year: number }).tax_year;

      const [caseState, drafts] = await Promise.all([
        buildCaseStateForFiling(supabase, filingId, resolvedYear),
        listDocuments(supabase, {
          category: "drafts",
          taxYear: resolvedYear,
          filingId,
        }),
      ]);

      // Most recent draft per formId. Matches /app/state semantics — engine
      // regenerates on every owner turn, so the latest snapshot wins.
      const latestByForm = new Map<string, UserDocumentRow>();
      for (const d of drafts) {
        const formId = (d.metadata as { formId?: string } | null)?.formId;
        if (formId && !latestByForm.has(formId)) latestByForm.set(formId, d);
      }
      const urlFor = (formId: string) => {
        const d = latestByForm.get(formId);
        return d ? `/documents/${d.id}` : null;
      };

      return c.json({
        filingId,
        taxYear: resolvedYear,
        taxpayerFirstName: caseState.filingInfo.taxpayerFirstName ?? null,
        taxpayerLastName: caseState.filingInfo.taxpayerLastName ?? null,
        authEmail: caseState.authEmail,
        factCount: caseState.factCount,
        decisionCount: caseState.decisionRows.length,
        forms: caseState.summaries,
        money: caseState.money,
        documents: {
          form1040Url: urlFor("1040"),
          form540Url: urlFor("540"),
          sidecarUrl: urlFor("sidecar"),
        },
      });
    },
  },
);
