"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  Settings,
  LogOut,
  Sparkles,
  Users,
  Radio,
  PhoneCall,
  Bot,
  UserCheck,
  Bell,
  Search,
  MessageSquare,
} from "lucide-react";
import { AdminMobileNav } from "./AdminMobileNav";

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

export function AdminShell({
  userEmail,
  isPlatformAdmin,
  children,
}: {
  userEmail: string;
  isPlatformAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const navItems = useMemo(
    () => (isPlatformAdmin ? [...BASE_NAV_ITEMS, ...PLATFORM_ADMIN_NAV_ITEMS] : BASE_NAV_ITEMS),
    [isPlatformAdmin]
  );

  const activeItem =
    [...navItems].sort((a, b) => b.href.length - a.href.length).find((item) =>
      item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href)
    ) ?? navItems[0];

  return (
    <div className="h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] font-body flex overflow-hidden">
      <aside className="hidden w-[272px] shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--sidebar,var(--color-bg-surface))] md:block">
        <div className="flex h-full flex-col">
          <div className="px-5 py-7">
            <Link href="/" className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-active)]">
              <Image src="/images/voxera-logo.png" alt="" width={38} height={38} className="flex-none" />
              <span className="font-body text-[24px] font-semibold leading-none tracking-tight text-[var(--color-text-primary)]">
                VOXERA
              </span>
            </Link>
          </div>

          <nav className="flex-1 space-y-1 px-3">
            {navItems.map((item) => {
              const isActive = item === activeItem;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-active)] ${
                    isActive
                      ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]/60 hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  <item.icon className="size-4 flex-none" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[var(--color-border-subtle)] p-3">
            <div className="rounded-lg px-3 py-2.5">
              <p className="mb-2 truncate text-[12px] text-[var(--color-text-secondary)]">{userEmail}</p>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 text-left text-[13px] font-semibold text-red-400 transition-colors hover:text-red-300"
                >
                  <LogOut className="size-4" />
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AdminMobileNav userEmail={userEmail} isPlatformAdmin={isPlatformAdmin} />
        <AdminHeader activeLabel={activeItem.label} navItems={navItems} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function AdminHeader({
  activeLabel,
  navItems,
}: {
  activeLabel: string;
  navItems: Array<{ href: string; label: string }>;
}) {
  const [alertCount, setAlertCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d: { alerts?: unknown[] }) => setAlertCount(d.alerts?.length ?? 0))
      .catch(() => setAlertCount(0));
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const matches = navItems.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <header className="hidden h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] px-6 md:flex">
      <nav className="flex items-center gap-1.5 text-[13.5px] text-[var(--color-text-muted)]">
        <span>Dashboard</span>
        <span>/</span>
        <span className="font-medium text-[var(--color-text-primary)]">{activeLabel}</span>
      </nav>

      <div className="flex items-center gap-3">
        <div ref={searchRef} className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search..."
            className="w-48 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] py-1.5 pl-8 pr-3 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-active)] focus:outline-none"
          />
          {searchOpen && query.trim() && (
            <div className="absolute right-0 top-full z-20 mt-1.5 w-56 overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] shadow-lg">
              {matches.length === 0 ? (
                <p className="px-3 py-2 text-[12.5px] text-[var(--color-text-muted)]">No matches</p>
              ) : (
                matches.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSearchOpen(false)}
                    className="block px-3 py-2 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
                  >
                    {item.label}
                  </Link>
                ))
              )}
            </div>
          )}
        </div>

        <Link
          href="/admin/alerts"
          className="relative flex size-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <Bell className="size-4" />
          {!!alertCount && alertCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {alertCount > 9 ? "9+" : alertCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
