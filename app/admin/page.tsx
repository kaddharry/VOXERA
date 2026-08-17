"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  TrendingUp,
  PhoneCall,
  Clock,
  AlertTriangle,
  Flame,
  Award,
  LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { LiveCallMonitor } from "@/components/admin/LiveCallMonitor";
import { OutboundCallModal } from "@/components/admin/OutboundCallModal";

interface AnalyticsData {
  metrics: {
    totalCalls: number;
    totalToolInvocations: number;
    activeBookings: number;
    cancelledBookings: number;
    escalations: number;
    avgCai: number;
    // Telephony (Sprint 1)
    totalPhoneCalls: number;
    activeCalls: number;
    callQueueLength: number;
    avgCallDurationMs: number;
    // Advanced (Sprint 5)
    conversionRate: number;
    avgSessionDurationMs: number;
    missedBookings: number;
  };
  hourlyHeatmap: number[];
  dailyTrend: Array<{ date: string; count: number }>;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
  };
  emotions: Record<string, number>;
  recentEvents: Array<{
    type: string;
    ts: number;
    sessionId: string;
    payload: Record<string, unknown>;
  }>;
  recentSessions: Array<{
    sessionId: string;
    eventCount: number;
    lastTs: number;
    dominantEmotion: string;
  }>;
}

/** Flat, solid per-metric accent colors — deliberately no gradients on this
 * page, per design direction: a "real" operational dashboard reads flat
 * colors as data, not decoration. */
const ACCENT = {
  cyan: "text-[var(--color-accent-cyan)]",
  violet: "text-[var(--color-accent-violet)]",
  amber: "text-amber-600",
  emerald: "text-emerald-600",
  red: "text-red-500",
  neutral: "text-[var(--color-text-primary)]",
} as const;

