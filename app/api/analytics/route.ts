import { NextResponse } from "next/server";
import { supabase } from "../../../lib/db/supabase";
import { createClient } from "../../../lib/db/server";

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
    const escalationEvents = safeEvents.filter((e) => e.type === "escalation");

    // Average CAI score
    const caiEvents = safeEvents.filter((e) => e.type === "cai");
    const avgCai = caiEvents.length > 0
      ? Math.round(caiEvents.reduce((sum, e) => sum + ((e.payload as any)?.score ?? 0), 0) / caiEvents.length)
      : 0;

    // Recent sessions summary (last 10 unique sessions)
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

    return NextResponse.json({
      metrics: {
        totalCalls,
        totalToolInvocations: toolEvents.length,
        activeBookings,
        cancelledBookings,
        escalations: escalationEvents.length,
        avgCai,
      },
      emotions: emotionCounts,
      recentEvents: safeEvents.slice(0, 50),
      recentSessions,
    });
  } catch (error) {
    console.error("[Analytics] Error fetching data:", error);
    return NextResponse.json({ error: "Failed to load analytics data" }, { status: 500 });
  }
}
