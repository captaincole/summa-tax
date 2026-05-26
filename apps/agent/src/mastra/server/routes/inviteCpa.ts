import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { getServiceRoleClient } from "../../db/supabase";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// POST /app/filings/:filingId/invite-cpa
// body: { userId: string }
//
// Owner-only affordance. The caller must hold a non-revoked `owner` membership
// on the filing; the body carries the user_id of the registered CPA being
// invited (the Share UI picks from cpa_profiles via the directory). There
// is no "accept" step today — the invite lands as status='accepted' and
// access is granted immediately. The status column on filing_invites gives
// us a clean room to add manual-accept later without re-shaping the table.
//
// Two writes happen on every invite, both via service-role:
//   1. filing_invites (status='accepted', accepted_at=now()) — the visible
//      audit/lifecycle record. Read by the Share page to mark "Invited".
//   2. filing_members (role='cpa_reviewer', revoked_at=null) — the actual
//      access-control row. Read by every domain-table RLS predicate.
// Both are upserts on (filing_id, user_id), so re-inviting an existing
// reviewer is idempotent (and unrevokes a previously-revoked share).
//
// Errors:
//   401 — no JWT / unverified caller
//   400 — missing/invalid userId body
//   403 — caller is not the filing's owner
//   404 — userId doesn't point to an existing auth user

interface InviteResponse {
  ok: true;
  invitee: {
    userId: string;
    displayName: string;
  };
}

export const inviteCpaRoute = registerApiRoute(
  "/app/filings/:filingId/invite-cpa",
  {
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

      const filingId = c.req.param("filingId");
      if (!filingId) return c.json({ error: "missing filingId" }, 400);

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "body must be JSON" }, 400);
      }
      const inviteeId = (body as { userId?: unknown })?.userId;
      if (typeof inviteeId !== "string" || inviteeId.length === 0) {
        return c.json({ error: "userId is required" }, 400);
      }

      // Ownership check via the user-scoped client. RLS already gates this
      // to filings the caller has membership on; the explicit role='owner'
      // makes the gate readable in logs.
      const { data: ownerCheck, error: ownerErr } = await supabase
        .from("filing_members")
        .select("filing_id")
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
      if (!ownerCheck) return c.json({ error: "forbidden" }, 403);

      const admin = getServiceRoleClient();

      // Verify the invitee actually exists in auth.users. Cheaper than
      // letting the FK constraint fail mid-upsert + clearer error message.
      const { data: inviteeAuth, error: inviteeAuthErr } =
        await admin.auth.admin.getUserById(inviteeId);
      if (inviteeAuthErr || !inviteeAuth?.user) {
        return c.json({ error: "no user with that id" }, 404);
      }

      // cpa_profiles is informational only — used to surface the display
      // name in the success response. A missing profile is not a gate.
      const { data: profile } = await admin
        .from("cpa_profiles")
        .select("display_name")
        .eq("user_id", inviteeId)
        .maybeSingle();
      const displayName =
        (profile as { display_name?: string } | null)?.display_name ??
        inviteeAuth.user.email ??
        "Unknown reviewer";

      // 1. filing_invites — the visible record. Auto-accepted today.
      const nowIso = new Date().toISOString();
      const { error: inviteErr } = await admin.from("filing_invites").upsert(
        {
          filing_id: filingId,
          invitee_user_id: inviteeId,
          invited_by_user_id: callerId,
          status: "accepted",
          accepted_at: nowIso,
          revoked_at: null,
        },
        { onConflict: "filing_id,invitee_user_id" },
      );
      if (inviteErr) {
        return c.json(
          { error: `filing_invites write failed: ${inviteErr.message}` },
          500,
        );
      }

      // 2. filing_members — the actual access. Done second so a partial
      // failure leaves a visible invites row with no access (re-clicking
      // converges; the upserts are idempotent). If we did filing_members
      // first and filing_invites failed, the inverse — access granted but
      // no visible record — would be worse for the owner's mental model.
      const { error: memberErr } = await admin.from("filing_members").upsert(
        {
          filing_id: filingId,
          user_id: inviteeId,
          role: "cpa_reviewer",
          revoked_at: null,
        },
        { onConflict: "filing_id,user_id" },
      );
      if (memberErr) {
        return c.json(
          { error: `filing_members write failed: ${memberErr.message}` },
          500,
        );
      }

      const response: InviteResponse = {
        ok: true,
        invitee: { userId: inviteeId, displayName },
      };
      return c.json(response);
    },
  },
);
