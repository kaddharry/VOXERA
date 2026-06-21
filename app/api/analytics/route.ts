import { NextResponse } from "next/server";
import { supabase } from "../../../lib/db/supabase";
import { createClient } from "../../../lib/db/server";
import { callQueue } from "../../../lib/queue/manager";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabaseServer = await createClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const clientId = user.id;

    // 1. Fetch Session Events
    const { data: events, error: eventsError } = await supabase
      .from("session_logs")
      .select("*")
      .eq("clientId", clientId)
      .order("ts", { ascending: false })
      .limit(1000);

    if (eventsError) throw eventsError;

    const safeEvents = events || [];

    // Calculate Metrics from events
    const uniqueSessions = new Set(safeEvents.map((e) => e.sessionId));
    const totalCalls = uniqueSessions.size;

    const emotionEvents = safeEvents.filter((e) => e.type === "emotion");
    const emotionCounts: Record<string, number> = {};
    emotionEvents.forEach((e) => {
      const payload = e.payload as any;
      const label = payload?.label || "neutral";
      emotionCounts[label] = (emotionCounts[label] || 0) + 1;
    });

    const toolEvents = safeEvents.filter((e) => e.type === "tool_invocation");
    const successfulToolEvents = toolEvents.filter((e) => (e.payload as any)?.success !== false);
    const escalationEvents = safeEvents.filter((e) => e.type === "escalation");

    // Average CAI score
    const caiEvents = safeEvents.filter((e) => e.type === "cai");
    const avgCai = caiEvents.length > 0
      ? Math.round(caiEvents.reduce((sum, e) => sum + ((e.payload as any)?.score ?? 0), 0) / caiEvents.length)
      : 0;

    // Recent sessions summary (last 10 unique sessions) and duration calculations
    const sessionMap = new Map<string, { events: typeof safeEvents; lastTs: number }>();
    for (const ev of safeEvents) {
      const existing = sessionMap.get(ev.sessionId);
      if (!existing) {
        sessionMap.set(ev.sessionId, { events: [ev], lastTs: ev.ts });
      } else {
        existing.events.push(ev);
        if (ev.ts > existing.lastTs) existing.lastTs = ev.ts;
      }
    }
    const recentSessions = Array.from(sessionMap.entries())
      .sort(([, a], [, b]) => b.lastTs - a.lastTs)
      .slice(0, 10)
      .map(([sessionId, info]) => {
        // Find dominant emotion for this session
        const sessionEmotions: Record<string, number> = {};
        for (const ev of info.events) {
          if (ev.type === "emotion") {
            const label = (ev.payload as any)?.label || "neutral";
            sessionEmotions[label] = (sessionEmotions[label] || 0) + 1;
          }
        }
        const dominantEmotion = Object.entries(sessionEmotions).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "neutral";
        return {
          sessionId,
          eventCount: info.events.length,
          lastTs: info.lastTs,
          dominantEmotion,
        };
      });

    // 2. Fetch Bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from("reservations")
      .select("status")
      .eq("clientId", clientId);

    if (bookingsError) throw bookingsError;

    const activeBookings = (bookings || []).filter((b) => b.status === "confirmed").length;
    const cancelledBookings = (bookings || []).filter((b) => b.status === "cancelled").length;

    // 3. Fetch Phone Call Metrics (FR-1, FR-19)
    const { data: callLogs } = await supabase
      .from("call_logs")
      .select("id, status, durationMs")
      .eq("clientId", clientId);

    const safeCalls = callLogs || [];
    const totalPhoneCalls = safeCalls.length;
    const completedCalls = safeCalls.filter((c) => c.status === "completed");
    const avgCallDurationMs =
      completedCalls.length > 0
        ? Math.round(completedCalls.reduce((s, c) => s + (c.durationMs || 0), 0) / completedCalls.length)
        : 0;

    // 4. Live queue metrics from in-process CallQueueManager
    const queueMetrics = callQueue.getMetrics();

    // ─── NEW SPRINT 5 METRICS ──────────────────────────────────────────────────

    // 1. Unique Session start timestamps (min timestamp per session ID)
    const sessionTimes = new Map<string, number>();
    for (const ev of safeEvents) {
      const currentMin = sessionTimes.get(ev.sessionId);
      if (currentMin === undefined || ev.ts < currentMin) {
        sessionTimes.set(ev.sessionId, ev.ts);
      }
    }

    // 2. Peak Hours Heatmap (24-hour array)
    const hourlyHeatmap = new Array(24).fill(0);
    for (const ts of sessionTimes.values()) {
      const date = new Date(ts);
      const hour = date.getHours();
      hourlyHeatmap[hour]++;
    }

    // 3. Session Count daily trend chart
    const dailyCounts: Record<string, number> = {};
    for (const ts of sessionTimes.values()) {
      const dateStr = new Date(ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
    }
    const dailyTrend = Object.entries(dailyCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => {
        const curYear = new Date().getFullYear();
        return new Date(`${a.date}, ${curYear}`).getTime() - new Date(`${b.date}, ${curYear}`).getTime();
      });

    // 4. Booking Conversion Rate (% of sessions with synced booking)
    const bookingSessions = new Set<string>();
    for (const ev of safeEvents) {
      if (ev.type === "calendar_sync" && ev.payload?.status === "synced") {
        bookingSessions.add(ev.sessionId);
      }
    }
    const conversionRate = totalCalls > 0
      ? Math.round((bookingSessions.size / totalCalls) * 100)
      : 0;

    // 5. Average Session Duration
    let totalDurationMs = 0;
    let sessionDurationCount = 0;
    for (const [sid, info] of sessionMap.entries()) {
      const minTs = Math.min(...info.events.map((e) => e.ts));
      const maxTs = Math.max(...info.events.map((e) => e.ts));
      const duration = maxTs - minTs;
      if (duration > 0) {
        totalDurationMs += duration;
        sessionDurationCount++;
      }
    }
    const avgSessionDurationMs = sessionDurationCount > 0
      ? Math.round(totalDurationMs / sessionDurationCount)
      : 0;

    // 6. Missed Bookings (failed create_booking attempts)
    const missedBookings = safeEvents.filter(
      (e) => e.type === "tool_invocation" &&
             e.payload?.tool === "create_booking" &&
             e.payload?.success === false
    ).length;

    // 7. Confidence distribution (high / medium / low)
    let highConf = 0;
    let medConf = 0;
    let lowConf = 0;
    const emotionEvents2 = safeEvents.filter((e) => e.type === "emotion");
    for (const ev of emotionEvents2) {
      const payload = ev.payload as any;
      const level = payload?.confidenceCategory?.level || 
                    (payload?.confidence >= 0.8 ? "high" : 
                     payload?.confidence >= 0.5 ? "medium" : "low");
      if (level === "high") highConf++;
      else if (level === "medium") medConf++;
      else if (level === "low") lowConf++;
    }
    const totalConf = highConf + medConf + lowConf;
    const confidenceDistribution = {
      high: totalConf > 0 ? Math.round((highConf / totalConf) * 100) : 0,
      medium: totalConf > 0 ? Math.round((medConf / totalConf) * 100) : 0,
      low: totalConf > 0 ? Math.round((lowConf / totalConf) * 100) : 0,
    };

    return NextResponse.json({
      metrics: {
        totalCalls,
        totalToolInvocations: successfulToolEvents.length, // Count successful/executed calls
        activeBookings,
        cancelledBookings,
        escalations: escalationEvents.length,
        avgCai,
        // Telephony metrics
        totalPhoneCalls,
        activeCalls: queueMetrics.activeCallCount,
        callQueueLength: queueMetrics.queueLength,
        avgCallDurationMs,
        // Sprint 5 advanced metrics
        conversionRate,
        avgSessionDurationMs,
        missedBookings,
      },
      hourlyHeatmap,
      dailyTrend,
      confidenceDistribution,
      emotions: emotionCounts,
      recentEvents: safeEvents.slice(0, 50),
      recentSessions,
    });
  } catch (error) {
    console.error("[Analytics] Error fetching data:", error);
    return NextResponse.json({ error: "Failed to load analytics data" }, { status: 500 });
  }
}
