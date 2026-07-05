import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { getServiceRoleClient } from "../../db/supabase";
import { getAppDb, ensureAppSchema, nowIso } from "../../db/appDb";
import { getMembership } from "../../db/filings";

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
// Two writes happen on every invite, both in the libsql app DB:
//   1. filing_invites (status='accepted', accepted_at=now()) — the visible
//      audit/lifecycle record. Read by the Share page to mark "Invited".
//   2. filing_members (role='cpa_reviewer', revoked_at=null) — the actual
//      access-control row. Read by every explicit membership gate.
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
      const callerId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
        | string
        | undefined;
      if (!callerId) return c.json({ error: "unauthorized" }, 401);

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

      // Ownership check — explicit gate (RLS is gone).
      const ownerCheck = await getMembership(filingId, callerId, "owner");
      if (!ownerCheck) return c.json({ error: "forbidden" }, 403);

      // Auth is still Supabase (until Phase 2) — the admin client is only
      // used to verify the invitee exists in auth.users.
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
      await ensureAppSchema();
      const db = getAppDb();
      const profile = await db.execute({
        sql: `SELECT display_name FROM cpa_profiles WHERE user_id = ? LIMIT 1`,
        args: [inviteeId],
      });
      const displayName =
        (profile.rows[0]?.display_name as string | undefined) ??
        inviteeAuth.user.email ??
        "Unknown reviewer";

      // 1. filing_invites — the visible record. Auto-accepted today.
      // 2. filing_members — the actual access. Done second so a partial
      //    failure leaves a visible invites row with no access (re-clicking
      //    converges; the upserts are idempotent). If we did filing_members
      //    first and filing_invites failed, the inverse — access granted but
      //    no visible record — would be worse for the owner's mental model.
      const now = nowIso();
      await db.execute({
        sql: `INSERT INTO filing_invites
                (filing_id, invitee_user_id, invited_by_user_id, status, invited_at, accepted_at, revoked_at)
              VALUES (?, ?, ?, 'accepted', ?, ?, NULL)
              ON CONFLICT (filing_id, invitee_user_id) DO UPDATE SET
                status = 'accepted', accepted_at = excluded.accepted_at, revoked_at = NULL`,
        args: [filingId, inviteeId, callerId, now, now],
      });
      await db.execute({
        sql: `INSERT INTO filing_members (filing_id, user_id, role, added_at, revoked_at)
              VALUES (?, ?, 'cpa_reviewer', ?, NULL)
              ON CONFLICT (filing_id, user_id) DO UPDATE SET
                role = 'cpa_reviewer', revoked_at = NULL`,
        args: [filingId, inviteeId, now],
      });

      const response: InviteResponse = {
        ok: true,
        invitee: { userId: inviteeId, displayName },
      };
      return c.json(response);
    },
  },
);
