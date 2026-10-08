import { getAppDb, ensureAppSchema, asStr, asNum, nowIso } from "./appDb";

// Filings — the ownership root. Every domain row (tax_facts, ai_decisions,
// etc.) carries a filing_id; with RLS gone, access is gated by explicit
// filing_members lookups here (the routes/tools call these before building
// a Scope).
//
// For the current single-owner-per-user flow there's one active filing per
// (user, tax_year).

export type FilingMemberRole = "owner";

export interface FilingRow {
  id: string;
  taxYear: number;
  status: string;
  createdAt: string;
}

// Resolve a user's active owner filing for a given tax year. Throws if
// there isn't exactly one — that's a misconfiguration we want to surface
// loudly rather than silently picking a filing.
export async function resolveOwnerFilingForYear(
  userId: string,
  taxYear: number,
): Promise<FilingRow> {
  await ensureAppSchema();
  const res = await getAppDb().execute({
    sql: `SELECT f.id, f.tax_year, f.status, f.created_at
          FROM filings f
          JOIN filing_members m ON m.filing_id = f.id
          WHERE m.user_id = ? AND m.role = 'owner' AND m.revoked_at IS NULL
            AND f.tax_year = ?`,
    args: [userId, taxYear],
  });
  if (res.rows.length === 0) {
    throw new Error(
      `No owner filing found for tax_year=${taxYear}. Run npm run db:seed (seedLocal.ts).`,
    );
  }
  if (res.rows.length > 1) {
    throw new Error(
      `Multiple owner filings for tax_year=${taxYear} (${res.rows.length}); ambiguous.`,
    );
  }
  const r = res.rows[0];
  return {
    id: asStr(r.id),
    taxYear: asNum(r.tax_year),
    status: asStr(r.status),
    createdAt: asStr(r.created_at),
  };
}

/** Non-revoked membership for (filing, user, role). Returns the filing's tax
 *  year, or null when no such membership — the routes' 403/404 gate. */
export async function getMembership(
  filingId: string,
  userId: string,
  role: FilingMemberRole,
): Promise<{ filingId: string; taxYear: number } | null> {
  await ensureAppSchema();
  const res = await getAppDb().execute({
    sql: `SELECT f.id, f.tax_year
          FROM filings f
          JOIN filing_members m ON m.filing_id = f.id
          WHERE f.id = ? AND m.user_id = ? AND m.role = ? AND m.revoked_at IS NULL
          LIMIT 1`,
    args: [filingId, userId, role],
  });
  const r = res.rows[0];
  return r ? { filingId: asStr(r.id), taxYear: asNum(r.tax_year) } : null;
}

/** Create a filing + owner membership. Used by the seed script and the
 *  create-filing flow. Caller supplies the id (crypto.randomUUID()). */
export async function createOwnerFiling(args: {
  filingId: string;
  userId: string;
  taxYear: number;
  status?: string;
}): Promise<void> {
  await ensureAppSchema();
  const db = getAppDb();
  await db.batch(
    [
      {
        sql: `INSERT INTO filings (id, tax_year, status, created_at) VALUES (?, ?, ?, ?)`,
        args: [args.filingId, args.taxYear, args.status ?? "draft", nowIso()],
      },
      {
        sql: `INSERT INTO filing_members (filing_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)`,
        args: [args.filingId, args.userId, nowIso()],
      },
    ],
    "write",
  );
}

/** Delete a filing; FK ON DELETE CASCADE clears every domain row under it.
 *  Ownership must be verified by the caller (getMembership) first. */
export async function deleteFilingCascade(filingId: string): Promise<void> {
  await ensureAppSchema();
  const db = getAppDb();
  // ensureAppSchema turned foreign_keys ON for this connection, so the
  // cascade fires at the SQL level.
  await db.execute({ sql: `DELETE FROM filings WHERE id = ?`, args: [filingId] });
}
