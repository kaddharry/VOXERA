import { signup } from "./actions";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";
import SignupAuthSection from "../_components/auth/SignupAuthSection";

export default async function SignupPage(props: {
  searchParams: Promise<{ error?: string; demoRequestId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const demoRequestId = searchParams?.demoRequestId;

  // Already signed in — go straight to the dashboard instead of showing
  // the signup form again. A visitor arriving here mid Book-a-Demo flow
  // (already has an account) instead continues straight to the confirm
  // step (spec §5.5: "users who bypass Book a Demo should land in the same
  // setup wizard... do not force them through the demo flow" — symmetric
  // case here is someone already signed in landing ON a demo link).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    redirect(demoRequestId ? `/book-demo/confirm?id=${encodeURIComponent(demoRequestId)}` : "/admin");
  }

  return (
    <SignupAuthSection action={signup} demoRequestId={demoRequestId} error={searchParams?.error} />
  );
}
