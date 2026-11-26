"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";
import { getAccess } from "../../lib/auth/access";
import { homeForRole } from "../../lib/auth/permissions";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const demoRequestId = formData.get("demoRequestId") as string | null;

  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const { data: signedIn, error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    const suffix = demoRequestId ? `&demoRequestId=${encodeURIComponent(demoRequestId)}` : "";
    redirect(`/login?error=${encodeURIComponent(error.message)}${suffix}`);
  }

  revalidatePath("/", "layout");
  if (demoRequestId) redirect(`/book-demo/confirm?id=${encodeURIComponent(demoRequestId)}`);

  // Doctors land on their own portal; admins/coordinators/auditors on the admin dashboard. A login
  // created by an admin starts with a temporary password that must be replaced first.
  const access = await getAccess().catch(() => null);
  const home = homeForRole(access?.role);
  if (signedIn?.user?.user_metadata?.must_change_password) {
    redirect(`/account/password?next=${encodeURIComponent(home)}`);
  }
  redirect(home);
}
