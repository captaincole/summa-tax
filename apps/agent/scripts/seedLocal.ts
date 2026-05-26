#!/usr/bin/env tsx
// Local-Supabase seed.
//
// Runs AFTER `supabase db reset` (which has already applied migrations) and
// creates:
//   1. Two auth users via the GoTrue admin API (one taxpayer owner + one
//      registered CPA). We use the admin API rather than raw INSERT INTO
//      auth.users because GoTrue handles bcrypt hashing, auth.identities
//      row creation, and any future auth-schema additions Supabase ships.
//      Resilient to upgrades.
//   2. One 2025 owner filing for the taxpayer, with an `owner` filing_members
//      row.
//   3. A cpa_profiles row for the CPA user. The CPA is intentionally NOT
//      pre-attached to any filing — the share flow (taxpayer invites CPA
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

const TEST_OWNERS = [
  {
    email: "rand@localhost",
    password: "testpass123!",
    displayName: "Rand al'Thor",
  },
];

const TEST_CPA = {
  email: "edwhite@localhost",
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
  const { data: existing, error: lookupError } = await admin
    .from("filing_members")
    .select("filing_id, filings!inner(id, tax_year)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .is("revoked_at", null)
    .eq("filings.tax_year", taxYear);
  if (lookupError) {
    throw new Error(`filing lookup failed for ${email}: ${lookupError.message}`);
  }
  if (existing && existing.length > 0) {
    const filingId = (existing[0] as { filing_id: string }).filing_id;
    console.log(`  filing for ${email} already exists (${filingId})`);
    return filingId;
  }

  // Insert filing + owner membership. Two statements via the service-role
  // client; we use crypto.randomUUID() in JS so we can reuse the id across
  // both inserts without a RETURNING round-trip.
  const filingId = crypto.randomUUID();
  const { error: filingError } = await admin
    .from("filings")
    .insert({ id: filingId, tax_year: taxYear, status: "draft" });
  if (filingError) {
    throw new Error(`insert filing for ${email} failed: ${filingError.message}`);
  }
  const { error: memberError } = await admin
    .from("filing_members")
    .insert({ filing_id: filingId, user_id: userId, role: "owner" });
  if (memberError) {
    throw new Error(
      `insert filing_members for ${email} failed: ${memberError.message}`,
    );
  }
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
  const { data: existing, error: lookupError } = await admin
    .from("cpa_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`cpa_profiles lookup for ${email} failed: ${lookupError.message}`);
  }
  if (existing) {
    console.log(`  cpa_profile for ${email} already exists`);
    return;
  }
  const { error } = await admin.from("cpa_profiles").insert({
    user_id: userId,
    display_name: profile.displayName,
    firm: profile.firm,
    license_number: profile.licenseNumber,
  });
  if (error) {
    throw new Error(`insert cpa_profile for ${email} failed: ${error.message}`);
  }
  console.log(`  created cpa_profile for ${email}`);
}

async function main() {
  console.log(`Seeding local Supabase at ${SUPABASE_URL}`);

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
