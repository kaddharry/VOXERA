"use client";

import { useCallback, useEffect, useState } from "react";
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
  ShieldCheck,
  Smile,
  Target,
  Bot,
  Zap,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { LiveCallMonitor } from "@/components/admin/LiveCallMonitor";
import { OutboundCallModal } from "@/components/admin/OutboundCallModal";
import { VoiceOrb } from "@/app/_components/VoiceOrb";
import { GlassCard } from "@/app/_components/GlassCard";

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

/** Flat, solid per-metric accent colors — no gradients on data itself; the
 * "premium" feel comes from the glass card surfaces and ambient background
 * wash instead, not from painting the numbers with gradients. */
const ACCENT = {
  cyan: "text-[var(--color-accent-cyan)]",
  violet: "text-[var(--color-accent-violet)]",
  amber: "text-amber-400",
  emerald: "text-emerald-400",
  red: "text-red-400",
  neutral: "text-[var(--color-text-primary)]",
} as const;

const POSITIVE_EMOTIONS = new Set(["joy", "gratitude", "excitement", "calm"]);

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveLevel, setLiveLevel] = useState(0);
  const [liveActive, setLiveActive] = useState(false);

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

  const handleLiveUpdate = useCallback((info: { active: boolean; intensity: number; caiScore: number }) => {
    setLiveActive(info.active);
    // Blend intensity and engagement into a single 0-1 orb level — both are
    // real signals from the live SSE stream, never a fabricated value.
    setLiveLevel(Math.min(1, info.intensity * 0.6 + (info.caiScore / 100) * 0.4));
  }, []);

  if (error) return (
    <div className="p-8 md:p-10 font-body">
      <div className="bg-red-500/10 border border-red-500/25 text-red-400 p-6 rounded-2xl">
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

  // ── Business-impact metrics — derived entirely from real analytics data,
  // reframed around the question an owner actually opens this page to
  // answer: "is this AI agent worth what I'm paying for it?" ──────────────
  const autonomousResolutionRate = m.totalCalls > 0
    ? Math.max(0, Math.round(100 - (m.escalations / m.totalCalls) * 100))
    : 100;
  const emotionTotal = Object.values(emotions).reduce((s, c) => s + c, 0);
  const positiveEmotionCount = Object.entries(emotions).reduce(
    (s, [label, count]) => s + (POSITIVE_EMOTIONS.has(label) ? count : 0), 0
  );
  const positiveSentimentRate = emotionTotal > 0 ? Math.round((positiveEmotionCount / emotionTotal) * 100) : 0;

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
    <div className="min-h-screen">
      {/* Ambient background wash + cursor glow are now rendered once at the
          admin layout level (app/admin/layout.tsx) so every page gets the
          same glass surface treatment consistently. */}
      <div className="p-6 md:p-10 font-body">
        <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)] flex items-center gap-3">
              <LayoutDashboard className="w-8 h-8 text-[var(--color-accent-cyan)]" />
              Dashboard
            </h1>
            <p className="text-[15px] text-[var(--color-text-secondary)] mt-2 max-w-xl">
              {timeOfDayGreeting()} — here's how your AI agent is performing.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <OutboundCallModal />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.06] backdrop-blur-md border border-[var(--color-border-subtle)] text-[11px] font-mono text-[var(--color-text-secondary)] shrink-0 w-fit">
              <span className={`w-2 h-2 rounded-full ${liveActive ? "bg-emerald-500 animate-pulse" : "bg-[var(--color-text-muted)]"}`} />
              {liveActive ? "LIVE CALL IN PROGRESS" : "SYSTEM LIVE"}
            </div>
            <VoiceOrb level={liveLevel} idle={!liveActive} size={48} coreSize={22}>
              <Bot className="w-3.5 h-3.5 text-white" />
            </VoiceOrb>
          </div>
        </header>

        {/* Hero — business-impact headline card + at-a-glance live metrics,
            the first thing an owner should see when they open this page. */}
        <div className="mb-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <HeroPanel
            conversionRate={m.conversionRate}
            autonomousResolutionRate={autonomousResolutionRate}
            positiveSentimentRate={emotionTotal > 0 ? positiveSentimentRate : null}
            avgHandleTime={formatDuration(m.avgSessionDurationMs)}
          />
          <div className="space-y-6">
            <LiveVolumeCard hourlyHeatmap={hourlyHeatmap} maxHourVal={maxHourVal} />
            <CaiSummaryCard avgCai={m.avgCai} activeCalls={m.activeCalls ?? 0} />
          </div>
        </div>

        {/* Real-time SSE Live Call & Emotion Stream Monitor */}
        <div className="mb-8">
          <LiveCallMonitor onLiveUpdate={handleLiveUpdate} />
        </div>

        {/* Setup Checklist (For new users) */}
        {m.totalCalls === 0 && (
          <div className="bg-white/[0.05] backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.35)] p-6 md:p-8 mb-8 relative overflow-hidden">
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
          <GlassCard className="lg:col-span-2 p-6">
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
          </GlassCard>

          {/* Sprint 5: Call Duration, Missed Bookings */}
          <GlassCard className="p-6 flex flex-col justify-between">
            <div className="flex items-center gap-2.5 mb-4">
              <Clock className="w-4 h-4 text-[var(--color-accent-violet)]" />
              <h2 className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Session Performance</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-xl p-4">
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Avg Session</span>
                <span className="font-mono text-[16px] font-extrabold text-[var(--color-text-primary)] tabular-nums">{formatDuration(m.avgSessionDurationMs)}</span>
              </div>
              <div className="bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-xl p-4">
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Missed Bookings</span>
                <div className="flex items-center gap-1.5">
                  <span className={`font-mono text-[16px] font-extrabold tabular-nums ${m.missedBookings > 0 ? "text-amber-400" : "text-emerald-400"}`}>{m.missedBookings}</span>
                  {m.missedBookings > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                </div>
              </div>
            </div>
          </GlassCard>

        </div>

        {/* Charts Panel: Heatmap, Trends, Conversion, Confidence */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">

          {/* Left: Trend line & Heatmap */}
          <div className="xl:col-span-2 space-y-6">

            {/* Heatmap Hour tracker */}
            <GlassCard className="p-6">
              <div className="flex items-center gap-2.5 mb-1">
                <Flame className="w-4 h-4 text-amber-400" />
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
            </GlassCard>

            {/* Daily Trend line */}
            <GlassCard className="p-6">
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
            </GlassCard>

          </div>

          {/* Right: Conversion Circle & Confidence Segments */}
          <div className="space-y-6">

            {/* Conversion rate card */}
            <GlassCard className="p-6 flex items-center justify-between">
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
                    className="stroke-emerald-400 transition-all duration-1000"
                    fill="transparent"
                    strokeWidth="6"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute font-mono text-sm font-extrabold text-emerald-400 tabular-nums">{m.conversionRate}%</span>
              </div>
            </GlassCard>

            {/* Confidence distribution card */}
            <GlassCard className="p-6">
              <div className="flex items-center gap-2.5 mb-1">
                <Award className="w-4 h-4 text-emerald-400" />
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
                <div className="p-2.5 bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-lg">
                  <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">High</span>
                  <span className="font-mono font-extrabold text-emerald-400 tabular-nums">{confDist.high}%</span>
                </div>
                <div className="p-2.5 bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-lg">
                  <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Medium</span>
                  <span className="font-mono font-extrabold text-amber-400 tabular-nums">{confDist.medium}%</span>
                </div>
                <div className="p-2.5 bg-white/[0.04] border border-[var(--color-border-subtle)] rounded-lg">
                  <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Low</span>
                  <span className="font-mono font-extrabold text-red-400 tabular-nums">{confDist.low}%</span>
                </div>
              </div>
            </GlassCard>

          </div>

        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Emotion Distribution */}
          <GlassCard className="p-6">
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
                          <span className="font-mono text-[var(--color-text-secondary)] tabular-nums">{String(count)} ({pct}%)</span>
                        </div>
                        <div className="w-full bg-white/[0.08] rounded-full h-2 overflow-hidden">
                          <div className="bg-[var(--color-accent-violet)] h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
              ) : (
                <p className="text-[var(--color-text-muted)] text-[13px]">No emotion data yet.</p>
              )}
            </div>
          </GlassCard>

          {/* Recent Sessions */}
          <GlassCard className="p-6">
            <h2 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-5">Recent Sessions</h2>
            <div className="space-y-2.5">
              {recentSessions.length > 0 ? (
                recentSessions.map((s) => (
                  <Link href="/admin/sessions" key={s.sessionId} className="block p-3.5 bg-white/[0.04] rounded-xl border border-[var(--color-border-subtle)] hover:border-[var(--color-border-active)] transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-[11.5px] text-[var(--color-text-primary)] truncate max-w-[140px]">{s.sessionId}</span>
                      <span className="text-[10.5px] text-[var(--color-text-muted)]">{new Date(s.lastTs).toLocaleString()}</span>
                    </div>
                    <div className="flex gap-2 text-[10px] font-bold uppercase tracking-wide">
                      <span className="px-2 py-1 bg-white/[0.06] border border-[var(--color-border-subtle)] text-[var(--color-accent-cyan)] rounded-md">{s.eventCount} events</span>
                      <span className="px-2 py-1 bg-white/[0.06] border border-[var(--color-border-subtle)] text-[var(--color-accent-violet)] rounded-md capitalize">{s.dominantEmotion}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="text-[var(--color-text-muted)] text-[13px]">No sessions recorded yet.</p>
              )}
            </div>
          </GlassCard>

          {/* Event Timeline */}
          <GlassCard className="p-6">
            <h2 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-5">Recent Events</h2>
            <div className="overflow-y-auto h-[400px] pr-2 space-y-2.5 hide-scrollbar">
              {recentEvents.length > 0 ? (
                recentEvents.map((ev, i) => <EventRow key={i} event={ev} />)
              ) : (
                <p className="text-[var(--color-text-muted)] text-[13px]">No recent events.</p>
              )}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

type Accent = keyof typeof ACCENT;

/** The dashboard's headline card — a warm orange/violet gradient panel
 * (matching the sidebar wordmark and .voxera-console dark instrument-panel
 * accent) that opens on the single business question an owner actually
 * cares about, then backs it with the four real conversion/handling metrics
 * as an underlined stat-pill row. All four numbers come straight from
 * /api/analytics — nothing here is decorative or fabricated. */
function HeroPanel({
  conversionRate,
  autonomousResolutionRate,
  positiveSentimentRate,
  avgHandleTime,
}: {
  conversionRate: number;
  autonomousResolutionRate: number;
  positiveSentimentRate: number | null;
  avgHandleTime: string;
}) {
  const pills: Array<{ icon: React.ComponentType<{ className?: string }>; value: string; label: string; underline: string }> = [
    { icon: Target, value: `${conversionRate}%`, label: "Conversion", underline: "bg-emerald-400" },
    { icon: ShieldCheck, value: `${autonomousResolutionRate}%`, label: "Resolved", underline: "bg-[var(--console-cyan)]" },
    { icon: Smile, value: positiveSentimentRate !== null ? `${positiveSentimentRate}%` : "—", label: "Sentiment", underline: "bg-[var(--console-violet)]" },
    { icon: Clock, value: avgHandleTime, label: "Avg Handle", underline: "bg-[var(--console-orange)]" },
  ];

  return (
    <div className="lg:col-span-2 relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] min-h-[360px] flex flex-col justify-between p-8">
      {/* Gradient backdrop + abstract voice-wave rings, standing in for a
          hero photo — an audio waveform motif is the honest visual for a
          voice-agent product, not a stock image of an unrelated person. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 700px 500px at 85% 0%, var(--console-orange-deep) 0%, transparent 60%), " +
            "radial-gradient(ellipse 600px 500px at 100% 100%, var(--console-violet) 0%, transparent 55%), " +
            "var(--console-surface-raised)",
        }}
      />
      <svg aria-hidden="true" className="absolute -right-10 -top-10 w-72 h-72 opacity-20 -z-10" viewBox="0 0 200 200">
        {[30, 55, 80, 105, 130].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="white" strokeWidth="1" />
        ))}
      </svg>

      <div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-white/70">
          <Radio className="w-3.5 h-3.5" /> AI Voice Agent
        </span>
        <h2 className="font-display text-[34px] sm:text-[42px] font-extrabold leading-[1.05] text-white mt-3 max-w-md">
          Every Call,<br />Understood.
        </h2>
        <Link
          href="/admin/sessions"
          className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-full bg-white text-[var(--console-bg)] text-[13.5px] font-semibold hover:bg-white/90 transition-colors"
        >
          View Sessions <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="mt-8 pt-6 border-t border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-6">
        {pills.map((p) => (
          <div key={p.label}>
            <p className="font-mono text-2xl sm:text-[28px] font-extrabold text-white tabular-nums">{p.value}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <p.icon className="w-3 h-3 text-white/60" />
              <span className="text-[11.5px] text-white/70">{p.label}</span>
            </div>
            <div className={`h-[3px] w-full rounded-full mt-2 ${p.underline}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact SVG line-chart with no external charting library — enough for a
 * 24-point sparkline, and it stays fully token/theme-driven. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 240;
  const h = 64;
  const max = Math.max(...values, 1);
  const step = w / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 8) - 4).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mirrors the "Active Users right now" pattern — a live-feeling sparkline
 * of real call arrivals across the day, with the busiest hour badged. */
function LiveVolumeCard({ hourlyHeatmap, maxHourVal }: { hourlyHeatmap: number[]; maxHourVal: number }) {
  const totalToday = hourlyHeatmap.reduce((s, c) => s + c, 0);
  const peakHour = hourlyHeatmap.indexOf(maxHourVal);
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">Call Volume Today</h3>
        {totalToday > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white text-[var(--console-bg)] text-[10.5px] font-mono font-bold">
            {maxHourVal}
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
        {totalToday > 0 ? `Peak around ${peakHour}:00` : "No calls yet today"}
      </p>
      <Sparkline values={hourlyHeatmap} color="var(--console-orange)" />
    </GlassCard>
  );
}

/** Mirrors the "Latest Sales" thumbnail-card pattern — a real secondary
 * metric (average Conversational Adequacy Index) paired with a small icon
 * tile instead of a product photo. */
function CaiSummaryCard({ avgCai, activeCalls }: { avgCai: number; activeCalls: number }) {
  return (
    <GlassCard className="p-5 flex items-center gap-4">
      <div className="flex-1">
        <h3 className="text-[13px] font-bold text-[var(--color-text-primary)] mb-1">Avg Engagement (CAI)</h3>
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] text-[var(--color-text-muted)]">{activeCalls} active now</span>
        </div>
        <p className="font-mono text-2xl font-extrabold text-[var(--color-text-primary)] tabular-nums">
          {avgCai}<span className="text-[13px] font-medium text-[var(--color-text-muted)]"> / 100</span>
        </p>
      </div>
      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[var(--console-violet)]/25 to-[var(--console-cyan)]/25 border border-white/10 flex items-center justify-center flex-none">
        <Zap className="w-7 h-7 text-[var(--console-cyan)]" />
      </div>
    </GlassCard>
  );
}

function KpiCard({ label, value, accent, suffix }: { label: string; value: number; accent: Accent; suffix?: string }) {
  return (
    <GlassCard className="p-6 hover:border-[var(--color-border-active)]">
      <h3 className="text-[10.5px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest mb-3">{label}</h3>
      <p className={`font-mono text-4xl font-extrabold tabular-nums ${ACCENT[accent]}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span className="text-[15px] font-medium text-[var(--color-text-muted)] ml-1">{suffix}</span>}
      </p>
    </GlassCard>
  );
}

function KpiCardMinimal({ label, value, accent, suffix, live }: { label: string; value: number; accent: Accent; suffix?: string; live?: boolean }) {
  return (
    <div className="bg-white/[0.04] rounded-xl border border-[var(--color-border-subtle)] p-4 relative overflow-hidden">
      {live && (
        <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      )}
      <h3 className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">{label}</h3>
      <p className={`font-mono text-2xl font-extrabold tabular-nums ${ACCENT[accent]}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span className="text-[12px] font-medium text-[var(--color-text-muted)] ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="h-24 flex items-center justify-center rounded-xl bg-white/[0.03] border border-dashed border-[var(--color-border-subtle)]">
      <p className="text-[12.5px] text-[var(--color-text-muted)] text-center px-6">{label}</p>
    </div>
  );
}

function ChecklistItem({ title, desc, done, href }: { title: string, desc: string, done: boolean, href?: string }) {
  return (
    <div className={`p-5 rounded-xl border ${done ? "bg-white/[0.03] border-[var(--color-border-subtle)]" : "bg-white/[0.06] border-[var(--color-accent-violet)]/40"}`}>
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
  memory_write: { badgeBg: "bg-emerald-500/10", badgeText: "text-emerald-400", label: "Memory Write", short: "MW" },
  retrieval: { badgeBg: "bg-amber-500/10", badgeText: "text-amber-400", label: "Retrieval", short: "RT" },
  policy: { badgeBg: "bg-orange-500/10", badgeText: "text-orange-600", label: "Policy", short: "PL" },
  escalation: { badgeBg: "bg-red-500/10", badgeText: "text-red-600", label: "Escalation", short: "ES" },
  cai: { badgeBg: "bg-[var(--color-accent-cyan)]/10", badgeText: "text-[var(--color-accent-cyan)]", label: "CAI Score", short: "CI" },
  tool_invocation: { badgeBg: "bg-teal-500/10", badgeText: "text-teal-600", label: "Tool Call", short: "TC" },
  guard: { badgeBg: "bg-white/[0.04]", badgeText: "text-[var(--color-text-secondary)]", label: "Guard", short: "GD" },
  llm_reply: { badgeBg: "bg-[var(--color-accent-violet)]/10", badgeText: "text-[var(--color-accent-violet)]", label: "LLM Reply", short: "LR" },
  calendar_sync: { badgeBg: "bg-emerald-500/10", badgeText: "text-emerald-400", label: "Calendar Sync", short: "CS" },
  email_dispatch: { badgeBg: "bg-blue-500/10", badgeText: "text-blue-600", label: "Email Sent", short: "EM" },
};

function eventMeta(type: string) {
  return EVENT_META[type] ?? { badgeBg: "bg-white/[0.04]", badgeText: "text-[var(--color-text-secondary)]", label: type.replace(/_/g, " "), short: type.slice(0, 2).toUpperCase() };
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
    <div className="flex gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-[var(--color-border-subtle)]">
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
