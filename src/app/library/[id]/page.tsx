"use client";

import * as React from "react";
import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatDuration, formatUsd, relativeTime } from "@/lib/utils";
import { publicUrl } from "@/components/MediaThumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/StatusPill";
import { MediaThumb } from "@/components/MediaThumb";

type Props = { params: Promise<{ id: string }> };

export default function GenerationDetailPage({ params }: Props) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ["generation", id],
    queryFn: () => api.getGeneration(id),
    refetchInterval: ({ state }) => {
      const status = state.data?.generation.status;
      return status === "queued" || status === "processing" ? 4_000 : false;
    },
  });

  const g = q.data?.generation;

  if (q.isLoading) {
    return <div className="mx-auto max-w-5xl"><div className="aspect-video rounded-[var(--radius-lg)] shimmer" /></div>;
  }
  if (!g) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/library" className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Generation not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/library" className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <StatusPill status={g.status} />
      </div>

      <Card className="overflow-hidden">
        <div className="aspect-video w-full bg-black">
          {g.outputAsset ? (
            <video
              src={publicUrl(g.outputAsset.storageKey)}
              controls
              autoPlay
              loop
              className="h-full w-full"
            />
          ) : g.status === "failed" ? (
            <div className="grid h-full w-full place-items-center text-sm text-[var(--color-danger)]">
              {g.errorMessage || "Generation failed"}
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center gap-2 text-sm text-[var(--color-fg-muted)]">
              <div className="h-7 w-7 rounded-full border-2 border-[var(--color-accent-soft)] border-t-[var(--color-accent)] animate-spin" />
              <span>Generating…</span>
            </div>
          )}
        </div>
        <CardContent className="space-y-4 pt-4">
          {g.outputAsset && (
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{g.outputAsset.filename}</p>
              <Button asChild variant="secondary" size="sm">
                <a href={publicUrl(g.outputAsset.storageKey)} download>
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </Button>
            </div>
          )}
          {g.prompt && <p className="text-sm text-[var(--color-fg-muted)]">{g.prompt}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Source video</CardTitle><CardDescription>{relativeTime(g.sourceVideo?.createdAt)}</CardDescription></CardHeader>
          <CardContent>{g.sourceVideo && <MediaThumb asset={g.sourceVideo} />}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Reference image</CardTitle><CardDescription>{relativeTime(g.referenceImage?.createdAt)}</CardDescription></CardHeader>
          <CardContent>{g.referenceImage && <MediaThumb asset={g.referenceImage} />}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail k="Model" v={g.modelName} />
            <Detail k="Mode" v={g.mode} />
            <Detail k="Orientation" v={g.characterOrientation} />
            <Detail k="Output duration" v={formatDuration(g.outputAsset?.durationSec)} />
            <Detail k="Estimated cost" v={formatUsd(Number(g.estimatedCostUsd))} />
            <Detail k="Actual cost" v={g.actualCostUsd != null ? formatUsd(Number(g.actualCostUsd)) : "—"} />
            <Detail k="Final unit deduction" v={g.finalUnitDeduction ?? "—"} />
            <Detail k="External task ID" v={g.externalTaskId} mono />
            <Detail k="Provider task ID" v={g.providerTaskId ?? "—"} mono />
            <Detail k="Created" v={relativeTime(g.createdAt)} />
            <Detail k="Submitted" v={relativeTime(g.submittedAt)} />
            <Detail k="Completed" v={relativeTime(g.completedAt)} />
            {g.errorCode != null && <Detail k="Error code" v={String(g.errorCode)} />}
            {g.errorMessage && <Detail k="Error message" v={g.errorMessage} />}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-sm text-[var(--color-fg-muted)]">{k}</dt>
      <dd className={`text-sm text-right ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
