import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";
import Link from "next/link";
import { LayoutDashboard, MessageSquare, Database, Settings, LogOut, Sparkles, Users, PhoneCall, Bot, Megaphone } from "lucide-react";
import { AdminMobileNav } from "../../components/admin/AdminMobileNav";
import { AmbientBackground } from "../_components/GlassCard";
import { CursorGlow } from "../_components/CursorGlow";

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

  return (
    <div className="voxera-admin-dark min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] font-body flex">
      {/* Sidebar Navigation */}
      <aside className="w-[280px] bg-[var(--color-bg-surface)]/80 backdrop-blur-xl border-r border-[var(--color-border-subtle)] hidden md:block">
        <div className="h-full flex flex-col">
          <div className="px-6 py-8">
            <Link href="/" className="font-display font-extrabold text-2xl tracking-tighter bg-gradient-to-r from-[var(--console-orange)] to-[var(--console-violet)] bg-clip-text text-transparent">
              VOXERA
            </Link>
            <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">Admin</span>
          </div>

          <nav className="flex-1 px-4 space-y-1.5">
            <NavItem href="/admin" icon={LayoutDashboard} label="Dashboard" />
            <NavItem href="/admin/agents" icon={Bot} label="Agent Builder" />
            <NavItem href="/admin/try-call" icon={PhoneCall} label="Try a Call" />
            <NavItem href="/admin/campaigns" icon={Megaphone} label="Bulk Calls" />
            <NavItem href="/admin/tenants" icon={Users} label="Tenants" />
            <NavItem href="/admin/sessions" icon={MessageSquare} label="Sessions" />
            <NavItem href="/admin/knowledge" icon={Database} label="Knowledge Base" />
            <NavItem href="/admin/rag" icon={Sparkles} label="RAG Debugger" />
            <NavItem href="/admin/settings" icon={Settings} label="Settings" />
          </nav>

          <div className="p-4 border-t border-[var(--color-border-subtle)]">
            <div className="px-3 py-3 rounded-xl bg-white/[0.04] border border-[var(--color-border-subtle)]">
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
          <AdminMobileNav userEmail={user.email ?? ""} />
          {children}
        </div>
      </main>
    </div>
  );
}

function NavItem({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  // In a real app we'd use usePathname to highlight active state, 
  // but for server components we can use client-side active link logic or pass it down.
  // For simplicity here, we'll give them a clean hover state.
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/[0.06] transition-all"
    >
      <Icon className="w-4 h-4 text-[var(--color-text-muted)] group-hover:text-[var(--console-orange)] transition-colors" />
      {label}
    </Link>
  );
}
