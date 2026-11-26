"use server";

import { redirect } from "next/navigation";
import { createClient } from "../../../lib/db/server";

/** Replaces the temporary password an admin handed out (or any password) and clears the first-login flag. */
export async function changePassword(formData: FormData) {
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const next = String(formData.get("next") ?? "/admin");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";

  const back = (message: string) => redirect(`/account/password?error=${encodeURIComponent(message)}&next=${encodeURIComponent(safeNext)}`);
  if (password.length < 10) back("Use at least 10 characters.");
  if (password !== confirm) back("The two passwords don't match.");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
  if (error) back(error.message);
  redirect(safeNext);
}
