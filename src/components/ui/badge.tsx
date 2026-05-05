import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral:
          "border-[var(--color-border-strong)] bg-[var(--color-bg-elev-2)] text-[var(--color-fg-muted)]",
        accent:
          "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-fg)]",
        success:
          "border-transparent bg-[color-mix(in_oklab,var(--color-success)_20%,transparent)] text-[var(--color-success)]",
        warning:
          "border-transparent bg-[color-mix(in_oklab,var(--color-warning)_22%,transparent)] text-[var(--color-warning)]",
        danger:
          "border-transparent bg-[color-mix(in_oklab,var(--color-danger)_22%,transparent)] text-[var(--color-danger)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
