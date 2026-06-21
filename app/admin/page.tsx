"use client";

import { useEffect, useState } from "react";
import { 
  CheckCircle2, 
  Circle, 
  ArrowRight, 
  TrendingUp, 
  PhoneCall, 
  Users, 
  Clock, 
  AlertTriangle,
  Flame,
  Award
} from "lucide-react";
import Link from "next/link";

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
      <div className="bg-red-950/30 border border-red-900/50 text-red-400 p-6 rounded-2xl">
        <h2 className="font-bold mb-2">Failed to load analytics</h2>
        <p className="text-[14px]">{error}</p>
        <p className="mt-4 text-[13px] text-red-500/70">Tip: Make sure the SQL migration has been run in your Supabase SQL Editor.</p>
      </div>
    </div>
  );

  if (!data) return <div className="p-8 md:p-10 font-body text-[var(--color-text-muted)] animate-pulse">Loading Analytics...</div>;

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
    <div className="min-h-screen p-6 md:p-10 font-body text-[var(--color-text-primary)]">
      <header className="mb-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-gradient">VOXERA Dashboard</h1>
          <p className="text-[var(--color-text-secondary)] mt-2 text-[15px]">Real-time Analytics & Operational Monitoring</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[11px] font-mono text-[var(--color-accent-cyan)] shrink-0 w-fit">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          SYSTEM LIVE
        </div>
      </header>

      {/* Setup Checklist (For new users) */}
      {m.totalCalls === 0 && (
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl shadow-[0_4px_30px_rgba(0,0,0,0.5)] border border-[var(--color-border-active)] p-6 md:p-8 mb-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[var(--color-accent-violet)] to-[var(--color-accent-cyan)]" />
          <h2 className="text-xl font-bold mb-2">Welcome to your workspace</h2>
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
        <KpiCard label="Total Sessions" value={m.totalCalls} color="text-[var(--color-accent-cyan)]" />
        <KpiCard label="Tool Calls" value={m.totalToolInvocations} color="text-[var(--color-accent-violet)]" />
        <KpiCard label="Escalations" value={m.escalations} color="text-amber-400" />
        <KpiCard label="Active Bookings" value={m.activeBookings} color="text-emerald-400" />
        <KpiCard label="Cancelled" value={m.cancelledBookings} color="text-red-400" />
        <KpiCard label="Avg CAI" value={m.avgCai} color="text-[var(--color-text-primary)]" suffix="/100" />
      </div>

      {/* Telephony KPI Cards & Advanced Metrics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
        
        {/* Sprint 1: Live Telephony Cards */}
        <div className="lg:col-span-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <PhoneCall className="w-4 h-4 text-[var(--color-accent-cyan)]" />
            <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Live Telephony</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCardMinimal label="Phone Calls" value={m.totalPhoneCalls ?? 0} color="text-[var(--color-accent-cyan)]" />
            <KpiCardMinimal label="Active Calls" value={m.activeCalls ?? 0} color="text-emerald-400" live />
            <KpiCardMinimal label="Queue Length" value={m.callQueueLength ?? 0} color="text-amber-400" live />
            <KpiCardMinimal 
              label="Avg Duration" 
              value={m.avgCallDurationMs ? Math.round((m.avgCallDurationMs ?? 0) / 1000) : 0} 
              color="text-[var(--color-accent-violet)]" 
              suffix="s" 
            />
          </div>
        </div>

        {/* Sprint 5: Call Duration, Missed Bookings */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--color-accent-violet)]" />
              <h2 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Session Performance</h2>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-4">
              <span className="text-[10px] font-mono font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Avg Session</span>
              <span className="text-[15px] font-extrabold text-white">{formatDuration(m.avgSessionDurationMs)}</span>
            </div>
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-4 relative overflow-hidden">
              <span className="text-[10px] font-mono font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1">Missed Bookings</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-[16px] font-extrabold ${m.missedBookings > 0 ? "text-amber-400" : "text-emerald-400"}`}>{m.missedBookings}</span>
                {m.missedBookings > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 animate-pulse" />}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Charts Panel: Heatmap, Trends, Conversion, Confidence */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 mb-10">
        
        {/* Left: Trend line & Heatmap */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* Heatmap Hour tracker */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <Flame className="w-4 h-4 text-amber-500" />
              <h3 className="text-[14px] font-bold text-white">Peak Hours Heatmap</h3>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mb-6">Visual representation of call session arrivals across 24 hours of the day.</p>
            <div className="flex items-end gap-1 sm:gap-2 h-24 pt-4 border-b border-[var(--color-border-subtle)]">
              {hourlyHeatmap.map((count, hour) => {
                const heightPct = Math.max(Math.round((count / maxHourVal) * 100), 4);
                // Heatmap color shade based on volume
                const bgClass = count === 0 
                  ? "bg-gray-800/40" 
                  : count / maxHourVal > 0.6 
                    ? "bg-gradient-to-t from-[var(--color-accent-cyan)] to-emerald-400"
                    : "bg-[var(--color-accent-cyan)]/60";

                return (
                  <div key={hour} className="flex-1 flex flex-col justify-end group relative h-full" title={`${count} calls at ${hour}:00`}>
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1.5 hidden group-hover:block bg-black border border-[var(--color-border-subtle)] text-[10px] font-mono text-white rounded px-1.5 py-0.5 z-10 whitespace-nowrap">
                      {count} calls
                    </div>
                    <div className={`w-full rounded-t ${bgClass} transition-all duration-300 hover:brightness-125`} style={{ height: `${heightPct}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] font-mono text-[var(--color-text-muted)] pt-2">
              <span>12 AM</span>
              <span>6 AM</span>
              <span>12 PM</span>
              <span>6 PM</span>
              <span>11 PM</span>
            </div>
          </div>

          {/* Daily Trend line */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-[var(--color-accent-cyan)]" />
              <h3 className="text-[14px] font-bold text-white">Daily Call Trends</h3>
            </div>
            {dailyTrend.length === 0 ? (
              <p className="text-[var(--color-text-muted)] text-[13px] italic h-36 flex items-center justify-center">No trend data available.</p>
            ) : (
              <div className="flex items-end justify-between gap-3 h-36 pt-4 border-b border-[var(--color-border-subtle)]">
                {dailyTrend.map((t) => {
                  const heightPct = Math.max(Math.round((t.count / maxTrendVal) * 100), 5);
                  return (
                    <div key={t.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                      <div className="absolute bottom-full mb-1.5 hidden group-hover:block bg-black border border-[var(--color-border-subtle)] text-[10px] font-mono text-white rounded px-1.5 py-0.5 z-10 whitespace-nowrap">
                        {t.count} sessions
                      </div>
                      <div className="w-full max-w-[36px] bg-gradient-to-t from-[var(--color-accent-violet)] to-[var(--color-accent-cyan)] rounded-t-md transition-all duration-300 hover:brightness-125" style={{ height: `${heightPct}%` }} />
                      <span className="text-[9px] font-mono text-[var(--color-text-muted)] mt-2 uppercase tracking-tight whitespace-nowrap">{t.date}</span>
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
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-md flex items-center justify-between">
            <div className="max-w-[60%]">
              <h3 className="text-[14px] font-bold text-white mb-2">Booking Conversion</h3>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">Percentage of customer calls successfully resulting in reservations.</p>
            </div>
            
            <div className="relative flex items-center justify-center shrink-0">
              <svg className="w-20 h-20 transform -rotate-90">
                <circle cx="40" cy="40" r="34" className="stroke-[var(--color-bg-base)]" fill="transparent" strokeWidth="6" />
                <circle 
                  cx="40" 
                  cy="40" 
                  r="34" 
                  className="stroke-emerald-400 transition-all duration-1000" 
                  fill="transparent" 
                  strokeWidth="6" 
                  strokeDasharray={circumference} 
                  strokeDashoffset={strokeDashoffset} 
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute text-sm font-mono font-extrabold text-emerald-400">{m.conversionRate}%</span>
            </div>
          </div>

          {/* Confidence distribution card */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-emerald-400" />
                <h3 className="text-[14px] font-bold text-white">SER Confidence Breakdown</h3>
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mb-6">Accuracy categories for Speech Emotion Recognition classifications.</p>
            
            {/* Segmented bar */}
            <div className="w-full bg-gray-800 rounded-full h-3 flex overflow-hidden mb-6">
              <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${confDist.high}%` }} title={`High Confidence: ${confDist.high}%`} />
              <div className="bg-amber-500 transition-all duration-500" style={{ width: `${confDist.medium}%` }} title={`Medium Confidence: ${confDist.medium}%`} />
              <div className="bg-red-500 transition-all duration-500" style={{ width: `${confDist.low}%` }} title={`Low Confidence: ${confDist.low}%`} />
            </div>

            {/* Labels grid */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div className="p-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg">
                <span className="block text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">High</span>
                <span className="font-extrabold text-emerald-400">{confDist.high}%</span>
              </div>
              <div className="p-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg">
                <span className="block text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">Medium</span>
                <span className="font-extrabold text-amber-400">{confDist.medium}%</span>
              </div>
              <div className="p-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg">
                <span className="block text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">Low</span>
                <span className="font-extrabold text-red-400">{confDist.low}%</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Emotion Distribution */}
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6 lg:p-8">
          <h2 className="text-lg font-bold mb-6">Emotion Distribution</h2>
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
                        <span className="capitalize">{emotion}</span>
                        <span className="text-[var(--color-text-secondary)]">{String(count)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-[var(--color-bg-base)] rounded-full h-2 overflow-hidden">
                        <div className="bg-gradient-to-r from-[var(--color-accent-violet)] to-[var(--color-accent-cyan)] h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
            ) : (
              <p className="text-[var(--color-text-muted)] text-[13px] italic">No emotion data yet.</p>
            )}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6 lg:p-8">
          <h2 className="text-lg font-bold mb-6">Recent Sessions</h2>
          <div className="space-y-3">
            {recentSessions.length > 0 ? (
              recentSessions.map((s) => (
                <Link href="/admin/sessions" key={s.sessionId} className="block p-4 bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)] transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-mono text-[12px] truncate max-w-[140px]">{s.sessionId}</span>
                    <span className="text-[11px] text-[var(--color-text-muted)]">{new Date(s.lastTs).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2 text-[10px] font-mono uppercase tracking-widest font-bold">
                    <span className="px-2 py-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[var(--color-accent-cyan)] rounded-md">{s.eventCount} events</span>
                    <span className="px-2 py-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[var(--color-accent-violet)] rounded-md capitalize">{s.dominantEmotion}</span>
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-[var(--color-text-muted)] text-[13px] italic">No sessions recorded yet.</p>
            )}
          </div>
        </div>

        {/* Event Timeline */}
        <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6 lg:p-8">
          <h2 className="text-lg font-bold mb-6">Recent Events</h2>
          <div className="overflow-y-auto h-[400px] pr-2 space-y-3 hide-scrollbar">
            {recentEvents.length > 0 ? (
              recentEvents.map((ev, i) => (
                <div key={i} className="flex gap-3 p-4 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]">
                  <div className="flex-none">
                    <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full text-[10px] font-bold ${eventColor(ev.type)}`}>
                      {ev.type.substring(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-semibold capitalize text-[13px]">{ev.type.replace(/_/g, " ")}</span>
                      <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{new Date(ev.ts).toLocaleTimeString()}</span>
                    </div>
                    <pre className="text-[11px] text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono break-all bg-[var(--color-bg-base)] p-2.5 rounded-lg border border-[var(--color-border-subtle)] max-h-24 overflow-hidden">
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[var(--color-text-muted)] text-[13px] italic">No recent events.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color, suffix, live }: { label: string; value: number; color: string; suffix?: string; live?: boolean }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-2xl border border-[var(--color-border-subtle)] p-6 transition-all hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,0,0,0.5)] relative overflow-hidden">
      {live && (
        <span className="absolute top-3 right-3 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-widest">Live</span>
        </span>
      )}
      <h3 className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-3">{label}</h3>
      <p className={`font-display text-4xl font-extrabold ${color}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span className="text-[16px] font-medium text-[var(--color-text-muted)] ml-1">{suffix}</span>}
      </p>
    </div>
  );
}

function KpiCardMinimal({ label, value, color, suffix, live }: { label: string; value: number; color: string; suffix?: string; live?: boolean }) {
  return (
    <div className="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-subtle)] p-4 relative overflow-hidden">
      {live && (
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      )}
      <h3 className="text-[9px] font-mono font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">{label}</h3>
      <p className={`text-2xl font-extrabold ${color}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span className="text-[12px] font-medium text-[var(--color-text-muted)] ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
}

function ChecklistItem({ title, desc, done, href }: { title: string, desc: string, done: boolean, href?: string }) {
  return (
    <div className={`p-5 rounded-xl border ${done ? "bg-[var(--color-bg-base)] border-[var(--color-border-subtle)]" : "bg-[var(--color-bg-surface)] border-[var(--color-border-active)] shadow-[0_0_15px_var(--color-accent-glow)]"}`}>
      <div className="flex items-start gap-3">
        {done ? <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5" /> : <Circle className="w-5 h-5 text-[var(--color-accent-cyan)] mt-0.5" />}
        <div>
          <h4 className={`text-[14px] font-semibold ${done ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-primary)]"}`}>{title}</h4>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-1">{desc}</p>
          {!done && href && (
            <Link href={href} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--color-accent-cyan)] mt-3 hover:text-white transition-colors">
              Start <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function eventColor(type: string): string {
  switch (type) {
    case "utterance": return "bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]";
    case "emotion": return "bg-[var(--color-accent-violet)]/10 text-[var(--color-accent-violet)]";
    case "memory_write": return "bg-emerald-500/10 text-emerald-400";
    case "retrieval": return "bg-amber-500/10 text-amber-400";
    case "policy": return "bg-orange-500/10 text-orange-400";
    case "escalation": return "bg-red-500/10 text-red-400";
    case "cai": return "bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]";
    case "tool_invocation": return "bg-teal-500/10 text-teal-400";
    case "guard": return "bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]";
    case "llm_reply": return "bg-[var(--color-accent-violet)]/10 text-[var(--color-accent-violet)]";
    case "calendar_sync": return "bg-emerald-500/10 text-emerald-400";
    case "email_dispatch": return "bg-blue-500/10 text-blue-400";
    default: return "bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]";
  }
}
