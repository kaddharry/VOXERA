"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  LayoutDashboard,
  Database,
  Settings,
  LogOut,
  Sparkles,
  Users,
  PhoneCall,
  Bot,
  Menu,
  X,
  UserCheck,
  Radio,
  MessageSquare,
} from "lucide-react";

// Bulk Calls is reachable from Hospital Setup rather than being a top-level
// destination — mirrors components/admin/AdminShell.tsx's desktop sidebar.
const BASE_NAV_ITEMS = [
  { href: "/admin", icon: LayoutDashboard, label: "Overview" },
  { href: "/admin/patients", icon: UserCheck, label: "Patients" },
  { href: "/admin/live_dashboard", icon: Radio, label: "Live Calls" },
  { href: "/admin/sessions", icon: MessageSquare, label: "Calls & Insights" },
  { href: "/admin/agents", icon: Bot, label: "Agent Builder" },
  { href: "/admin/knowledge", icon: Database, label: "Hospital Information & Policies" },
  { href: "/admin/try-call", icon: PhoneCall, label: "Test Agent" },
  { href: "/admin/settings", icon: Settings, label: "Team & Settings" },
];

const PLATFORM_ADMIN_NAV_ITEMS = [
  { href: "/admin/tenants", icon: Users, label: "Tenants" },
  { href: "/admin/rag", icon: Sparkles, label: "RAG Debugger" },
];

export function AdminMobileNav({ userEmail, isPlatformAdmin = false }: { userEmail: string; isPlatformAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const navItems = isPlatformAdmin ? [...BASE_NAV_ITEMS, ...PLATFORM_ADMIN_NAV_ITEMS] : BASE_NAV_ITEMS;

  return (
    <div className="md:hidden border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <div className="flex items-center justify-between p-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/images/voxera-logo.png" alt="" width={26} height={26} className="flex-none" />
          <span className="font-body text-[18px] font-semibold leading-none tracking-tight text-[var(--color-text-primary)]">VOXERA</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="p-2 rounded-lg text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <nav className="px-4 pb-4 space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-transparent text-[14px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-subtle)] transition-all"
            >
              <Icon className="w-4 h-4 text-[var(--color-text-muted)] flex-none" />
              {label}
            </Link>
          ))}
          <div className="pt-3 mt-2 border-t border-[var(--color-border-subtle)]">
            <p className="text-[12px] text-[var(--color-text-secondary)] truncate mb-2 px-3">{userEmail}</p>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-[13px] text-red-400 hover:text-red-300 font-semibold transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </form>
          </div>
        </nav>
      )}
    </div>
  );
}
