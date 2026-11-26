import { redirect } from "next/navigation";
import { getAccess } from "../../lib/auth/access";
import { getProviderById } from "../../lib/db/providers";
import { DoctorShell } from "../../components/doctor/DoctorShell";

export const dynamic = "force-dynamic";

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess().catch(() => null);
  if (!access) redirect("/login");
  // Admins, coordinators and auditors have their own dashboard.
  if (access.role !== "clinician") redirect("/admin");

  const provider = access.providerId ? await getProviderById(access.db, access.providerId) : null;
  if (!provider) {
    return (
      <main className="voxera-admin-dark flex min-h-screen items-center justify-center bg-[var(--color-bg-base)] p-6 text-[var(--color-text-primary)]">
        <div role="alert" className="max-w-md rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-8 text-center">
          <h1 className="text-[16px] font-semibold">Your login isn&apos;t linked to a doctor profile yet</h1>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">Ask your hospital admin to link {access.email ?? "this login"} to your doctor profile in Team &amp; Logins.</p>
          <form action="/api/auth/logout" method="POST" className="mt-4"><button className="text-[13px] font-semibold text-red-400">Sign out</button></form>
        </div>
      </main>
    );
  }

  return (
    <div className="voxera-admin-dark">
      <DoctorShell doctorName={provider.name} specialty={provider.specialty} email={access.email ?? ""}>
        {children}
      </DoctorShell>
    </div>
  );
}
