import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 file convention: this is the renamed Middleware. Optimistic
// gate only — the Edge runtime can't read app.db to verify the session
// HMAC, so this checks cookie PRESENCE and redirects; every layout and
// route handler re-verifies with getOwnerSession() (node runtime).
//
// Cookie name duplicated from lib/localAuth.ts on purpose: importing that
// module here would drag node:crypto into the Edge bundle.

const SESSION_COOKIE = "summa_session";

const PUBLIC_PATHS = ["/login", "/setup", "/api/auth", "/preview"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(request: NextRequest) {
  const hasCookie = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasCookie && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasCookie && (pathname === "/login" || pathname === "/setup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
