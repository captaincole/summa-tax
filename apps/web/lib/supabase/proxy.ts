import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Public routes that don't require auth. Everything else gets redirected
// to /login when the session is missing.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/preview"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Runs once per navigation. Two jobs:
//   1. Refresh the Supabase session cookie if it's expiring, writing the new
//      cookies back to the outgoing response. Without this, Server Components
//      will see a stale token and 401 on Supabase calls.
//   2. Optimistic redirect: if there's no user, send them to /login. Layouts
//      still re-check via getUser() — the Proxy is just a fast first pass.
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() is the verified call (contacts the Auth server).
  // getSession() reads cookies without verification — unsafe for auth gating.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If signed in and on /login, bounce to home.
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
