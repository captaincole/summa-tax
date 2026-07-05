#!/usr/bin/env tsx
// Local seed.
//
// Creates:
//   1. Two auth users via the GoTrue admin API (one taxpayer owner + one
//      registered CPA). Auth is still Supabase until Phase 2, and we use the
//      admin API rather than raw INSERT INTO auth.users because GoTrue
//      handles bcrypt hashing, auth.identities row creation, and any future
//      auth-schema additions Supabase ships. Resilient to upgrades.
//   2. One 2025 owner filing for the taxpayer, with an `owner` filing_members
//      row — in the libsql app DB (.data/app.db), where domain data lives now.
//   3. A cpa_profiles row (libsql) for the CPA user. The CPA is intentionally
//      NOT pre-attached to any filing — the share flow (taxpayer invites CPA
//      via /r/[id]/share) is what we want to exercise end-to-end.
//
// Idempotent — re-running this script after auth users / filings already
// exist is a no-op (admin.createUser → "User already registered" is caught
// and treated as success; filing/profile seeds check existence first).
//
// Env vars (load from apps/agent/.env.development via tsx --env-file):
//   SUPABASE_URL          local API gateway, e.g. http://127.0.0.1:54321
//   SUPABASE_SECRET_KEY   local service-role JWT (from `supabase status`)
//
// Test user credentials are hardcoded — this script is a local-dev-only tool.

import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { getAppDb, ensureAppSchema, nowIso } from "../src/mastra/db/appDb";
import { createOwnerFiling } from "../src/mastra/db/filings";

const TEST_OWNERS = [
  {
    email: "casey@localhost.com",
    password: "testpass123!",
    displayName: "Casey Morgan",
  },
];

const TEST_CPA = {
  email: "edwhite@localhost.com",
  password: "testpass123!",
  profile: {
    displayName: "Ed White, CPA",
    firm: "White & Co. CPAs",
    licenseNumber: "CA-204821",
  },
};

const TAX_YEAR = 2025;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !POSTGRES_URL) {
  console.error(
    "SUPABASE_URL, SUPABASE_SECRET_KEY, and POSTGRES_URL must be set. For local dev, copy them from `supabase status` into apps/agent/.env.development.",
  );
  process.exit(1);
}

// Refuse to run against anything that doesn't look like localhost — this
// script creates known-password test users, which would be a security hole
// in any non-local environment.
if (
  !SUPABASE_URL.includes("127.0.0.1") &&
  !SUPABASE_URL.includes("localhost")
) {
  console.error(
    `Refusing to seed against non-local Supabase: ${SUPABASE_URL}. ` +
      "This script is local-dev only.",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureAuthUser(
  email: string,
  password: string,
  displayName?: string,
): Promise<string> {
  // listUsers paginates; for two test users we look on page 1 only.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 100,
  });
  if (listError) {
    throw new Error(`listUsers failed: ${listError.message}`);
  }
  const existing = list.users.find((u) => u.email === email);
  if (existing) {
    console.log(`  auth user ${email} already exists (${existing.id})`);
    if (displayName) {
      const current = (existing.user_metadata as { display_name?: string } | null)
        ?.display_name;
      if (current !== displayName) {
        const { error: updateErr } = await admin.auth.admin.updateUserById(
          existing.id,
          { user_metadata: { ...existing.user_metadata, display_name: displayName } },
        );
        if (updateErr) {
          throw new Error(
            `updateUserById(${email}) failed: ${updateErr.message}`,
          );
        }
        console.log(`  updated display_name for ${email} → ${displayName}`);
      }
    }
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the confirmation email; sign-in-ready
    user_metadata: displayName ? { display_name: displayName } : undefined,
  });
  if (error || !data.user) {
    throw new Error(
      `createUser(${email}) failed: ${error?.message ?? "no user returned"}`,
    );
  }
  console.log(`  created auth user ${email} (${data.user.id})`);
  return data.user.id;
}

