import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";
import Link from "next/link";
import Image from "next/image";
import { LayoutDashboard, Database, Settings, LogOut, Sparkles, Users, Radio, PhoneCall, Bot, UserCheck } from "lucide-react";
import { AdminMobileNav } from "../../components/admin/AdminMobileNav";
import { AmbientBackground } from "../_components/GlassCard";
import { CursorGlow } from "../_components/CursorGlow";
import { isPlatformAdmin } from "../../lib/auth/roles";

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

  return (
    <div className="voxera-admin-dark min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] font-body flex">
      {/* Sidebar Navigation */}
      <aside className="w-[280px] bg-[var(--color-bg-surface)]/80 backdrop-blur-xl border-r border-[var(--color-border-subtle)] hidden md:block">
        <div className="h-full flex flex-col">
          <div className="px-6 py-8">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/images/voxera-logo.png" alt="" width={34} height={34} className="flex-none" />
              <span className="font-display text-[28px] leading-none tracking-tight text-gradient">VOXERA</span>
            </Link>
            <span className="mt-1.5 inline-block font-mono text-[11px] uppercase tracking-widest text-[var(--color-text-muted)]">Admin</span>
          </div>

          <nav className="flex-1 px-4 space-y-2">
            {/* Follow-up Schedule and Calls & Insights were merged into
                Overview (cross-patient analytics + patient search + the
                Alerts banner now live there); Bulk Calls is reachable from
                Hospital Setup rather than being a top-level destination. */}
            <NavItem href="/admin" icon={LayoutDashboard} label="Overview" />
            <NavItem href="/admin/patients" icon={UserCheck} label="Patients" />
            <NavItem href="/admin/live_dashboard" icon={Radio} label="Live Calls" />
            <NavItem href="/admin/agents" icon={Bot} label="Hospital Setup" />
            <NavItem href="/admin/knowledge" icon={Database} label="Hospital Information & Policies" />
            <NavItem href="/admin/try-call" icon={PhoneCall} label="Test Agent" />
            {platformAdmin && <NavItem href="/admin/tenants" icon={Users} label="Tenants" />}
            {platformAdmin && <NavItem href="/admin/rag" icon={Sparkles} label="RAG Debugger" />}
            <NavItem href="/admin/settings" icon={Settings} label="Team & Settings" />
          </nav>

          <div className="p-4 border-t border-[var(--color-border-subtle)]">
            <div className="px-3 py-3 rounded-xl bg-[var(--vx-indigo,#4F46E5)]/[0.06] border border-[var(--color-border-subtle)]">
              <p className="text-[12px] text-[var(--color-text-secondary)] truncate mb-3">{user.email}</p>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="flex items-center gap-2 w-full text-left text-[13px] text-red-400 hover:text-red-300 font-semibold transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content — ambient glass-morphism background + cursor glow are
          rendered once here rather than per-page, so every admin page gets
          the same consistent surface treatment automatically. */}
      <main className="flex-1 overflow-y-auto relative">
        <AmbientBackground />
        <CursorGlow />
        <div className="relative z-10">
          <AdminMobileNav userEmail={user.email ?? ""} isPlatformAdmin={platformAdmin} />
          {children}
        </div>
      </main>
    </div>
  );
}

function NavItem({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  // In a real app we'd use usePathname to highlight active state,
  // but for server components we can use client-side active link logic or pass it down.
  // Each item is its own bordered "box" now rather than a bare row, with a
  // hover lift + border/background shift so the sidebar reads as a set of
  // discrete controls instead of a plain link list.
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-transparent text-[14px] font-medium text-[var(--color-text-secondary)] bg-white/0 hover:text-[var(--color-text-primary)] hover:bg-white hover:border-[var(--color-border-subtle)] hover:shadow-[0_2px_10px_rgba(79,70,229,0.08)] hover:-translate-y-px transition-all"
    >
      <Icon className="w-4 h-4 text-[var(--color-text-muted)] group-hover:text-[var(--vx-indigo,#4F46E5)] transition-colors flex-none" />
      {label}
    </Link>
  );
}
