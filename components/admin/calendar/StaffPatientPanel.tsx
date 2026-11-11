"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Phone, X } from "lucide-react";
import type { PatientLite, Provider } from "./types";

/**
 * Slide-over patient panel for the Staff directory — a genuinely new UI
 * pattern for Voxera (the house convention, per app/admin/patients/[id]/
 * page.tsx, is a dedicated full page with tabs, not a slide-over). That's
 * deliberate here, matching the reference dashboard's floating-panel feel,
 * not an accident — see the plan doc. Reimplements Dialog.tsx's Escape/
 * backdrop-close behavior rather than importing Dialog itself, since a
 * slide-over's layout (fixed to the right edge, no centering) doesn't fit
 * Dialog's bottom-sheet/centered-card modes.
 */
export function StaffPatientPanel({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const [patients, setPatients] = useState<PatientLite[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!provider) return;
    setPatients(null);
    fetch(`/api/admin/providers/${provider.id}/patients?status=${showAll ? "all" : "upcoming"}`)
      .then((r) => r.json())
      .then((data) => setPatients(data.patients ?? []))
      .catch(() => setPatients([]));
  }, [provider, showAll]);

  useEffect(() => {
    if (!provider) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [provider, onClose]);

  return (
    <AnimatePresence>
      {provider && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/60"
            onClick={onClose}
          />
          <motion.div
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed right-0 top-0 z-[151] flex h-full w-full max-w-md flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] shadow-2xl"
          >
            <div className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-[14px] font-bold text-black"
                  style={{ backgroundColor: provider.color }}
                >
                  {provider.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{provider.name}</p>
                  {provider.specialty && <p className="truncate text-[12px] text-[var(--color-text-muted)]">{provider.specialty}</p>}
                </div>
              </div>
              <button onClick={onClose} className="flex-none p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-none gap-1.5 px-5 pt-3">
              <button
                onClick={() => setShowAll(false)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${!showAll ? "bg-[var(--color-accent-violet)] text-white" : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]"}`}
              >
                Upcoming
              </button>
              <button
                onClick={() => setShowAll(true)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${showAll ? "bg-[var(--color-accent-violet)] text-white" : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]"}`}
              >
                All patients
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 flex flex-col gap-2">
              {patients === null && (
                <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] px-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              )}
              {patients !== null && patients.length === 0 && (
                <p className="text-[13px] text-[var(--color-text-muted)] px-2 py-4">
                  {showAll ? "No patients yet for this doctor." : "No upcoming appointments for this doctor."}
                </p>
              )}
              {patients?.map((p) => (
                <Link
                  key={p.id}
                  href={`/admin/patients/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2.5 hover:border-[var(--color-border-active)] transition-colors"
                >
                  <span className="text-[13.5px] font-medium text-[var(--color-text-primary)]">{p.name}</span>
                  <span className="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
                    <Phone className="w-3 h-3" /> {p.phone}
                  </span>
                </Link>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
