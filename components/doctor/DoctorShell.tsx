"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CalendarDays, LayoutDashboard, LogOut, MessageSquareText, Repeat2, UserCheck, KeyRound } from "lucide-react";

const NAV = [
  { href: "/doctor", icon: LayoutDashboard, label: "Today" },
  { href: "/doctor/patients", icon: UserCheck, label: "My patients" },
  { href: "/doctor/appointments", icon: CalendarDays, label: "Appointments" },
  { href: "/doctor/referrals", icon: Repeat2, label: "Referrals" },
  { href: "/doctor/assistant", icon: MessageSquareText, label: "Agent assistant" },
];

export function DoctorShell({ doctorName, specialty, email, children }: { doctorName: string; specialty: string | null; email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => (n.href === "/doctor" ? pathname === "/doctor" : pathname.startsWith(n.href)));

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-base)] font-body text-[var(--color-text-primary)]">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] md:flex">
        <div className="px-5 py-6">
          <Link href="/doctor" className="flex items-center gap-3">
            <Image src="/images/voxera-logo.png" alt="" width={34} height={34} />
            <span className="text-[20px] font-semibold tracking-tight">VOXERA</span>
          </Link>
          <p className="mt-4 text-[13px] font-semibold">{doctorName}</p>
          <p className="text-[12px] text-[var(--color-text-muted)]">{specialty ?? "Doctor"}</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item === active ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium ${item === active ? "bg-[var(--color-bg-elevated)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]/60"}`}>
              <item.icon className="size-4" /> {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-[var(--color-border-subtle)] p-4">
          <p className="truncate text-[12px] text-[var(--color-text-secondary)]">{email}</p>
          <Link href="/account/password?next=/doctor" className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><KeyRound className="size-3.5" /> Change password</Link>
          <form action="/api/auth/logout" method="POST" className="mt-2">
            <button type="submit" className="flex items-center gap-2 text-[13px] font-semibold text-red-400 hover:text-red-300"><LogOut className="size-4" /> Sign out</button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] px-3 py-2 md:hidden" aria-label="Doctor navigation">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] ${item === active ? "bg-[var(--color-bg-elevated)] font-semibold" : "text-[var(--color-text-secondary)]"}`}>{item.label}</Link>
          ))}
        </nav>
        <main className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
