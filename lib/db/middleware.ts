import { createServerClient } from "@supabase/ssr";
import { supabaseCredentials } from "../env";
import { NextResponse, type NextRequest } from "next/server";

/** Routes that require a signed-in session — everything else is public and
 * must never be redirected to /login, even though this middleware now runs
 * on nearly every request (see middleware.ts's matcher). */
const PROTECTED_PREFIXES = ["/admin", "/onboarding"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseCredentials("anon").url,
    supabaseCredentials("anon").key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() — not getSession() — deliberately makes a round trip to
  // Supabase Auth and, critically, transparently refreshes an expired
  // access token using the refresh-token cookie, writing the renewed
  // cookies via setAll() above. This is what actually keeps a session
  // alive across time; skipping it (e.g. by only ever running this on a
  // couple of routes) lets the access token silently expire while the
  // user is on any other page, which is what was causing a fresh tab to
  // require logging in again even though nothing was ever explicitly
  // logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`)
  );

  if (!user && isProtected) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
