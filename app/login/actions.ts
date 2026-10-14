"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const demoRequestId = formData.get("demoRequestId") as string | null;

  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    const suffix = demoRequestId ? `&demoRequestId=${encodeURIComponent(demoRequestId)}` : "";
    redirect(`/login?error=${encodeURIComponent(error.message)}${suffix}`);
  }

  revalidatePath("/", "layout");
  redirect(demoRequestId ? `/book-demo/confirm?id=${encodeURIComponent(demoRequestId)}` : "/admin");
}
