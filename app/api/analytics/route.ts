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
      .limit(1000); // Limit to last 1000 events for memory safety

    if (eventsError) throw eventsError;

    // Calculate Metrics from events
    const uniqueSessions = new Set(events?.map((e) => e.sessionId) || []);
    const totalCalls = uniqueSessions.size;

    const emotionEvents = (events || []).filter((e) => e.type === "emotion");
    const emotionCounts: Record<string, number> = {};
    emotionEvents.forEach((e) => {
      const payload = e.payload as any;
      const label = payload.label || "neutral";
      emotionCounts[label] = (emotionCounts[label] || 0) + 1;
    });

    const toolEvents = (events || []).filter((e) => e.type === "tool_invocation");
    const escalationEvents = (events || []).filter((e) => e.type === "escalation");

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
      },
      emotions: emotionCounts,
      // send last 50 events for timeline
      recentEvents: (events || []).slice(0, 50),
    });
  } catch (error) {
    console.error("[Analytics] Error fetching data:", error);
    return NextResponse.json({ error: "Failed to load analytics data" }, { status: 500 });
  }
}
