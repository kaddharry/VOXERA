import * as React from "react";
import { cn } from "@/lib/utils";

const BADGE_VARIANTS = {
  default: "bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)]",
  outline: "border-[var(--color-border-subtle)] text-[var(--color-text-primary)]",
  success: "bg-emerald-500/15 text-emerald-400",
  warning: "bg-amber-500/15 text-amber-400",
  destructive: "bg-red-500/15 text-red-400",
} as const;

function Badge({
  className,
  variant = "outline",
  ...props
}: React.ComponentProps<"span"> & { variant?: keyof typeof BADGE_VARIANTS }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
        BADGE_VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
