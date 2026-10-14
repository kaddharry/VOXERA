import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/db/server";
import { callQueue } from "../../../lib/queue/manager";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
const DEFAULT_RANGE = "30d";
// Safety valve only, not the windowing mechanism — the previous version used
// a row-count limit (last 1000 session_logs rows, regardless of date) as its
// *only* bound, which silently turned "today"/"daily trend" charts into an
// arbitrary recent sample for any tenant with real call volume, with no
// indication to the viewer that older events in the selected window were
// excluded. Filtering by date first means a date window is always complete;
// this cap just prevents a pathological single query from being unbounded.
const MAX_ROWS = 20000;

export async function GET(request: NextRequest) {
  try {
    const supabaseServer = await createClient();
    const { data: { user } } = await supabaseServer.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const clientId = user.id;

    const rangeParam = request.nextUrl.searchParams.get("range") ?? DEFAULT_RANGE;
    const rangeDays = RANGE_DAYS[rangeParam] ?? RANGE_DAYS[DEFAULT_RANGE];
    const since = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

    // 1. Fetch Session Events (Using user-authenticated client)
    const { data: events, error: eventsError, count: eventsCount } = await supabaseServer
      .from("session_logs")
      .select("*", { count: "exact" })
      .eq("clientId", clientId)
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(MAX_ROWS);

    if (eventsError) throw eventsError;

    const safeEvents = events || [];
    // true only if MAX_ROWS truncated an otherwise-complete date-filtered
    // result — distinct from the old silent truncation, this is reported
    // back to the caller so the UI can say so instead of pretending the
    // window is exhaustive.
    const truncated = (eventsCount ?? safeEvents.length) > safeEvents.length;

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

    // 2. Fetch Bookings (Using user-authenticated client)
    // NOT date-windowed like the queries above: reservations has no
    // timestamp column (`date`/`time` are free-text fields written by the
    // booking tool, not a comparable instant), so there's no reliable way
    // to bound this by the selected range without a schema change. Left as
    // an all-time count — activeBookings/cancelledBookings describe the
    // tenant's whole history, not the `range` window, until that's added.
    const { data: bookings, error: bookingsError } = await supabaseServer
      .from("reservations")
      .select("status")
      .eq("clientId", clientId)
      .limit(MAX_ROWS);

    if (bookingsError) throw bookingsError;

    const activeBookings = (bookings || []).filter((b) => b.status === "confirmed").length;
    const cancelledBookings = (bookings || []).filter((b) => b.status === "cancelled").length;

    // 3. Fetch Phone Call Metrics (Using user-authenticated client)
    const { data: callLogs } = await supabaseServer
      .from("call_logs")
      .select("id, status, durationMs")
      .eq("clientId", clientId)
      .gte("startedAt", since)
      .limit(MAX_ROWS);

    const safeCalls = callLogs || [];
    const totalPhoneCalls = safeCalls.length;
    const completedCalls = safeCalls.filter((c) => c.status === "completed");
    const avgCallDurationMs =
      completedCalls.length > 0
        ? Math.round(completedCalls.reduce((s, c) => s + (c.durationMs || 0), 0) / completedCalls.length)
        : 0;

    // 4. Live queue metrics from in-process CallQueueManager (now Redis-backed async)
    const queueMetrics = await callQueue.getMetrics();

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

    // ─── FOLLOW-UP PERFORMANCE — cross-patient view for Overview ───────────
    // Answers the questions a hospital admin actually has about the agent:
    // what fraction of calls get picked up at all, how many attempts does
    // that typically take, and does a second/third attempt actually help or
    // is it just noise. Built from call_logs rows tied to a follow-up task
    // (followUpTaskId not null) — manual "Call Now" calls aren't part of
    // the retry story so they're excluded here on purpose.
    const { data: followUpCalls } = await supabaseServer
      .from("call_logs")
      .select('id, status, "followUpTaskId", "startedAt"')
      .eq("clientId", clientId)
      .not("followUpTaskId", "is", null)
      .gte("startedAt", since)
      .order("startedAt", { ascending: true })
      .limit(MAX_ROWS);

    const callsByTask = new Map<string, { status: string; startedAt: number }[]>();
    for (const c of followUpCalls ?? []) {
      const taskId = c.followUpTaskId as string;
      const list = callsByTask.get(taskId) ?? [];
      list.push({ status: c.status as string, startedAt: c.startedAt as number });
      callsByTask.set(taskId, list);
    }

    let firstAttemptTotal = 0, firstAttemptPickedUp = 0;
    let laterAttemptTotal = 0, laterAttemptPickedUp = 0;
    let tasksReached = 0, tasksNeverReached = 0;
    let attemptsUntilReachedSum = 0;
    for (const calls of callsByTask.values()) {
      calls.sort((a, b) => a.startedAt - b.startedAt);
      const pickedUpIndex = calls.findIndex((c) => c.status === "completed");
      calls.forEach((c, i) => {
        const pickedUp = c.status === "completed";
        if (i === 0) {
          firstAttemptTotal++;
          if (pickedUp) firstAttemptPickedUp++;
        } else {
          laterAttemptTotal++;
          if (pickedUp) laterAttemptPickedUp++;
        }
      });
      if (pickedUpIndex >= 0) {
        tasksReached++;
        attemptsUntilReachedSum += pickedUpIndex + 1;
      } else {
        tasksNeverReached++;
      }
    }
    const totalFollowUpCalls = firstAttemptTotal + laterAttemptTotal;
    const totalFollowUpTasks = tasksReached + tasksNeverReached;
    const followUpPerformance = {
      totalCalls: totalFollowUpCalls,
      pickupRate: totalFollowUpCalls > 0 ? Math.round(((firstAttemptPickedUp + laterAttemptPickedUp) / totalFollowUpCalls) * 100) : 0,
      firstAttemptPickupRate: firstAttemptTotal > 0 ? Math.round((firstAttemptPickedUp / firstAttemptTotal) * 100) : 0,
      laterAttemptPickupRate: laterAttemptTotal > 0 ? Math.round((laterAttemptPickedUp / laterAttemptTotal) * 100) : 0,
      avgAttemptsUntilReached: tasksReached > 0 ? Math.round((attemptsUntilReachedSum / tasksReached) * 10) / 10 : 0,
      patientsNeverReached: tasksNeverReached,
      patientsReached: tasksReached,
    };

    return NextResponse.json({
      window: {
        range: rangeParam in RANGE_DAYS ? rangeParam : DEFAULT_RANGE,
        sinceMs: since,
        untilMs: Date.now(),
        truncated,
      },
      metrics: {
        totalCalls,
        totalToolInvocations: successfulToolEvents.length,
        activeBookings,
        cancelledBookings,
        escalations: escalationEvents.length,
        avgCai,
        totalPhoneCalls,
        activeCalls: queueMetrics.activeCallCount,
        callQueueLength: queueMetrics.queueLength,
        avgCallDurationMs,
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
      followUpPerformance,
    });
  } catch (error) {
    console.error("[Analytics] Error fetching data:", error);
    return NextResponse.json({ error: "Failed to load analytics data" }, { status: 500 });
  }
}
