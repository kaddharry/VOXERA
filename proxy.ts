import type { NextRequest } from "next/server";
import { updateSession } from "./lib/db/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Runs on every page route so the Supabase session cookie gets refreshed
  // continuously as the user navigates — not just on /admin or /onboarding
  // (updateSession() itself still only *redirects* unauthenticated visitors
  // away from those two, everything else stays public). Previously this
  // only matched /admin and /onboarding, so the session's access token
  // could silently expire while browsing any other page and never get
  // refreshed, surfacing as "I have to log in again" the next time a
  // protected page was opened in a new tab. Excludes API routes (an extra
  // Supabase Auth round trip on every voice-turn API call would add real
  // latency to a live phone conversation) and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
