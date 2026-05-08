import { MastraAuthSupabase } from "@mastra/auth-supabase";
import type { User } from "@supabase/supabase-js";
import type { HonoRequest } from "hono";

// Studio-aware Supabase auth provider. Extends MastraAuthSupabase with the
// methods Mastra Studio's UI expects so it can render an email/password
// login screen and remember the user across reloads:
//
//   • signIn(email, password) — validates against an env allowlist, then
//     calls supabase.auth.signInWithPassword. Returns user + access_token
//     + a Set-Cookie header that pins the JWT to a `mastra-token` cookie.
//     This cookie name + format mirrors what SimpleAuth uses, which is what
//     Studio reads on subsequent requests.
//
//   • getCurrentUser(request) — pulls the JWT from either the Authorization
//     header or the `mastra-token` cookie, validates via supabase, returns
//     the user. Studio's /api/auth/capabilities endpoint uses this to know
//     whether to render the login form vs. the workspace.
//
//   • authenticateToken(token, request) — same logic, falls back to cookie
//     when no Authorization header. Mastra auth middleware reads only the
//     header / `apiKey` query param at the request boundary, so without
//     this override Studio's cookie-auth fetches would 401 anyway.
//
// Web-app users are unaffected: they continue to send a Bearer JWT directly
// and never touch the cookie path.
//
// Known follow-ups: env-var allowlist is brittle (typos, redeploys); proper
// fix is RBAC + a `studio_admins` table. See
// memory/project_studio_auth_brittle.md.

const COOKIE_NAME = "mastra-token";

interface SignInResult {
  user: User;
  token: string;
  cookies: string[];
}

function loadAllowedEmails(): string[] {
  return (process.env.STUDIO_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function readMastraTokenCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(`${COOKIE_NAME}=`.length);
    }
  }
  return null;
}

function getRequestHeader(
  request: Request | { header: (n: string) => string | undefined },
  name: string,
): string | null {
  // Mastra invokes auth methods with either a Hono `HonoRequest` (.header())
  // or a standard `Request` (.headers.get()). Handle both.
  if ("headers" in request && typeof request.headers?.get === "function") {
    return request.headers.get(name);
  }
  if ("header" in request && typeof request.header === "function") {
    return request.header(name) ?? null;
  }
  return null;
}

function stripBearerPrefix(value: string): string {
  return value.replace(/^Bearer\s+/i, "").trim();
}

export class StudioSupabaseAuth extends MastraAuthSupabase {
  async signIn(email: string, password: string): Promise<SignInResult> {
    const allowed = loadAllowedEmails();
    if (allowed.length === 0) {
      throw new Error(
        "Studio sign-in is disabled: STUDIO_ALLOWED_EMAILS env var not set.",
      );
    }
    if (!allowed.includes(email.toLowerCase())) {
      throw new Error("This email is not authorized to access Studio.");
    }

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user || !data.session) {
      throw new Error(error?.message ?? "Sign-in failed");
    }

    const accessToken = data.session.access_token;
    // Max-Age = 1h to align with Supabase's default access_token TTL. When
    // the token expires, getCurrentUser returns null and Studio re-prompts
    // for sign-in. Refresh-token plumbing is a future improvement.
    const cookie = `${COOKIE_NAME}=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`;

    return {
      user: data.user,
      token: accessToken,
      cookies: [cookie],
    };
  }

  isSignUpEnabled(): boolean {
    return false;
  }

  async signUp(): Promise<never> {
    throw new Error("Sign-up via Studio is not enabled.");
  }

  async getCurrentUser(request: Request): Promise<User | null> {
    // Header path — mirrors what the Mastra auth middleware does for
    // Bearer-bearing requests.
    const authHeader = getRequestHeader(request, "Authorization");
    if (authHeader) {
      const token = stripBearerPrefix(authHeader);
      if (token) {
        const user = await super.authenticateToken(token);
        if (user) return user;
      }
    }
    // Cookie path — Studio's UI uses this after signIn.
    const cookieHeader = getRequestHeader(request, "Cookie");
    const cookieToken = readMastraTokenCookie(cookieHeader);
    if (cookieToken) {
      return super.authenticateToken(cookieToken);
    }
    return null;
  }

  async authenticateToken(
    token: string,
    request?: HonoRequest,
  ): Promise<User | null> {
    if (token) {
      const user = await super.authenticateToken(token);
      if (user) return user;
    }
    if (request) {
      const cookieHeader = getRequestHeader(request, "Cookie");
      const cookieToken = readMastraTokenCookie(cookieHeader);
      if (cookieToken) {
        return super.authenticateToken(cookieToken);
      }
    }
    return null;
  }
}
