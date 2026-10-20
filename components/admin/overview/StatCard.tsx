import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

export function StatCard({
  description,
  value,
  trend,
  badgeLabel,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  /** null = neutral (no real directional signal to claim) */
  trend: "up" | "down" | null;
  badgeLabel: string;
  footerTitle: string;
  footerDetail: string;
}) {
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <Card className="bg-gradient-to-t from-[var(--color-accent-cyan)]/5 to-[var(--color-bg-surface)] shadow-xs">
      <CardHeader>
        <CardDescription>{description}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        <CardAction>
          <Badge variant="outline">
            <Icon />
            {badgeLabel}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium text-[var(--color-text-primary)]">
          {footerTitle} <Icon className="size-4" />
        </div>
        <div className="text-[var(--color-text-muted)]">{footerDetail}</div>
      </CardFooter>
    </Card>
  );
}
