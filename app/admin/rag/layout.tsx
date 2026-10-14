import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { isPlatformAdmin } from "@/lib/auth/roles";

// The RAG Debugger page itself is a client component (interactive retrieval
// explorer) with no way to gate server-side on its own — this wrapping
// layout is the actual enforcement, matching the server-side redirect
// already on /admin/tenants, so hiding the nav link isn't the only thing
// stopping a non-admin hospital user from reaching it directly by URL.
export default async function RagLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isPlatformAdmin(user?.email)) {
    redirect("/admin");
  }
  return <>{children}</>;
}
