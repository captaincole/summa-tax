import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { getOwnerAuthRow, insertOwnerRow, type OwnerAuthRow } from "@/lib/serverDb";

// Single-user auth: identity = the instance. One `owner` row in app.db holds
// profile data (name/email) plus the gate's credentials — an scrypt password
// hash and the HMAC secret for session cookies (generated at setup, so
// there's no SESSION_SECRET env var to configure). ~100 lines, node:crypto
// only, deliberately auditable in one sitting.
//
// Session cookie: `${base64url(payload)}.${base64url(hmac)}` where payload =
// {uid, exp}. httpOnly + sameSite=lax; verification happens server-side in
// layouts/route handlers (proxy.ts only does an optimistic presence check —
// the Edge runtime can't read app.db).

export const SESSION_COOKIE = "summa_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface OwnerSession {
  userId: string;
  email: string;
  displayName: string;
}

// ─── Password hashing ───────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// ─── Session tokens ─────────────────────────────────────────────────────

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function mintToken(userId: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token: string, secret: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      uid?: string;
      exp?: number;
    };
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/** Has first-run setup been completed? */
export async function ownerExists(): Promise<boolean> {
  return (await getOwnerAuthRow()) !== null;
}

/** First-run setup: create the owner. Throws if one already exists. */
export async function createOwner(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<OwnerSession> {
  if (await ownerExists()) throw new Error("owner already exists");
  const row: OwnerAuthRow = {
    id: crypto.randomUUID(),
    email: input.email,
    displayName: input.displayName,
    passwordHash: hashPassword(input.password),
    sessionSecret: randomBytes(32).toString("hex"),
  };
  await insertOwnerRow(row);
  return { userId: row.id, email: row.email, displayName: row.displayName };
}

/** Verify the password and set the session cookie. Returns null on failure. */
export async function login(password: string): Promise<OwnerSession | null> {
  const owner = await getOwnerAuthRow();
  if (!owner || !verifyPassword(password, owner.passwordHash)) return null;
  await setSessionCookie(owner);
  return { userId: owner.id, email: owner.email, displayName: owner.displayName };
}

export async function setSessionCookie(owner: OwnerAuthRow): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, mintToken(owner.id, owner.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    // localhost is http; only mark secure when actually served over https.
    secure: process.env.NODE_ENV === "production" && process.env.FORCE_INSECURE_COOKIE !== "1",
  });
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The verified session, or null. Server-side only (layouts, route handlers). */
export async function getOwnerSession(): Promise<OwnerSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const owner = await getOwnerAuthRow();
  if (!owner) return null;
  const uid = verifyToken(token, owner.sessionSecret);
  if (!uid || uid !== owner.id) return null;
  return { userId: owner.id, email: owner.email, displayName: owner.displayName };
}
