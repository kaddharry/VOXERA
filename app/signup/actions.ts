"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const demoRequestId = formData.get("demoRequestId") as string | null;

  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const { data: signUpData, error } = await supabase.auth.signUp(data);

  if (error) {
    const suffix = demoRequestId ? `&demoRequestId=${encodeURIComponent(demoRequestId)}` : "";
    redirect(`/signup?error=${encodeURIComponent(error.message)}${suffix}`);
  }

  if (signUpData.session) {
    revalidatePath("/", "layout");
    // Book-a-Demo flow (spec §5.3 step 4): continue to the confirm/consent
    // step instead of the ordinary onboarding wizard.
    redirect(demoRequestId ? `/book-demo/confirm?id=${encodeURIComponent(demoRequestId)}` : "/onboarding");
  }

  redirect(
    "/login?message=" +
      encodeURIComponent("Check your email to confirm your account, then sign in.") +
      (demoRequestId ? `&demoRequestId=${encodeURIComponent(demoRequestId)}` : "")
  );
}
