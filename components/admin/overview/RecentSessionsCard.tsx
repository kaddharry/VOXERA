import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Session = {
  sessionId: string;
  eventCount: number;
  lastTs: number;
  dominantEmotion: string;
};

function initials(sessionId: string) {
  return sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "??";
}

export function RecentSessionsCard({ sessions }: { sessions: Session[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent Sessions</CardTitle>
        <CardDescription>
          {sessions.length > 0
            ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} in the recent window`
            : "No sessions recorded yet"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {sessions.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No sessions recorded yet.</p>
          ) : (
            sessions.slice(0, 5).map((s) => (
              <Link
                href="/admin/sessions"
                key={s.sessionId}
                className="flex items-center gap-4 -mx-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-[var(--color-bg-elevated)]/60"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-elevated)] text-xs font-semibold text-[var(--color-text-secondary)]">
                  {initials(s.sessionId)}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm leading-none font-medium text-[var(--color-text-primary)]">
                    {s.sessionId}
                  </p>
                  <p className="text-sm text-[var(--color-text-muted)] capitalize">
                    {s.dominantEmotion} &middot; {new Date(s.lastTs).toLocaleString()}
                  </p>
                </div>
                <div className="ml-auto shrink-0 font-medium text-[var(--color-text-secondary)] text-sm">
                  {s.eventCount} events
                </div>
              </Link>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
