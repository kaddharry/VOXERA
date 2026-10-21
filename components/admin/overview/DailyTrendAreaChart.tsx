"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp } from "lucide-react";

export function DailyTrendAreaChart({
  dailyTrend,
}: {
  dailyTrend: Array<{ date: string; count: number }>;
}) {
  const last = dailyTrend.at(-1)?.count ?? 0;
  const prev = dailyTrend.at(-2)?.count ?? 0;
  const pct = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 0;
  const up = pct >= 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          Daily Call Trend
          <Badge variant="outline">
            {up ? <TrendingUp /> : <TrendingDown />}
            {pct >= 0 ? "+" : ""}
            {pct}%
          </Badge>
        </CardTitle>
        <CardDescription>Sessions per day over the recorded window</CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] pr-2">
        {dailyTrend.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
            No trend data yet — check back after a few days of calls.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyTrend}>
              <defs>
                <linearGradient id="dailyTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={11}
                stroke="var(--color-text-muted)"
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border-active)" }}
                contentStyle={{
                  background: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: 8,
                  color: "var(--color-text-primary)",
                  fontSize: 12,
                }}
              />
              <Area
                dataKey="count"
                type="natural"
                fill="url(#dailyTrendFill)"
                stroke="var(--chart-1)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
