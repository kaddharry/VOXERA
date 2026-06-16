"use client";

import { useEffect, useState } from "react";

interface SessionSummary {
  sessionId: string;
  eventCount: number;
  lastTs: number;
  dominantEmotion: string;
}

interface SessionEvent {
  type: string;
  ts: number;
  sessionId: string;
  userId: string;
  payload: Record<string, unknown>;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.recentSessions ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadSession = async (sessionId: string) => {
    setSelectedSession(sessionId);
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  return (
    <div className="p-8 font-sans text-gray-900 bg-white min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Session History</h1>
        <p className="text-gray-500 mt-2">
          Browse past conversations and inspect the full event timeline.
        </p>
      </header>

      <div className="flex gap-6">
        {/* Session List */}
        <div className="w-80 flex-none">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Sessions</h2>
          {loading ? (
            <p className="text-gray-400 text-sm animate-pulse">Loading...</p>
          ) : sessions.length === 0 ? (
            <p className="text-gray-400 text-sm italic">No sessions found.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.sessionId}
                  onClick={() => loadSession(s.sessionId)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedSession === s.sessionId
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-gray-50 hover:border-gray-300"
                  }`}
                >
                  <div className="font-mono text-xs text-gray-600 truncate">{s.sessionId}</div>
                  <div className="flex gap-2 mt-1.5 text-[10px]">
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{s.eventCount} events</span>
                    <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded capitalize">{s.dominantEmotion}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">{new Date(s.lastTs).toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Event Timeline */}
        <div className="flex-1">
          {!selectedSession ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
              Select a session to view its event timeline
            </div>
          ) : eventsLoading ? (
            <div className="text-gray-400 text-sm animate-pulse">Loading events...</div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Timeline — <span className="font-mono text-gray-700">{selectedSession.slice(0, 12)}...</span> ({events.length} events)
              </h2>
              {events.map((ev, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                  <div className="flex-none pt-0.5">
                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 capitalize text-sm">{ev.type.replace(/_/g, " ")}</span>
                      <span className="text-[10px] text-gray-400">{new Date(ev.ts).toLocaleTimeString()}</span>
                    </div>
                    <pre className="text-[10px] text-gray-600 whitespace-pre-wrap font-mono break-all bg-white p-2 rounded border border-gray-100">
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
