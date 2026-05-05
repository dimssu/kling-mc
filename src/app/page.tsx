"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerationCard } from "@/components/GenerationCard";

export default function DashboardPage() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.getUsage, refetchInterval: 15_000 });
  const recent = useQuery({
    queryKey: ["generations", { limit: 6 }],
    queryFn: () => api.listGenerations(),
    refetchInterval: 8_000,
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-fg-muted)]">Welcome back</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Kling Studio</h1>
        </div>
        <Button asChild size="lg">
          <Link href="/create">
            <Sparkles className="h-4 w-4" />
            New generation
          </Link>
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CostStat label="Today" value={usage.data?.cost.today} loading={usage.isLoading} />
        <CostStat label="This week" value={usage.data?.cost.week} loading={usage.isLoading} />
        <CostStat label="This month" value={usage.data?.cost.month} loading={usage.isLoading} />
        <CostStat
          label="Pending (queued + processing)"
          value={usage.data?.cost.pending}
          variant="muted"
          loading={usage.isLoading}
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent generations</h2>
            <p className="text-sm text-[var(--color-fg-muted)]">Updated automatically while jobs run.</p>
          </div>
          <Link
            href="/library"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            See all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {recent.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="aspect-video rounded-[var(--radius-lg)] shimmer" />
            ))}
          </div>
        ) : recent.data?.items.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.data.items.slice(0, 6).map((g) => (
              <GenerationCard key={g.id} gen={g} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

function CostStat({
  label,
  value,
  variant = "default",
  loading,
}: {
  label: string;
  value?: number;
  variant?: "default" | "muted";
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        {loading ? (
          <div className="mt-1 h-8 w-24 rounded shimmer" />
        ) : (
          <CardTitle
            className={`text-2xl font-semibold tracking-tight font-mono ${
              variant === "muted" ? "text-[var(--color-fg-muted)]" : ""
            }`}
          >
            {formatUsd(value ?? 0)}
          </CardTitle>
        )}
      </CardHeader>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-bg-elev-2)]">
          <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
        </div>
        <div>
          <p className="font-medium">No generations yet</p>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Upload a source video and a reference image to get started.
          </p>
        </div>
        <Button asChild>
          <Link href="/create">
            Create your first <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
