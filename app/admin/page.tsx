"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  PhoneCall,
  Clock,
  AlertTriangle,
  Award,
  LayoutDashboard,
  ShieldAlert,
  Loader2,
  LayoutList,
  Activity,
  BarChart3,
} from "lucide-react";
import Link from "next/link";
import { GlassCard } from "@/app/_components/GlassCard";
import { StatCard } from "@/components/admin/overview/StatCard";
import { HourlyBarChart } from "@/components/admin/overview/HourlyBarChart";
import { DailyTrendAreaChart } from "@/components/admin/overview/DailyTrendAreaChart";
import { EmotionPieChart } from "@/components/admin/overview/EmotionPieChart";
import { RecentSessionsCard } from "@/components/admin/overview/RecentSessionsCard";
import { OverviewSkeleton } from "@/components/admin/overview/OverviewSkeleton";

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
  followUpPerformance?: {
    totalCalls: number;
    pickupRate: number;
    firstAttemptPickupRate: number;
    laterAttemptPickupRate: number;
    avgAttemptsUntilReached: number;
    patientsReached: number;
    patientsNeverReached: number;
  };
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

type OverviewTab = "overview" | "live" | "analytics";

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alertCount, setAlertCount] = useState<number | null>(null);
  const [topAlertReason, setTopAlertReason] = useState<string | null>(null);
  const [tab, setTab] = useState<OverviewTab>("overview");
  const [setupStatus, setSetupStatus] = useState<{
    hasBusinessProfile: boolean;
    hasAgent: boolean;
    hasPhoneNumber: boolean;
    hasKnowledge: boolean;
    hasPatient: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/admin/setup-status")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setSetupStatus(d);
      })
      .catch(() => {});
  }, []);

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

  // Needs Attention (spec §8.1.D) — visible from Overview, not buried among
  // chart cards. Open alerts come from lib/scheduler/dispatcher.ts (follow-
  // ups that couldn't resolve automatically) and from live-call escalations
  // (lib/agent/orchestrator.ts).
  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d: { alerts?: Array<{ reason: string }> }) => {
        setAlertCount(d.alerts?.length ?? 0);
        setTopAlertReason(d.alerts?.[0]?.reason ?? null);
      })
      .catch(() => setAlertCount(0));
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

  if (!data) return <OverviewSkeleton />;

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

  const allSetupStepsDone =
    !!setupStatus &&
    setupStatus.hasBusinessProfile &&
    setupStatus.hasAgent &&
    setupStatus.hasPhoneNumber &&
    setupStatus.hasKnowledge &&
    setupStatus.hasPatient &&
    m.totalCalls > 0;

  const emotions = data.emotions ?? {};
  const recentEvents = data.recentEvents ?? [];
  const recentSessions = data.recentSessions ?? [];
  const hourlyHeatmap = data.hourlyHeatmap ?? new Array(24).fill(0);
  const dailyTrend = data.dailyTrend ?? [];
  const confDist = data.confidenceDistribution ?? { high: 0, medium: 0, low: 0 };

  // ── Business-impact metrics — derived entirely from real analytics data,
  // reframed around the question an owner actually opens this page to
  // answer: "is this AI agent worth what I'm paying for it?" ──────────────
  const autonomousResolutionRate = m.totalCalls > 0
    ? Math.max(0, Math.round(100 - (m.escalations / m.totalCalls) * 100))
    : 100;
  const trendLast = dailyTrend.at(-1)?.count ?? 0;
  const trendPrev = dailyTrend.at(-2)?.count ?? 0;
  const sessionTrendPct = trendPrev > 0 ? Math.round(((trendLast - trendPrev) / trendPrev) * 100) : 0;

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

  const TABS: Array<{ id: OverviewTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "overview", label: "Overview", icon: LayoutList },
    { id: "live", label: "Live & Activity", icon: Activity },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ];

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact single-line header — just the title and greeting. The
          outbound-call button, live-status pill and voice orb that used to
          live here were decorative clutter on the main dashboard; outbound
          calling and live-call status already live on their own pages
          (Live Calls / Try a Call). */}
      <header className="flex flex-none items-center gap-2 border-b border-[var(--color-border-subtle)] px-6 py-3 md:px-10">
        <LayoutDashboard className="w-4 h-4 flex-none text-[var(--color-accent-cyan)]" />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Dashboard</span>
        <span className="hidden truncate text-[12px] text-[var(--color-text-muted)] sm:inline">
          · {timeOfDayGreeting()}, here's how your AI agent is performing
        </span>
      </header>

      {/* Needs Attention — spec §8.1.D: visible regardless of which tab is
          active, with a reason and a next action, not just a count. This is
          the one thing that shouldn't require navigating to find. */}
      {!!alertCount && alertCount > 0 && (
        <Link
          href="/admin/alerts"
          className="mx-6 mt-3 flex flex-none items-center justify-between gap-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2.5 transition-colors hover:bg-red-500/15 md:mx-10"
        >
          <div className="flex items-center gap-3 min-w-0">
            <ShieldAlert className="w-4 h-4 text-red-400 flex-none" />
            <p className="text-[13px] font-semibold text-red-400 truncate">
              {alertCount} item{alertCount === 1 ? "" : "s"} need{alertCount === 1 ? "s" : ""} attention
              {topAlertReason && <span className="font-normal text-red-400/80"> — {topAlertReason}</span>}
            </p>
          </div>
          <span className="text-[12px] font-semibold text-red-400 flex items-center gap-1 flex-none">
            Review <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      )}

      {/* Tab bar — splits what used to be one very long page into three
          focused views, so no tab requires much scrolling to take in. */}
      <div className="flex flex-none items-center gap-1 px-6 pt-2 md:px-10">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
              tab === t.id
                ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-10">
        {tab === "overview" && (
          <div className="flex flex-col gap-6">
            {/* Setup Checklist — readiness status is real (see /api/admin/
                setup-status). Hidden once every step is actually complete,
                shown again if setup is genuinely incomplete even for a
                tenant with existing calls. */}
            {setupStatus && !allSetupStepsDone && (() => {
              const steps = [
                { title: "Create Business Profile", desc: "Hospital/business identity", done: setupStatus.hasBusinessProfile, href: "/admin/settings" },
                { title: "Create an Agent", desc: "Configure your AI agent", done: setupStatus.hasAgent, href: "/admin/agents" },
                { title: "Upload Knowledge", desc: "Add FAQs and policies", done: setupStatus.hasKnowledge, href: "/admin/knowledge" },
                { title: "Configure Phone Routing", desc: "Connect Twilio number", done: setupStatus.hasPhoneNumber, href: "/admin/settings" },
                { title: "Add a Patient", desc: "Start your follow-up roster", done: setupStatus.hasPatient, href: "/admin/patients" },
                { title: "Test Your Agent", desc: "Browser test call", done: m.totalCalls > 0, href: "/admin/try-call" },
              ];
              const completedCount = steps.filter((s) => s.done).length;
              return (
                <GlassCard className="p-6 md:p-8">
                  <div className="flex items-center justify-between gap-3 mb-6">
                    <div>
                      <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">Welcome to your workspace</h2>
                      <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5">Complete these steps to deploy your AI agent.</p>
                    </div>
                    <span className="flex-none rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-1 text-[12px] font-semibold text-[var(--color-text-secondary)]">
                      {completedCount}/{steps.length} done
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {steps.map((s) => (
                      <ChecklistItem key={s.title} title={s.title} desc={s.desc} done={s.done} href={s.href} />
                    ))}
                  </div>
                </GlassCard>
              );
            })()}

            {/* The four numbers that matter most at a glance. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                description="Total Sessions"
                value={m.totalCalls.toLocaleString()}
                trend={sessionTrendPct === 0 ? null : sessionTrendPct > 0 ? "up" : "down"}
                badgeLabel={sessionTrendPct === 0 ? "steady" : `${sessionTrendPct > 0 ? "+" : ""}${sessionTrendPct}%`}
                footerTitle={
                  sessionTrendPct > 0 ? "Trending up vs previous day" : sessionTrendPct < 0 ? "Down vs previous day" : "Steady call volume"
                }
                footerDetail="All-time session count"
              />
              <StatCard
                description="Active Bookings"
                value={m.activeBookings.toLocaleString()}
                trend={m.cancelledBookings > m.activeBookings ? "down" : "up"}
                badgeLabel={`${m.cancelledBookings} cxl`}
                footerTitle={m.cancelledBookings > m.activeBookings ? "Cancellations outpacing active" : "Bookings holding steady"}
                footerDetail="Confirmed reservations right now"
              />
              <StatCard
                description="Escalations"
                value={m.escalations.toLocaleString()}
                trend={autonomousResolutionRate >= 80 ? "up" : "down"}
                badgeLabel={`${autonomousResolutionRate}%`}
                footerTitle={autonomousResolutionRate >= 80 ? "Strong autonomous resolution" : "Escalation rate needs attention"}
                footerDetail="Calls the agent couldn't resolve alone"
              />
              <StatCard
                description="Avg CAI Score"
                value={`${m.avgCai}`}
                trend={m.avgCai >= 70 ? "up" : m.avgCai < 40 ? "down" : null}
                badgeLabel={`${m.avgCai}/100`}
                footerTitle={m.avgCai >= 70 ? "Strong engagement" : m.avgCai < 40 ? "Engagement needs review" : "Moderate engagement"}
                footerDetail="Conversational Adequacy Index"
              />
            </div>

            {/* Follow-up performance + patient lookup — the patient-centric
                questions a doctor/hospital opens this page to answer: "is
                the agent actually reaching people" and a fast way into any
                one patient's own history. */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <FollowUpPerformanceCard perf={data.followUpPerformance} />
              <PatientSearchCard />
            </div>

            <RecentSessionsCard sessions={recentSessions} />
          </div>
        )}

        {tab === "live" && (
          <div className="flex flex-col gap-6">
            <HourlyBarChart hourlyHeatmap={hourlyHeatmap} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

              <GlassCard className="p-6 flex flex-col justify-between">
                <div className="flex items-center gap-2.5 mb-4">
                  <Clock className="w-4 h-4 text-[var(--color-accent-violet)]" />
                  <h2 className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Session Performance</h2>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#4F46E5]/[0.04] border border-[var(--color-border-subtle)] rounded-xl p-4">
                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Avg Session</span>
                    <span className="font-mono text-[16px] font-extrabold text-[var(--color-text-primary)] tabular-nums">{formatDuration(m.avgSessionDurationMs)}</span>
                  </div>
                  <div className="bg-[#4F46E5]/[0.04] border border-[var(--color-border-subtle)] rounded-xl p-4">
                    <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block mb-1.5">Missed Bookings</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono text-[16px] font-extrabold tabular-nums ${m.missedBookings > 0 ? "text-amber-400" : "text-emerald-400"}`}>{m.missedBookings}</span>
                      {m.missedBookings > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                    </div>
                  </div>
                </div>
              </GlassCard>
            </div>
          </div>
        )}

        {tab === "analytics" && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-7">
              <div className="lg:col-span-4">
                <DailyTrendAreaChart dailyTrend={dailyTrend} />
              </div>
              <div className="lg:col-span-3">
                <EmotionPieChart emotions={emotions} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

              <GlassCard className="p-6">
                <div className="flex items-center gap-2.5 mb-1">
                  <Award className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-[14px] font-bold text-[var(--color-text-primary)]">SER Confidence Breakdown</h3>
                </div>
                <p className="text-[12.5px] text-[var(--color-text-secondary)] mb-6">Accuracy categories for Speech Emotion Recognition classifications.</p>
                <div className="w-full bg-[var(--color-border-subtle)] rounded-full h-3 flex overflow-hidden mb-6">
                  <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${confDist.high}%` }} title={`High Confidence: ${confDist.high}%`} />
                  <div className="bg-amber-500 transition-all duration-500" style={{ width: `${confDist.medium}%` }} title={`Medium Confidence: ${confDist.medium}%`} />
                  <div className="bg-red-500 transition-all duration-500" style={{ width: `${confDist.low}%` }} title={`Low Confidence: ${confDist.low}%`} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2.5 bg-[#4F46E5]/[0.04] border border-[var(--color-border-subtle)] rounded-lg">
                    <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">High</span>
                    <span className="font-mono font-extrabold text-emerald-400 tabular-nums">{confDist.high}%</span>
                  </div>
                  <div className="p-2.5 bg-[#4F46E5]/[0.04] border border-[var(--color-border-subtle)] rounded-lg">
                    <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Medium</span>
                    <span className="font-mono font-extrabold text-amber-400 tabular-nums">{confDist.medium}%</span>
                  </div>
                  <div className="p-2.5 bg-[#4F46E5]/[0.04] border border-[var(--color-border-subtle)] rounded-lg">
                    <span className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Low</span>
                    <span className="font-mono font-extrabold text-red-400 tabular-nums">{confDist.low}%</span>
                  </div>
                </div>
              </GlassCard>
            </div>

            <GlassCard className="p-6">
              <h2 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-5">Recent Events</h2>
              <div className="space-y-2.5">
                {recentEvents.length > 0 ? (
                  recentEvents.map((ev, i) => <EventRow key={i} event={ev} />)
                ) : (
                  <p className="text-[var(--color-text-muted)] text-[13px]">No recent events.</p>
                )}
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </div>
  );
}

type Accent = keyof typeof ACCENT;

/** Cross-patient "is the agent actually reaching people" summary — the
 * question Follow-up Schedule and Calls & Insights never answered directly
 * (they listed individual tasks/sessions, not the aggregate story). Driven
 * by /api/analytics's followUpPerformance block. */
function FollowUpPerformanceCard({ perf }: { perf: AnalyticsData["followUpPerformance"] }) {
  if (!perf || perf.totalCalls === 0) {
    return (
      <GlassCard className="lg:col-span-2 p-6 flex items-center justify-center text-center">
        <p className="text-[14.5px] text-[var(--color-text-muted)]">No follow-up calls yet — performance stats appear once the scheduler starts dialing.</p>
      </GlassCard>
    );
  }
  const betterOnRetry = perf.laterAttemptPickupRate - perf.firstAttemptPickupRate;
  return (
    <GlassCard className="lg:col-span-2 p-6">
      <div className="flex items-center gap-2.5 mb-6">
        <PhoneCall className="w-4 h-4 text-[var(--color-accent-violet)]" />
        <h2 className="text-[13px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Follow-up Performance</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        <KpiCardMinimal label="Pickup Rate" value={perf.pickupRate} accent="emerald" suffix="%" />
        <KpiCardMinimal label="Reached" value={perf.patientsReached} accent="cyan" />
        <KpiCardMinimal label="Never Reached" value={perf.patientsNeverReached} accent="red" />
        <KpiCardMinimal label="Avg Attempts to Reach" value={perf.avgAttemptsUntilReached} accent="violet" />
      </div>
      <div className="p-4 rounded-xl bg-[#4F46E5]/[0.05] border border-[var(--color-border-subtle)]">
        <p className="text-[14.5px] text-[var(--color-text-primary)]">
          1st try: <strong>{perf.firstAttemptPickupRate}%</strong> pick up · 2nd+ try: <strong>{perf.laterAttemptPickupRate}%</strong> pick up
        </p>
        <p className="text-[13.5px] text-[var(--color-text-muted)] mt-1">
          {perf.laterAttemptPickupRate === 0 || perf.firstAttemptPickupRate === 0
            ? "Not enough repeat attempts yet to compare."
            : betterOnRetry > 5
              ? `Patients are ${betterOnRetry}pp more likely to pick up on a retry than the first call.`
              : betterOnRetry < -5
                ? `Retries are converting worse than first attempts — may be worth reviewing call times.`
                : "Retries convert about as well as first attempts."}
        </p>
      </div>
    </GlassCard>
  );
}

/** Searchable patient roster, embedded on Overview so "find a patient and
 * see their analytics" doesn't require a nav hop first. */
function PatientSearchCard() {
  const [patients, setPatients] = useState<Array<{ id: string; name: string; phone: string }> | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/admin/patients")
      .then((r) => r.json())
      .then((d: { patients?: Array<{ id: string; name: string; phone: string }> }) => setPatients(d.patients ?? []))
      .catch(() => setPatients([]));
  }, []);

  const filtered = (patients ?? []).filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.phone.includes(q);
  });

  return (
    <GlassCard className="p-6 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-[13px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Patients</h2>
        <Link href="/admin/patients" className="text-[13px] font-semibold text-[var(--color-accent-violet)] hover:underline flex-none">
          Manage
        </Link>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or phone…"
        className="w-full mb-3 px-3 py-2.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
      />
      <div className="flex-1 overflow-y-auto max-h-[220px] flex flex-col gap-1.5 -mx-1 px-1">
        {patients === null ? (
          <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)] mx-auto my-4" />
        ) : filtered.length === 0 ? (
          <p className="text-[13.5px] text-[var(--color-text-muted)] italic py-2">No patients match &ldquo;{query}&rdquo;.</p>
        ) : (
          filtered.slice(0, 30).map((p) => (
            <Link
              key={p.id}
              href={`/admin/patients/${p.id}`}
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-[#4F46E5]/[0.06] transition-colors"
            >
              <span className="text-[14.5px] font-medium text-[var(--color-text-primary)] truncate">{p.name}</span>
              <span className="text-[13px] font-mono text-[var(--color-text-muted)] flex-none">{p.phone}</span>
            </Link>
          ))
        )}
      </div>
    </GlassCard>
  );
}


function KpiCardMinimal({ label, value, accent, suffix, live }: { label: string; value: number; accent: Accent; suffix?: string; live?: boolean }) {
  return (
    <div className="bg-[#4F46E5]/[0.04] rounded-xl border border-[var(--color-border-subtle)] p-4 relative overflow-hidden">
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

function ChecklistItem({ title, desc, done, href }: { title: string, desc: string, done: boolean, href?: string }) {
  const content = (
    <>
      <div className="flex items-start gap-3">
        {done ? (
          <CheckCircle2 className="w-5 h-5 flex-none text-emerald-500 mt-0.5" />
        ) : (
          <Circle className="w-5 h-5 flex-none text-[var(--color-text-muted)] mt-0.5" />
        )}
        <div className="min-w-0">
          <h4 className={`text-[13.5px] font-semibold ${done ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-primary)]"}`}>{title}</h4>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{desc}</p>
        </div>
      </div>
      {!done && (
        <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--color-accent-cyan)]">
          Start <ArrowRight className="w-3 h-3" />
        </span>
      )}
    </>
  );

  if (done || !href) {
    return (
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-4">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-4 transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-bg-elevated)]/60"
    >
      {content}
    </Link>
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
  guard: { badgeBg: "bg-[#4F46E5]/[0.04]", badgeText: "text-[var(--color-text-secondary)]", label: "Guard", short: "GD" },
  llm_reply: { badgeBg: "bg-[var(--color-accent-violet)]/10", badgeText: "text-[var(--color-accent-violet)]", label: "LLM Reply", short: "LR" },
  calendar_sync: { badgeBg: "bg-emerald-500/10", badgeText: "text-emerald-400", label: "Calendar Sync", short: "CS" },
  email_dispatch: { badgeBg: "bg-blue-500/10", badgeText: "text-blue-600", label: "Email Sent", short: "EM" },
};

function eventMeta(type: string) {
  return EVENT_META[type] ?? { badgeBg: "bg-[#4F46E5]/[0.04]", badgeText: "text-[var(--color-text-secondary)]", label: type.replace(/_/g, " "), short: type.slice(0, 2).toUpperCase() };
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
    <div className="flex gap-3 p-3.5 rounded-xl bg-[#4F46E5]/[0.04] border border-[var(--color-border-subtle)]">
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
