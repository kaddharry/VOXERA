"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { GlassCard } from "../../_components/GlassCard";
import { Dialog } from "../../../components/admin/Dialog";
import { ALL_ROLES, ROLE_LABELS, type HospitalRole } from "../../../lib/auth/permissions";

interface Member {
  userId: string;
  email: string;
  role: HospitalRole;
  isOwner: boolean;
  providerId: string | null;
  providerName: string | null;
}
interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
  status: string;
}

const ROLE_HELP: Record<HospitalRole, string> = {
  hospital_admin: "Everything, including team logins and approving doctor requests.",
  care_coordinator: "Patients, appointments, alerts and call history. No settings or agent changes.",
  auditor: "Read-only view of patients, appointments, alerts and calls.",
  clinician: "Their own dashboard only: their patients, calendar, referrals and medication adherence.",
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [preset, setPreset] = useState<{ providerId?: string; name?: string } | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([fetch("/api/admin/team"), fetch("/api/admin/providers")]);
    const team = await t.json();
    if (!t.ok) {
      setError(team.error ?? "Could not load the team.");
      setMembers([]);
      return;
    }
    setMembers(team.members ?? []);
    setDoctors(((await p.json()).providers ?? []) as Doctor[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doctorsWithoutLogin = doctors.filter((d) => d.status === "active" && !(members ?? []).some((m) => m.providerId === d.id));

  async function resetPassword(m: Member) {
    if (!confirm(`Reset the password for ${m.email}? They'll be signed out of nothing, but must use the new temporary password.`)) return;
    setBusy(m.userId);
    const res = await fetch(`/api/admin/team/${m.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset_password" }) });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not reset the password.");
    setSecret({ email: m.email, password: data.tempPassword });
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.email}'s access? Their account stays, but they can no longer open this hospital.`)) return;
    setBusy(m.userId);
    const res = await fetch(`/api/admin/team/${m.userId}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return setError((await res.json()).error ?? "Could not remove.");
    await load();
  }

  async function changeRole(m: Member, role: HospitalRole) {
    setBusy(m.userId);
    const res = await fetch(`/api/admin/team/${m.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_role", role }) });
    setBusy(null);
    if (!res.ok) setError((await res.json()).error ?? "Could not change the role.");
    await load();
  }

  return (
    <div className="flex h-full flex-col font-body">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="h-4 w-4 flex-none text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold">Team &amp; Logins</span>
          <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">· who can sign in, and what they can see</span>
        </div>
        <button onClick={() => { setPreset(null); setInviteOpen(true); }} className="btn-gradient flex flex-none items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white">
          <UserPlus className="h-3.5 w-3.5" /> Add login
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6 md:px-10">
        {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{error}</p>}

        {doctorsWithoutLogin.length > 0 && (
          <GlassCard className="p-5">
            <h2 className="text-[14px] font-semibold">Doctors without a login</h2>
            <p className="mb-3 text-[12.5px] text-[var(--color-text-muted)]">Give each doctor their own sign-in so they land on their own dashboard.</p>
            <div className="flex flex-wrap gap-2">
              {doctorsWithoutLogin.map((d) => (
                <button key={d.id} onClick={() => { setPreset({ providerId: d.id, name: d.name }); setInviteOpen(true); }} className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[13px] hover:border-[var(--color-border-active)]">
                  <Plus className="h-3.5 w-3.5" /> {d.name}{d.specialty ? <span className="text-[var(--color-text-muted)]"> · {d.specialty}</span> : null}
                </button>
              ))}
            </div>
          </GlassCard>
        )}

        <GlassCard className="overflow-hidden">
          {members === null ? (
            <div className="flex items-center gap-2 p-5 text-[13px] text-[var(--color-text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading team…</div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-[var(--color-border-subtle)] text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                <tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Doctor profile</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="border-b border-[var(--color-border-subtle)] last:border-0">
                    <td className="px-4 py-3">{m.email}{m.isOwner && <span className="ml-2 rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] uppercase">Owner</span>}</td>
                    <td className="px-4 py-3">
                      {m.isOwner || m.role === "clinician" ? (
                        <span>{ROLE_LABELS[m.role]}</span>
                      ) : (
                        <select value={m.role} disabled={busy === m.userId} onChange={(e) => changeRole(m, e.target.value as HospitalRole)} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2 py-1 text-[12.5px]">
                          {ALL_ROLES.filter((r) => r !== "clinician").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{m.providerName ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {!m.isOwner && (
                        <div className="flex justify-end gap-1">
                          <button title="Reset password" disabled={busy === m.userId} onClick={() => resetPassword(m)} className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><RotateCcw className="h-4 w-4" /></button>
                          <button title="Remove access" disabled={busy === m.userId} onClick={() => remove(m)} className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="mb-2 text-[14px] font-semibold">What each role can do</h2>
          <dl className="grid gap-2 text-[12.5px] sm:grid-cols-2">
            {ALL_ROLES.map((r) => (
              <div key={r}><dt className="font-semibold">{ROLE_LABELS[r]}</dt><dd className="text-[var(--color-text-muted)]">{ROLE_HELP[r]}</dd></div>
            ))}
          </dl>
        </GlassCard>
      </div>

      <InviteDialog
        open={inviteOpen}
        preset={preset}
        onClose={() => setInviteOpen(false)}
        onCreated={(email, password) => { setInviteOpen(false); setSecret({ email, password }); void load(); }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

function InviteDialog({ open, preset, onClose, onCreated }: { open: boolean; preset: { providerId?: string; name?: string } | null; onClose: () => void; onCreated: (email: string, password: string | null) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<HospitalRole>("clinician");
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail(""); setError(null); setSpecialty("");
    setRole(preset?.providerId ? "clinician" : "care_coordinator");
    setName(preset?.name ?? "");
  }, [open, preset]);

  async function submit() {
    setSaving(true); setError(null);
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role, providerId: preset?.providerId ?? null, name: role === "clinician" && !preset?.providerId ? name : undefined, specialty: specialty || null }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) return setError(data.error ?? "Could not create the login.");
    onCreated(data.member.email, data.member.tempPassword);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={preset?.name ? `Create a login for ${preset.name}` : "Add a login"}
      subtitle="They'll sign in with this email and a temporary password you hand over"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-[13px] text-[var(--color-text-secondary)]">Cancel</button>
          <button onClick={submit} disabled={saving || !email} className="flex items-center gap-2 rounded-lg bg-[var(--color-accent-violet)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create login
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-[12px]">Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dr.rao@hospital.com" className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px]" />
        </label>
        {!preset?.providerId && (
          <label className="block text-[12px]">Role
            <select value={role} onChange={(e) => setRole(e.target.value as HospitalRole)} className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px]">
              {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <span className="mt-1 block text-[11.5px] text-[var(--color-text-muted)]">{ROLE_HELP[role]}</span>
          </label>
        )}
        {role === "clinician" && !preset?.providerId && (
          <>
            <label className="block text-[12px]">Doctor&apos;s name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Priya Desai" className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px]" />
            </label>
            <label className="block text-[12px]">Specialty (optional)
              <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Cardiologist" className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 text-[13px]" />
            </label>
          </>
        )}
        {error && <p role="alert" className="text-[12.5px] text-red-400">{error}</p>}
      </div>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: { email: string; password: string | null } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={!!secret} onClose={onClose} title="Share these sign-in details" subtitle="This password is shown only once" size="sm" footer={<button onClick={onClose} className="rounded-lg bg-[var(--color-accent-violet)] px-4 py-2 text-[13px] font-semibold text-white">Done</button>}>
      {secret && (
        <div className="space-y-3 text-[13px]">
          <p>Email: <strong>{secret.email}</strong></p>
          {secret.password ? (
            <>
              <p>Temporary password:</p>
              <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-[14px]">
                <span className="flex-1 select-all">{secret.password}</span>
                <button onClick={() => { void navigator.clipboard.writeText(secret.password!); setCopied(true); }} aria-label="Copy password" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[12px] text-[var(--color-text-muted)]">They must choose their own password the first time they sign in. Send it over a private channel.</p>
            </>
          ) : (
            <p className="text-[var(--color-text-secondary)]">This email already had an account, so they keep their existing password.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
