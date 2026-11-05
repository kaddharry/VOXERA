"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "../Dialog";
import type { Provider } from "./types";

// The admin theme's own tokens (app/globals.css), not invented hex —
// matches lib/db/providers.ts's PROVIDER_COLOR_PALETTE exactly.
const SWATCHES = [
  "var(--color-accent-violet)",
  "var(--risk-high)",
  "var(--chart-2)",
  "var(--risk-low)",
  "var(--color-accent-cyan)",
  "var(--risk-medium)",
  "var(--chart-1)",
  "var(--risk-critical)",
];

export function AddProviderDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (provider: Provider) => void }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSpecialty("");
    setColor(SWATCHES[0]);
    setSlotMinutes(30);
    setError(null);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Give the doctor a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), specialty: specialty.trim() || null, color, defaultSlotMinutes: slotMinutes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add doctor");
      onCreated(data.provider);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add a doctor"
      subtitle="Shows up on the calendar immediately — no login required."
      size="sm"
      footer={
        <>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg btn-gradient text-[13px] font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Add doctor
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-[12.5px] text-[var(--risk-critical)]">{error}</p>}
        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dr. Priya Desai"
            className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
          />
        </div>
        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Specialty</label>
          <input
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder="Cardiologist"
            className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Default slot</label>
            <select
              value={slotMinutes}
              onChange={(e) => setSlotMinutes(Number(e.target.value))}
              className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
            >
              {[15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">Color</label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-6 w-6 rounded-full transition-transform"
                  style={{ backgroundColor: c, outline: color === c ? "2px solid white" : "none", outlineOffset: 2, transform: color === c ? "scale(1.1)" : undefined }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
