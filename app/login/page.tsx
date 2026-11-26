import { login } from "./actions";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";
import { getAccess } from "../../lib/auth/access";
import { homeForRole } from "../../lib/auth/permissions";
import LoginAuthSection from "../_components/auth/LoginAuthSection";

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; message?: string; demoRequestId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const demoRequestId = searchParams?.demoRequestId;

  // Already signed in with a valid session — go straight to the dashboard
  // instead of showing the login form again. This is what was missing:
  // opening /login (or being sent here) with a live session previously
  // always re-prompted for credentials rather than recognizing you were
  // already authenticated. A Book-a-Demo visitor who's already signed in
  // continues to the confirm step instead (spec §5.3 step 4).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    if (demoRequestId) redirect(`/book-demo/confirm?id=${encodeURIComponent(demoRequestId)}`);
    const access = await getAccess().catch(() => null);
    const home = homeForRole(access?.role);
    redirect(user.user_metadata?.must_change_password ? `/account/password?next=${encodeURIComponent(home)}` : home);
  }

  return (
    <LoginAuthSection
      action={login}
      demoRequestId={demoRequestId}
      error={searchParams?.error}
      message={searchParams?.message}
    />
  );
}
