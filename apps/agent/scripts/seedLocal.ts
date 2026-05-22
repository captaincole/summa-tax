#!/usr/bin/env tsx
// Local-Supabase seed.
//
// Runs AFTER `supabase db reset` (which has already applied migrations) and
// creates:
//   1. Two auth users via the GoTrue admin API. We use the admin API rather
//      than raw INSERT INTO auth.users because GoTrue handles bcrypt hashing,
//      auth.identities row creation, and any future auth-schema additions
//      Supabase ships. Resilient to upgrades.
//   2. One 2025 owner filing per user, with an `owner` filing_members row.
//
// Idempotent — re-running this script after auth users / filings already
// exist is a no-op (admin.createUser → "User already registered" is caught
// and treated as success; filing seed has a NOT EXISTS guard).
//
// Env vars (load from apps/agent/.env.development via tsx --env-file):
//   SUPABASE_URL          local API gateway, e.g. http://127.0.0.1:54321
//   SUPABASE_SECRET_KEY   local service-role JWT (from `supabase status`)
//
// Test user credentials are hardcoded — this script is a local-dev-only tool.

import { createClient } from "@supabase/supabase-js";

const TEST_USERS = [
  { email: "rand@localhost", password: "testpass123!" },
  { email: "eawhite04@localhost", password: "testpass123!" },
];

const TAX_YEAR = 2025;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    "SUPABASE_URL and SUPABASE_SECRET_KEY must be set. For local dev, copy them from `supabase status` into apps/agent/.env.development.",
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
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the confirmation email; sign-in-ready
  });
  if (error || !data.user) {
    throw new Error(
      `createUser(${email}) failed: ${error?.message ?? "no user returned"}`,
    );
  }
  console.log(`  created auth user ${email} (${data.user.id})`);
  return data.user.id;
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

async function main() {
  console.log(`Seeding local Supabase at ${SUPABASE_URL}`);
  for (const { email, password } of TEST_USERS) {
    console.log(`\n${email}:`);
    const userId = await ensureAuthUser(email, password);
    await ensureOwnerFiling(userId, email, TAX_YEAR);
  }
  console.log("\nDone. Test users sign in with password: testpass123!");
}

main().catch((err) => {
  console.error("\nseedLocal failed:", err);
  process.exit(1);
});
