"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { formatUsd } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_ORDER = ["queued", "processing", "completed", "failed"] as const;

export default function UsagePage() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.getUsage, refetchInterval: 10_000 });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Usage</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
          Cost rollups based on the rate table below. Actual deductions come from Kling on completion.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Today" v={usage.data?.cost.today} />
        <Stat label="This week" v={usage.data?.cost.week} />
        <Stat label="This month" v={usage.data?.cost.month} />
        <Stat label="All-time" v={usage.data?.cost.allTime} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>In-flight</CardTitle>
          <CardDescription>Estimated cost of jobs that haven&apos;t completed yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-2xl">{formatUsd(usage.data?.cost.pending ?? 0)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Status breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-fg-muted)] capitalize">{s}</p>
                <p className="mt-1 text-2xl font-semibold font-mono">{usage.data?.counts?.[s] ?? 0}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate table</CardTitle>
          <CardDescription>Configurable in <code className="font-mono">src/lib/kling/pricing.ts</code>.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-fg-muted)]">
                <th className="py-2">Model</th>
                <th className="py-2">Standard / 5 s</th>
                <th className="py-2">Pro / 5 s</th>
              </tr>
            </thead>
            <tbody>
              {usage.data &&
                Object.entries(usage.data.pricingTable).map(([model, rates]) => (
                  <tr key={model} className="border-t border-[var(--color-border)]">
                    <td className="py-2 font-mono">{model}</td>
                    <td className="py-2 font-mono">{formatUsd(rates.std)}</td>
                    <td className="py-2 font-mono">{formatUsd(rates.pro)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, v }: { label: string; v?: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-mono">{formatUsd(v ?? 0)}</CardTitle>
      </CardHeader>
    </Card>
  );
}
