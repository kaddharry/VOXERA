import { redirect } from "next/navigation";
import { createClient } from "../../../lib/db/server";
import { changePassword } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error, next } = await searchParams;
  const forced = !!user.user_metadata?.must_change_password;

  return (
    <main className="voxera-admin-dark flex min-h-screen items-center justify-center bg-[var(--color-bg-base)] px-4 font-body text-[var(--color-text-primary)]">
      <form action={changePassword} className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6">
        <div>
          <h1 className="text-lg font-semibold">{forced ? "Choose your own password" : "Change password"}</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            {forced ? "You signed in with a temporary password from your hospital admin. Set a new one to continue." : `Signed in as ${user.email}.`}
          </p>
        </div>
        {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{error}</p>}
        <input type="hidden" name="next" value={next ?? "/admin"} />
        <label className="block text-[13px]">
          New password
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className="mt-1 w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-2 text-[14px]" />
        </label>
        <label className="block text-[13px]">
          Confirm new password
          <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className="mt-1 w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-2 text-[14px]" />
        </label>
        <button type="submit" className="btn-gradient w-full rounded-lg px-4 py-2 text-[14px] font-semibold text-white">Save password</button>
      </form>
    </main>
  );
}
