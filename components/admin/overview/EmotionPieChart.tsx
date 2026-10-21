"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Smile } from "lucide-react";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Top 5 emotions by volume, with any remainder lumped into "Other" —
 * mirrors the reference Pie Chart's 5-slice shape while staying driven
 * entirely by real /api/analytics emotion counts. */
function topEmotions(emotions: Record<string, number>) {
  const entries = Object.entries(emotions).sort(([, a], [, b]) => b - a);
  const top = entries.slice(0, 4);
  const rest = entries.slice(4).reduce((s, [, c]) => s + c, 0);
  const data = top.map(([label, value]) => ({ name: label, value }));
  if (rest > 0) data.push({ name: "other", value: rest });
  return data;
}

export function EmotionPieChart({ emotions }: { emotions: Record<string, number> }) {
  const data = topEmotions(emotions);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>
          Emotion Mix
          <Badge variant="outline">
            <Smile />
            {total}
          </Badge>
        </CardTitle>
        <CardDescription>Detected emotion across recent calls</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center pb-0">
        {total === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-[var(--color-text-muted)]">
            No emotion data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Tooltip
                contentStyle={{
                  background: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: 8,
                  color: "var(--color-text-primary)",
                  fontSize: 12,
                  textTransform: "capitalize",
                }}
              />
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={95}
                cornerRadius={8}
                paddingAngle={4}
              >
                {data.map((entry, i) => (
                  <Cell key={entry.name} fill={COLORS[i % COLORS.length]} stroke="none" />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
      {total > 0 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-6 pb-1 text-[11px] text-[var(--color-text-muted)]">
          {data.map((d, i) => (
            <span key={d.name} className="flex items-center gap-1.5 capitalize">
              <span className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              {d.name}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
