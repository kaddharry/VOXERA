import { redirect } from "next/navigation";
import { createClient } from "../lib/db/server";
import LandingPageClient from "./_components/LandingPageClient";

/**
 * A logged-in user landing on "/" (e.g. from a bookmark, or after closing
 * and reopening the app) used to always see the public marketing page —
 * same auth check app/admin/layout.tsx already uses to gate the dashboard,
 * applied here so a signed-in visit goes straight to /admin instead of
 * making them click through the landing page and log-in link again.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/admin");
  }

  return <LandingPageClient />;
}
