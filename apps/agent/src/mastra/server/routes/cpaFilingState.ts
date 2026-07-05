import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { listDocuments, type UserDocumentRow } from "../../db/userDocuments";
import { getMembership } from "../../db/filings";
import { buildCaseStateForFiling } from "../../tools/caseState";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// Read-only case-state endpoint for CPA reviewers.
//
// Mirrors /app/state but takes filingId from the path instead of resolving
// the caller's owner filing. The caller is verified to hold a non-revoked
// cpa_reviewer membership on the requested filing before the engine runs.
//
// Differences from /app/state, all intentional:
//   - No `plan` field. Luca's plan / working memory is keyed on the
//     OWNER's userId+threadId; pulling the right thread for the CPA would
//     require an owner-userId lookup that we don't need yet. The CPA's
//     forms tab doesn't render the plan.
//   - No `pendingFacts` / `pendingDecisions` — same reasoning; these are
//     owner-facing prompts ("what should Luca ask the user next?").
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
      const userId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
        | string
        | undefined;
      const authEmail =
        (requestContext?.get(REQUEST_CONTEXT_KEYS.userEmail) as
          | string
          | undefined) ?? null;
      if (!userId) return c.json({ error: "unauthorized" }, 401);

      const filingId = c.req.param("filingId");
      if (!filingId) return c.json({ error: "missing filingId" }, 400);

      // Membership gate — with RLS gone this explicit check is the ONLY
      // thing standing between a caller and someone else's filing. The
      // scope below is only built after it passes.
      const membership = await getMembership(filingId, userId, "cpa_reviewer");
      if (!membership) return c.json({ error: "forbidden" }, 403);
      const resolvedYear = membership.taxYear;

      const scope = { userId, filingId };
      const [caseState, drafts] = await Promise.all([
        buildCaseStateForFiling(scope, resolvedYear, authEmail),
        listDocuments(scope, {
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
