"use client";

import { useEffect, useState } from "react";

interface AnalyticsData {
  metrics: {
    totalCalls: number;
    totalToolInvocations: number;
    activeBookings: number;
    cancelledBookings: number;
    escalations: number;
    avgCai: number;
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
    <div className="p-10 font-sans">
      <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
        <h2 className="font-bold mb-2">Failed to load analytics</h2>
        <p>{error}</p>
        <p className="mt-4 text-sm text-red-500">Tip: Make sure the SQL migration has been run in your Supabase SQL Editor.</p>
      </div>
    </div>
  );

  if (!data) return <div className="p-10 font-sans text-gray-500 animate-pulse">Loading Analytics...</div>;

  const m = data.metrics;
  const emotions = data.emotions ?? {};
  const recentEvents = data.recentEvents ?? [];
  const recentSessions = data.recentSessions ?? [];

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-800">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">VOXERA Dashboard</h1>
        <p className="text-gray-500 mt-2">Real-time Analytics & Session Monitoring</p>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <KpiCard label="Total Calls" value={m.totalCalls} color="text-blue-600" />
        <KpiCard label="Tool Calls" value={m.totalToolInvocations} color="text-indigo-600" />
        <KpiCard label="Escalations" value={m.escalations} color="text-orange-500" />
        <KpiCard label="Active Bookings" value={m.activeBookings} color="text-green-600" />
        <KpiCard label="Cancelled" value={m.cancelledBookings} color="text-red-500" />
        <KpiCard label="Avg CAI" value={m.avgCai} color="text-purple-600" suffix="/100" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Emotion Distribution */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Emotion Distribution</h2>
          <div className="space-y-3">
            {Object.entries(emotions).length > 0 ? (
              Object.entries(emotions)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([emotion, count]) => {
                  const total = Object.values(emotions).reduce((s, c) => s + (c as number), 0);
                  const pct = total > 0 ? Math.round(((count as number) / total) * 100) : 0;
                  return (
                    <div key={emotion}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="capitalize font-medium text-gray-700">{emotion}</span>
                        <span className="text-gray-500">{String(count)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
            ) : (
              <p className="text-gray-400 text-sm italic">No emotion data yet.</p>
            )}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Sessions</h2>
          <div className="space-y-3">
            {recentSessions.length > 0 ? (
              recentSessions.map((s) => (
                <div key={s.sessionId} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-mono text-xs text-gray-600 truncate max-w-[140px]">{s.sessionId}</span>
                    <span className="text-xs text-gray-400">{new Date(s.lastTs).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{s.eventCount} events</span>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full capitalize">{s.dominantEmotion}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-400 text-sm italic">No sessions recorded yet.</p>
            )}
          </div>
        </div>

        {/* Event Timeline */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Events</h2>
          <div className="overflow-y-auto h-80 pr-2 space-y-3">
            {recentEvents.length > 0 ? (
              recentEvents.map((ev, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors">
                  <div className="flex-none">
                    <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-[10px] font-bold ${eventColor(ev.type)}`}>
                      {ev.type.substring(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 capitalize text-sm">{ev.type.replace(/_/g, " ")}</span>
                      <span className="text-[10px] text-gray-400">{new Date(ev.ts).toLocaleTimeString()}</span>
                    </div>
                    <pre className="text-[10px] text-gray-600 whitespace-pre-wrap font-mono break-all bg-white p-1.5 rounded border border-gray-100 max-h-20 overflow-hidden">
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-400 text-sm italic">No recent events.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color, suffix }: { label: string; value: number; color: string; suffix?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</h3>
      <p className={`text-3xl font-bold ${color}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span className="text-sm font-normal text-gray-400">{suffix}</span>}
      </p>
    </div>
  );
}

function eventColor(type: string): string {
  switch (type) {
    case "utterance": return "bg-blue-100 text-blue-600";
    case "emotion": return "bg-purple-100 text-purple-600";
    case "memory_write": return "bg-green-100 text-green-600";
    case "retrieval": return "bg-yellow-100 text-yellow-700";
    case "policy": return "bg-orange-100 text-orange-600";
    case "escalation": return "bg-red-100 text-red-600";
    case "cai": return "bg-indigo-100 text-indigo-600";
    case "tool_invocation": return "bg-teal-100 text-teal-600";
    case "guard": return "bg-gray-200 text-gray-600";
    case "llm_reply": return "bg-cyan-100 text-cyan-600";
    default: return "bg-gray-100 text-gray-600";
  }
}
