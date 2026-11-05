"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";
import { AddProviderDialog } from "../../../components/admin/calendar/AddProviderDialog";
import { StaffPatientPanel } from "../../../components/admin/calendar/StaffPatientPanel";
import type { Provider } from "../../../components/admin/calendar/types";

export default function StaffPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);

  useEffect(() => {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((data) => setProviders(data.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Staff</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">· doctors on the calendar, and who they're seeing</span>
        </div>
        <button
          onClick={() => setShowAddProvider(true)}
          className="flex flex-none items-center gap-1.5 rounded-lg btn-gradient px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all hover:scale-[1.02]"
        >
          <Plus className="w-3.5 h-3.5" /> Add doctor
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:px-10">
        {providers === null && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] px-2 py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading staff…
          </div>
        )}
        {providers !== null && providers.length === 0 && (
          <GlassCard className="p-10 text-center">
            <Users className="w-8 h-8 mx-auto mb-3 text-[var(--color-text-muted)]" />
            <p className="text-[15px] text-[var(--color-text-muted)] mb-4">No doctors added yet.</p>
            <button
              onClick={() => setShowAddProvider(true)}
              className="inline-flex items-center gap-1.5 rounded-lg btn-gradient px-4 py-2 text-[13px] font-semibold text-white transition-all hover:scale-[1.02]"
            >
              <Plus className="w-3.5 h-3.5" /> Add your first doctor
            </button>
          </GlassCard>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers?.map((p) => (
            <button key={p.id} onClick={() => setActiveProvider(p)} className="text-left">
              <GlassCard className="p-5 flex items-center gap-3 hover:scale-[1.01] transition-transform">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-[15px] font-bold text-black" style={{ backgroundColor: p.color }}>
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{p.name}</p>
                  <p className="truncate text-[12px] text-[var(--color-text-muted)]">{p.specialty ?? "General"}</p>
                  {p.status === "inactive" && <p className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--risk-medium)] mt-0.5">Inactive</p>}
                </div>
              </GlassCard>
            </button>
          ))}
        </div>
      </div>

      <AddProviderDialog
        open={showAddProvider}
        onClose={() => setShowAddProvider(false)}
        onCreated={(p) => setProviders((prev) => [...(prev ?? []), p])}
      />

      <StaffPatientPanel provider={activeProvider} onClose={() => setActiveProvider(null)} />
    </div>
  );
}
