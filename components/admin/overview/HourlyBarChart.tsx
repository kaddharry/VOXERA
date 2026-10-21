"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

/** Real hourly call-arrival counts, collapsed from 24 hourly buckets down to
 * 3-hour buckets so the chart reads cleanly without recharts category
 * crowding — same shape of data as the Peak Hours Heatmap panel further
 * down the page, just charted instead of rendered as bars-by-hand. */
function bucketHourly(hourlyHeatmap: number[]) {
  const labels = ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"];
  return labels.map((label, i) => {
    const slice = hourlyHeatmap.slice(i * 3, i * 3 + 3);
    return { hour: label, calls: slice.reduce((s, c) => s + c, 0) };
  });
}

export function HourlyBarChart({ hourlyHeatmap }: { hourlyHeatmap: number[] }) {
  const data = bucketHourly(hourlyHeatmap);
  const total = data.reduce((s, d) => s + d.calls, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          Call Volume by Hour
          <Badge variant="outline">
            <TrendingUp />
            {total} total
          </Badge>
        </CardTitle>
        <CardDescription>Session arrivals across the day</CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] pr-2">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
            No sessions recorded yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis
                dataKey="hour"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                fontSize={11}
                stroke="var(--color-text-muted)"
              />
              <Tooltip
                cursor={{ fill: "var(--color-bg-elevated)" }}
                contentStyle={{
                  background: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: 8,
                  color: "var(--color-text-primary)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="calls" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
