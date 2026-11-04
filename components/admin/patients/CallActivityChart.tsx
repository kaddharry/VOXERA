"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export interface CallForChart {
  startedAt: number;
  status: string;
}

/** Groups calls into weekly buckets (last 8 weeks) and counts completed vs.
 * missed/failed — real, countable data, not a fabricated sentiment score
 * (CallSummary only has a free-text sentimentTrajectory sentence, no
 * number to chart). */
function buildWeeklyBuckets(calls: CallForChart[]): Array<{ week: string; completed: number; missed: number }> {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets = Array.from({ length: 8 }, (_, i) => {
    const start = now - (7 - i) * weekMs;
    return { start, completed: 0, missed: 0 };
  });
  for (const call of calls) {
    const bucket = buckets.find((b, i) => call.startedAt >= b.start && (i === buckets.length - 1 || call.startedAt < buckets[i + 1]!.start));
    if (!bucket) continue;
    if (call.status === "completed") bucket.completed += 1;
    else bucket.missed += 1;
  }
  return buckets.map((b) => ({
    week: new Date(b.start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    completed: b.completed,
    missed: b.missed,
  }));
}

export function CallActivityChart({ calls }: { calls: CallForChart[] }) {
  const data = buildWeeklyBuckets(calls);
  const hasAny = data.some((d) => d.completed > 0 || d.missed > 0);

  return (
    <div className="h-[220px] w-full">
      {!hasAny ? (
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-muted)]">
          No call activity yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
            <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} stroke="var(--color-text-muted)" />
            <Tooltip
              cursor={{ fill: "var(--color-bg-surface)" }}
              contentStyle={{
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 8,
                color: "var(--color-text-primary)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-text-muted)" }} />
            <Bar dataKey="completed" name="Picked up" fill="var(--risk-low)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="missed" name="Missed" fill="var(--risk-high)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