const ACCENT_BG = {
  cyan: "bg-[var(--color-accent-cyan)]",
  violet: "bg-[var(--color-accent-violet)]",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
} as const;

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((res) => res.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return (
    <div className="p-8 md:p-10 font-body">
      <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
        <h2 className="font-bold mb-2">Failed to load analytics</h2>
        <p className="text-[14px] opacity-90">{error}</p>
        <p className="mt-4 text-[13px] opacity-70">Tip: Make sure the SQL migration has been run in your Supabase SQL Editor.</p>
      </div>
    </div>
  );

  if (!data) return <div className="p-8 md:p-10 font-body text-[var(--color-text-muted)] animate-pulse">Loading analytics…</div>;

  // Defensive loading
  const m = data?.metrics ?? {
    totalCalls: 0,
    totalToolInvocations: 0,
    activeBookings: 0,
    cancelledBookings: 0,
    escalations: 0,
    avgCai: 0,
    totalPhoneCalls: 0,
    activeCalls: 0,
    callQueueLength: 0,
    avgCallDurationMs: 0,
    conversionRate: 0,
    avgSessionDurationMs: 0,
    missedBookings: 0
  };

  const emotions = data.emotions ?? {};
  const recentEvents = data.recentEvents ?? [];
  const recentSessions = data.recentSessions ?? [];
  const hourlyHeatmap = data.hourlyHeatmap ?? new Array(24).fill(0);
  const dailyTrend = data.dailyTrend ?? [];
  const confDist = data.confidenceDistribution ?? { high: 0, medium: 0, low: 0 };

  const maxHourVal = Math.max(...hourlyHeatmap, 1);
  const maxTrendVal = Math.max(...(dailyTrend.map((t) => t.count) || []), 1);
  const totalHourlyEvents = hourlyHeatmap.reduce((s, c) => s + c, 0);

  // Format session duration (seconds -> MM:SS)
  const formatDuration = (ms: number) => {
    const totalSecs = Math.round(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m ${secs}s`;
  };

  // Circular progress calculations for conversion rate
  const circumference = 2 * Math.PI * 34; // r=34 -> ~213.6
  const strokeDashoffset = circumference - (circumference * m.conversionRate) / 100;

  return (
    <div className="min-h-screen p-6 md:p-10 font-body">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)] flex items-center gap-3">
            <LayoutDashboard className="w-8 h-8 text-[var(--color-accent-cyan)]" />
            Dashboard
          </h1>
          <p className="text-[15px] text-[var(--color-text-secondary)] mt-2 max-w-xl">
            Real-time analytics and operational monitoring across all your agents.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <OutboundCallModal />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[11px] font-mono text-[var(--color-text-secondary)] shrink-0 w-fit">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            SYSTEM LIVE
          </div>
        </div>
      </header>

      {/* Real-time SSE Live Call & Emotion Stream Monitor — kept in its own
          dark instrument-panel treatment (the one deliberate exception on
          this otherwise flat, light page): a live signal feed reads more
          honestly as a monitoring surface than as a content card. */}
      <div className="mb-8">
        <LiveCallMonitor />
      </div>

      {/* Setup Checklist (For new users) */}
      {m.totalCalls === 0 && (
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-[var(--color-accent-violet)]" />
          <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">Welcome to your workspace</h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mb-8">Complete these steps to deploy your AI agent.</p>
          <div className="grid sm:grid-cols-3 gap-6">
            <ChecklistItem title="Create Business Profile" desc="Completed during onboarding" done={true} />
            <ChecklistItem title="Upload Knowledge" desc="Add FAQs and policies" done={false} href="/admin/knowledge" />
            <ChecklistItem title="Configure Phone Routing" desc="Connect Twilio number" done={false} href="/admin/settings" />
          </div>
        </div>
      )}

      {/* Core KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <KpiCard label="Total Sessions" value={m.totalCalls} accent="cyan" />
        <KpiCard label="Tool Calls" value={m.totalToolInvocations} accent="violet" />
        <KpiCard label="Escalations" value={m.escalations} accent="amber" />
        <KpiCard label="Active Bookings" value={m.activeBookings} accent="emerald" />
        <KpiCard label="Cancelled" value={m.cancelledBookings} accent="red" />
        <KpiCard label="Avg CAI (All Time)" value={m.avgCai} accent="neutral" suffix="/100" />
      </div>

      {/* Telephony KPI Cards & Advanced Metrics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

        {/* Sprint 1: Live Telephony Cards */}
        <div className="lg:col-span-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6">
          <div className="flex items-center gap-2.5 mb-6">
            <PhoneCall className="w-4 h-4 text-[var(--color-accent-cyan)]" />
            <h2 className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Live Telephony</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCardMinimal label="Phone Calls" value={m.totalPhoneCalls ?? 0} accent="cyan" />
            <KpiCardMinimal label="Active Calls" value={m.activeCalls ?? 0} accent="emerald" live />
            <KpiCardMinimal label="Queue Length" value={m.callQueueLength ?? 0} accent="amber" live />
            <KpiCardMinimal
              label="Avg Duration"
              value={m.avgCallDurationMs ? Math.round((m.avgCallDurationMs ?? 0) / 1000) : 0}
              accent="violet"
              suffix="s"
            />
          </div>
        </div>

        {/* Sprint 5: Call Duration, Missed Bookings */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 flex flex-col justify-between">
          <div className="flex items-center gap-2.5 mb-4">
            <Clock className="w-4 h-4 text-[var(--color-accent-violet)]" />
            <h2 className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Session Performance</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-4">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Avg Session</span>
              <span className="text-[16px] font-extrabold text-[var(--color-text-primary)]">{formatDuration(m.avgSessionDurationMs)}</span>
            </div>
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-4">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Missed Bookings</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-[16px] font-extrabold ${m.missedBookings > 0 ? "text-amber-600" : "text-emerald-600"}`}>{m.missedBookings}</span>
                {m.missedBookings > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Charts Panel: Heatmap, Trends, Conversion, Confidence */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">

        {/* Left: Trend line & Heatmap */}
        <div className="xl:col-span-2 space-y-6">

          {/* Heatmap Hour tracker */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-1">
              <Flame className="w-4 h-4 text-amber-600" />
              <h3 className="text-[14px] font-bold text-[var(--color-text-primary)]">Peak Hours Heatmap</h3>
            </div>
            <p className="text-[12.5px] text-[var(--color-text-secondary)] mb-6">Call session arrivals across 24 hours of the day.</p>
            {totalHourlyEvents === 0 ? (
              <EmptyChartState label="No sessions recorded yet — this fills in as calls come through." />
            ) : (
              <>
                <div className="flex items-end gap-1 sm:gap-1.5 h-24 pt-4 border-b border-[var(--color-border-subtle)]">
                  {hourlyHeatmap.map((count, hour) => {
                    const heightPct = count === 0 ? 3 : Math.max(Math.round((count / maxHourVal) * 100), 6);
                    return (
                      <div key={hour} className="flex-1 flex flex-col justify-end group relative h-full" title={`${count} calls at ${hour}:00`}>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block bg-[var(--color-text-primary)] text-[10px] font-mono text-white rounded px-1.5 py-0.5 z-10 whitespace-nowrap">
                          {count} {count === 1 ? "call" : "calls"}
                        </div>
                        <div
                          className={`w-full rounded-t transition-all duration-200 ${count === 0 ? "bg-[var(--color-border-subtle)]" : "bg-[var(--color-accent-cyan)] group-hover:brightness-90"}`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[9.5px] font-mono text-[var(--color-text-muted)] pt-2">
                  <span>12 AM</span>
                  <span>6 AM</span>
                  <span>12 PM</span>
                  <span>6 PM</span>
                  <span>11 PM</span>
                </div>
              </>
            )}
          </div>

          {/* Daily Trend line */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <TrendingUp className="w-4 h-4 text-[var(--color-accent-cyan)]" />
              <h3 className="text-[14px] font-bold text-[var(--color-text-primary)]">Daily Call Trends</h3>
            </div>
            {dailyTrend.length === 0 ? (
              <EmptyChartState label="No trend data yet — check back after a few days of calls." />
            ) : (
              <div className="flex items-end justify-between gap-3 h-36 pt-4 border-b border-[var(--color-border-subtle)]">
                {dailyTrend.map((t) => {
                  const heightPct = Math.max(Math.round((t.count / maxTrendVal) * 100), 5);
                  return (
                    <div key={t.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                      <div className="absolute bottom-full mb-1.5 hidden group-hover:block bg-[var(--color-text-primary)] text-[10px] font-mono text-white rounded px-1.5 py-0.5 z-10 whitespace-nowrap">
                        {t.count} {t.count === 1 ? "session" : "sessions"}
                      </div>
                      <div className="w-full max-w-[36px] bg-[var(--color-accent-violet)] rounded-t-md transition-all duration-200 group-hover:brightness-90" style={{ height: `${heightPct}%` }} />
                      <span className="text-[9.5px] font-mono text-[var(--color-text-muted)] mt-2 uppercase tracking-tight whitespace-nowrap">{t.date}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Right: Conversion Circle & Confidence Segments */}
        <div className="space-y-6">

          {/* Conversion rate card */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 flex items-center justify-between">
            <div className="max-w-[60%]">
              <h3 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-2">Booking Conversion</h3>
              <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed">Percentage of customer calls resulting in a reservation.</p>
            </div>

            <div className="relative flex items-center justify-center shrink-0">
              <svg className="w-20 h-20 -rotate-90">
                <circle cx="40" cy="40" r="34" className="stroke-[var(--color-bg-surface)]" fill="transparent" strokeWidth="6" />
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  className="stroke-emerald-500 transition-all duration-1000"
                  fill="transparent"
                  strokeWidth="6"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute text-sm font-mono font-extrabold text-emerald-600">{m.conversionRate}%</span>
            </div>
          </div>

          {/* Confidence distribution card */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-1">
              <Award className="w-4 h-4 text-emerald-600" />
              <h3 className="text-[14px] font-bold text-[var(--color-text-primary)]">SER Confidence Breakdown</h3>
            </div>
            <p className="text-[12.5px] text-[var(--color-text-secondary)] mb-6">Accuracy categories for Speech Emotion Recognition classifications.</p>

            {/* Segmented bar */}
            <div className="w-full bg-[var(--color-border-subtle)] rounded-full h-3 flex overflow-hidden mb-6">
              <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${confDist.high}%` }} title={`High Confidence: ${confDist.high}%`} />
              <div className="bg-amber-500 transition-all duration-500" style={{ width: `${confDist.medium}%` }} title={`Medium Confidence: ${confDist.medium}%`} />
              <div className="bg-red-500 transition-all duration-500" style={{ width: `${confDist.low}%` }} title={`Low Confidence: ${confDist.low}%`} />
            </div>

            {/* Labels grid */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg">
                <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">High</span>
                <span className="font-mono font-extrabold text-emerald-600">{confDist.high}%</span>
              </div>
              <div className="p-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg">
                <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Medium</span>
                <span className="font-mono font-extrabold text-amber-600">{confDist.medium}%</span>
              </div>
              <div className="p-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg">
                <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Low</span>
                <span className="font-mono font-extrabold text-red-500">{confDist.low}%</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Emotion Distribution */}
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6">
          <h2 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-5">Emotion Distribution</h2>
          <div className="space-y-4">
            {Object.entries(emotions).length > 0 ? (
              Object.entries(emotions)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([emotion, count]) => {
                  const total = Object.values(emotions).reduce((s, c) => s + (c as number), 0);
                  const pct = total > 0 ? Math.round(((count as number) / total) * 100) : 0;
                  return (
                    <div key={emotion}>
                      <div className="flex justify-between text-[13px] mb-2 font-medium">
                        <span className="capitalize text-[var(--color-text-primary)]">{emotion}</span>
                        <span className="text-[var(--color-text-secondary)]">{String(count)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-[var(--color-bg-surface)] rounded-full h-2 overflow-hidden">
                        <div className="bg-[var(--color-accent-violet)] h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
            ) : (
              <p className="text-[var(--color-text-muted)] text-[13px]">No emotion data yet.</p>
            )}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6">
          <h2 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-5">Recent Sessions</h2>
          <div className="space-y-2.5">
            {recentSessions.length > 0 ? (
              recentSessions.map((s) => (
                <Link href="/admin/sessions" key={s.sessionId} className="block p-3.5 bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)] transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-mono text-[11.5px] text-[var(--color-text-primary)] truncate max-w-[140px]">{s.sessionId}</span>
                    <span className="text-[10.5px] text-[var(--color-text-muted)]">{new Date(s.lastTs).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2 text-[10px] font-bold uppercase tracking-wide">
                    <span className="px-2 py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-accent-cyan)] rounded-md">{s.eventCount} events</span>
                    <span className="px-2 py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-accent-violet)] rounded-md capitalize">{s.dominantEmotion}</span>
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-[var(--color-text-muted)] text-[13px]">No sessions recorded yet.</p>
            )}
          </div>
        </div>

        {/* Event Timeline */}
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6">
          <h2 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-5">Recent Events</h2>
          <div className="overflow-y-auto h-[400px] pr-2 space-y-2.5 hide-scrollbar">
            {recentEvents.length > 0 ? (
              recentEvents.map((ev, i) => <EventRow key={i} event={ev} />)
            ) : (
              <p className="text-[var(--color-text-muted)] text-[13px]">No recent events.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type Accent = keyof typeof ACCENT;

function KpiCard({ label, value, accent, suffix }: { label: string; value: number; accent: Accent; suffix?: string }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6 hover:border-[var(--color-border-active)] transition-colors">
      <h3 className="text-[10.5px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-3">{label}</h3>
      <p className={`font-display text-4xl font-extrabold ${ACCENT[accent]}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span className="text-[15px] font-medium text-[var(--color-text-muted)] ml-1">{suffix}</span>}
      </p>
    </div>
  );
}

function KpiCardMinimal({ label, value, accent, suffix, live }: { label: string; value: number; accent: Accent; suffix?: string; live?: boolean }) {
  return (
    <div className="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-subtle)] p-4 relative overflow-hidden">
      {live && (
        <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      )}
      <h3 className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">{label}</h3>
      <p className={`text-2xl font-extrabold ${ACCENT[accent]}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span className="text-[12px] font-medium text-[var(--color-text-muted)] ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="h-24 flex items-center justify-center rounded-xl bg-[var(--color-bg-surface)] border border-dashed border-[var(--color-border-subtle)]">
      <p className="text-[12.5px] text-[var(--color-text-muted)] text-center px-6">{label}</p>
    </div>
  );
}

function ChecklistItem({ title, desc, done, href }: { title: string, desc: string, done: boolean, href?: string }) {
  return (
    <div className={`p-5 rounded-xl border ${done ? "bg-[var(--color-bg-base)] border-[var(--color-border-subtle)]" : "bg-[var(--color-bg-surface)] border-[var(--color-accent-violet)]/40"}`}>
      <div className="flex items-start gap-3">
        {done ? <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5" /> : <Circle className="w-5 h-5 text-[var(--color-accent-cyan)] mt-0.5" />}
        <div>
          <h4 className={`text-[14px] font-semibold ${done ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-primary)]"}`}>{title}</h4>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-1">{desc}</p>
          {!done && href && (
            <Link href={href} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--color-accent-cyan)] mt-3 hover:text-[var(--color-accent-violet)] transition-colors">
              Start <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const EVENT_META: Record<string, { badgeBg: string; badgeText: string; label: string; short: string }> = {
  utterance: { badgeBg: "bg-[var(--color-accent-cyan)]/10", badgeText: "text-[var(--color-accent-cyan)]", label: "Utterance", short: "UT" },
  emotion: { badgeBg: "bg-[var(--color-accent-violet)]/10", badgeText: "text-[var(--color-accent-violet)]", label: "Emotion", short: "EM" },
  memory_write: { badgeBg: "bg-emerald-500/10", badgeText: "text-emerald-600", label: "Memory Write", short: "MW" },
  retrieval: { badgeBg: "bg-amber-500/10", badgeText: "text-amber-600", label: "Retrieval", short: "RT" },
  policy: { badgeBg: "bg-orange-500/10", badgeText: "text-orange-600", label: "Policy", short: "PL" },
  escalation: { badgeBg: "bg-red-500/10", badgeText: "text-red-600", label: "Escalation", short: "ES" },
  cai: { badgeBg: "bg-[var(--color-accent-cyan)]/10", badgeText: "text-[var(--color-accent-cyan)]", label: "CAI Score", short: "CI" },
  tool_invocation: { badgeBg: "bg-teal-500/10", badgeText: "text-teal-600", label: "Tool Call", short: "TC" },
  guard: { badgeBg: "bg-[var(--color-bg-surface)]", badgeText: "text-[var(--color-text-secondary)]", label: "Guard", short: "GD" },
  llm_reply: { badgeBg: "bg-[var(--color-accent-violet)]/10", badgeText: "text-[var(--color-accent-violet)]", label: "LLM Reply", short: "LR" },
  calendar_sync: { badgeBg: "bg-emerald-500/10", badgeText: "text-emerald-600", label: "Calendar Sync", short: "CS" },
  email_dispatch: { badgeBg: "bg-blue-500/10", badgeText: "text-blue-600", label: "Email Sent", short: "EM" },
};

function eventMeta(type: string) {
  return EVENT_META[type] ?? { badgeBg: "bg-[var(--color-bg-surface)]", badgeText: "text-[var(--color-text-secondary)]", label: type.replace(/_/g, " "), short: type.slice(0, 2).toUpperCase() };
}

/** Human-readable one-line summary for the most common event types — raw
 * JSON is a debug view, not an analytics one. Falls back to compact JSON
 * for anything without a dedicated summary. */
function eventSummary(ev: { type: string; payload: Record<string, unknown> }): string {
  const p = ev.payload as any;
  switch (ev.type) {
    case "utterance":
      return p?.text ? `"${String(p.text).slice(0, 90)}"` : "—";
    case "emotion":
      return `${p?.label ?? "neutral"} · ${p?.confidence !== undefined ? `${Math.round(p.confidence * 100)}% confidence` : ""}`;
    case "llm_reply":
      return `${p?.model ?? "unknown model"}${p?.usedLive === false ? " · fallback" : ""}${p?.replyLength ? ` · ${p.replyLength} chars` : ""}`;
    case "tool_invocation":
      return `${p?.tool ?? "unknown tool"} · ${p?.success === false ? "failed" : "succeeded"}`;
    case "retrieval":
      return `${(p?.mtmIds?.length ?? 0) + (p?.ltmUserIds?.length ?? 0) + (p?.ltmClientIds?.length ?? 0)} memories retrieved`;
    case "escalation":
      return p?.reason ? String(p.reason).slice(0, 90) : "Escalation triggered";
    case "memory_write":
      return `${p?.tier ?? "STM"} · ${p?.merged ? "merged" : "new record"}`;
    case "calendar_sync":
      return p?.status === "synced" ? "Synced to calendar" : `Status: ${p?.status ?? "unknown"}`;
    case "cai":
      return `Score: ${p?.score ?? "—"}/100`;
    default:
      return JSON.stringify(p).slice(0, 100);
  }
}

function EventRow({ event }: { event: { type: string; ts: number; payload: Record<string, unknown> } }) {
  const meta = eventMeta(event.type);
  return (
    <div className="flex gap-3 p-3.5 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]">
      <div className="flex-none">
        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full text-[10px] font-bold ${meta.badgeBg} ${meta.badgeText}`}>
          {meta.short}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-[12.5px] text-[var(--color-text-primary)]">{meta.label}</span>
          <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{new Date(event.ts).toLocaleTimeString()}</span>
        </div>
        <p className="text-[11.5px] text-[var(--color-text-secondary)] truncate">{eventSummary(event)}</p>
      </div>
    </div>
  );
}