// Insert a mastra_threads row for the (userId, taxYear) pair if one doesn't
// already exist, so the web app's chat-history fetch on first page load
// hits an empty thread instead of Mastra's "Thread not found" 500. Thread
// id matches what apps/web/lib/returns.ts:threadIdFor produces.
async function ensureMastraThread(
  pg: PgClient,
  userId: string,
  taxYear: number,
): Promise<void> {
  const threadId = `${userId}::${taxYear}`;
  // createdAt/updatedAt are `timestamp without time zone`; the *Z variants
  // are `timestamp with time zone`. Let Postgres compute both via now()
  // rather than coercing JS Date objects to the right shape per column.
  await pg.query(
    `insert into mastra.mastra_threads (id, "resourceId", title, metadata, "createdAt", "updatedAt", "createdAtZ", "updatedAtZ")
     values ($1, $2, $3, null, (now() at time zone 'utc'), (now() at time zone 'utc'), now(), now())
     on conflict (id) do nothing`,
    [threadId, userId, `${taxYear} return`],
  );
}

async function ensureOwnerFiling(
  userId: string,
  email: string,
  taxYear: number,
): Promise<string> {
  // Look for an existing active owner membership for this (user, year).
  const db = getAppDb();
  const existing = await db.execute({
    sql: `SELECT m.filing_id FROM filing_members m
          JOIN filings f ON f.id = m.filing_id
          WHERE m.user_id = ? AND m.role = 'owner' AND m.revoked_at IS NULL
            AND f.tax_year = ?`,
    args: [userId, taxYear],
  });
  if (existing.rows.length > 0) {
    const filingId = String(existing.rows[0].filing_id);
    console.log(`  filing for ${email} already exists (${filingId})`);
    return filingId;
  }

  const filingId = crypto.randomUUID();
  await createOwnerFiling({ filingId, userId, taxYear });
  console.log(
    `  created ${taxYear} owner filing for ${email} (${filingId})`,
  );
  return filingId;
}

async function ensureCpaProfile(
  userId: string,
  email: string,
  profile: { displayName: string; firm: string; licenseNumber: string },
): Promise<void> {
  const db = getAppDb();
  const existing = await db.execute({
    sql: `SELECT user_id FROM cpa_profiles WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  if (existing.rows.length > 0) {
    console.log(`  cpa_profile for ${email} already exists`);
    return;
  }
  await db.execute({
    sql: `INSERT INTO cpa_profiles (user_id, display_name, firm, license_number, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      userId,
      profile.displayName,
      profile.firm,
      profile.licenseNumber,
      nowIso(),
    ],
  });
  console.log(`  created cpa_profile for ${email}`);
}

async function main() {
  console.log(`Seeding local auth (${SUPABASE_URL}) + libsql app DB`);
  await ensureAppSchema();

  const pg = new PgClient({ connectionString: POSTGRES_URL });
  await pg.connect();

  try {
    for (const { email, password, displayName } of TEST_OWNERS) {
      console.log(`\n${email}:`);
      const userId = await ensureAuthUser(email, password, displayName);
      await ensureOwnerFiling(userId, email, TAX_YEAR);
      await ensureMastraThread(pg, userId, TAX_YEAR);
      console.log(`  ensured mastra thread for ${email} (${TAX_YEAR})`);
    }

    console.log(`\n${TEST_CPA.email}:`);
    const cpaUserId = await ensureAuthUser(
      TEST_CPA.email,
      TEST_CPA.password,
      TEST_CPA.profile.displayName,
    );
    await ensureCpaProfile(cpaUserId, TEST_CPA.email, TEST_CPA.profile);
  } finally {
    await pg.end();
  }

  console.log(
    `\nDone. Test users sign in with password: testpass123!\n` +
      `The CPA (${TEST_CPA.email}) starts with no filing memberships — exercise\n` +
      `the share flow by signing in as a taxpayer and visiting /r/<id>/share.`,
  );
}

main().catch((err) => {
  console.error("\nseedLocal failed:", err);
  process.exit(1);
});
