"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

/** Fetches JSON from an /api/doctor/* route; re-run with reload(). */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);

  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setData(body as T);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export async function send<T = unknown>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/80 p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "warn" | "bad" }) {
  const color = tone === "bad" ? "var(--risk-critical)" : tone === "warn" ? "var(--risk-medium)" : "var(--color-text-primary)";
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/80 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none" style={{ color }}>{value}</p>
    </div>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "ok" | "warn" | "bad" | "info" }) {
  const map = {
    default: "var(--color-text-muted)",
    ok: "var(--risk-low)",
    warn: "var(--risk-medium)",
    bad: "var(--risk-critical)",
    info: "var(--color-accent-cyan)",
  } as const;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize" style={{ color: map[tone], backgroundColor: `color-mix(in oklab, ${map[tone]} 16%, transparent)` }}>
      {children}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-4 text-[13px] text-[var(--color-text-secondary)]">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{message}</p> : null;
}

export const inputCls =
  "w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-border-active)] focus:outline-none";
export const btnPrimary = "rounded-lg bg-[var(--color-accent-violet)] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40";
export const btnGhost = "rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40";

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (iso == null) return "—";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const days = Math.round((Date.now() - ts) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

export const SEVERITY_TONE = { routine: "default", moderate: "info", serious: "warn", emergency: "bad" } as const;
