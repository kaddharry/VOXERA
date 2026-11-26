import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";
import { AdminShell } from "../../components/admin/AdminShell";
import { isPlatformAdmin } from "../../lib/auth/roles";
import { getAccess } from "../../lib/auth/access";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  // If there's no authenticated user, redirect to login
  if (!user || error) {
    redirect("/login");
  }

  // Tenants (platform-wide billing/subscription data) and RAG Debugger
  // (internal retrieval diagnostics) are platform/developer tools, not
  // hospital-facing features — spec calls for them hidden from normal
  // hospital nav. Both routes already enforce this server-side themselves;
  // this just stops a non-admin from seeing the link at all.
  const platformAdmin = isPlatformAdmin(user.email);

  // Doctors have their own portal; they never see the admin shell. A user with no hospital yet (fresh signup
  // before onboarding) keeps the pre-existing behaviour and is treated as an admin of their (empty) account.
  const access = await getAccess().catch(() => null);
  if (access?.role === "clinician") redirect("/doctor");

  return (
    <div className="voxera-admin-dark">
      <AdminShell userEmail={user.email ?? ""} isPlatformAdmin={platformAdmin} role={access?.role ?? "hospital_admin"}>
        {children}
      </AdminShell>
    </div>
  );
}
