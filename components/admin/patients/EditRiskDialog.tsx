"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "../Dialog";
import { RISK_LEVELS, type RiskLevel } from "../../../lib/db/patients";
import { RiskBadge } from "./RiskBadge";

export function EditRiskDialog({
  patient,
  onClose,
  onSaved,
}: {
  patient: { id: string; name: string; condition: string | null; riskLevel: RiskLevel } | null;
  onClose: () => void;
  onSaved: (patient: { id: string; condition: string | null; riskLevel: RiskLevel }) => void;
}) {
  const [condition, setCondition] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form fields whenever a different patient is opened — the
  // dialog instance is shared across rows, so its own state would
  // otherwise leak the previous patient's edits into the next one.
  useEffect(() => {
    if (!patient) return;
    setCondition(patient.condition ?? "");
    setRiskLevel(patient.riskLevel);
    setError(null);
  }, [patient]);

  async function save() {
    if (!patient) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/patients/${patient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition: condition.trim() || null, riskLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      onSaved({ id: patient.id, condition: data.patient.condition, riskLevel: data.patient.riskLevel });
      onClose();
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!patient}
      onClose={onClose}
      title={`Edit ${patient?.name ?? "patient"}`}
      subtitle="Condition & risk level"
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent-violet)] text-white text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 transition-all"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
            Condition
          </label>
          <input
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder="e.g. Post-Op Recovery, Type 2 Diabetes"
            className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
          />
        </div>
        <div>
          <label className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5 block">
            Risk level
          </label>
          <div className="flex flex-wrap gap-2">
            {RISK_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setRiskLevel(level)}
                className={`rounded-lg transition-all ${riskLevel === level ? "ring-2 ring-[var(--color-accent-violet)]" : "opacity-60 hover:opacity-100"}`}
              >
                <RiskBadge level={level} className="px-2.5 py-1" />
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-[12px] text-red-400">{error}</p>}
      </div>
    </Dialog>
  );
}
