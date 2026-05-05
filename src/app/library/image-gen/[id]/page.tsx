"use client";

import * as React from "react";
import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatUsd, relativeTime } from "@/lib/utils";
import { publicUrl } from "@/components/MediaThumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/StatusPill";
import { MediaThumb } from "@/components/MediaThumb";

type Props = { params: Promise<{ id: string }> };

export default function ImageGenerationDetailPage({ params }: Props) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ["image-generation", id],
    queryFn: () => api.getImageGeneration(id),
    refetchInterval: ({ state }) => {
      const status = state.data?.imageGeneration.status;
      return status === "queued" || status === "processing" ? 4_000 : false;
    },
  });

  const g = q.data?.imageGeneration;

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="aspect-video rounded-[var(--radius-lg)] shimmer" />
      </div>
    );
  }
  if (!g) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/library" className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Image generation not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/library"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <StatusPill status={g.status} />
      </div>

      <Card className="overflow-hidden">
        <div className="relative w-full bg-black flex items-center justify-center min-h-[320px]">
          {g.outputAsset ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={publicUrl(g.outputAsset.storageKey)}
              alt={g.prompt ?? "generated image"}
              className="max-h-[80vh] w-auto"
            />
          ) : g.status === "failed" ? (
            <div className="grid h-full w-full place-items-center text-sm text-[var(--color-danger)] py-20">
              {g.errorMessage || "Generation failed"}
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center gap-2 text-sm text-[var(--color-fg-muted)] py-20">
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
          {g.negativePrompt && (
            <p className="text-sm text-[var(--color-fg-muted)]">
              <span className="text-[var(--color-fg-subtle)]">Negative: </span>
              {g.negativePrompt}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reference images</CardTitle>
          <CardDescription>
            {(g.subjectImages?.length ?? 0)} subject
            {(g.subjectImages?.length ?? 0) === 1 ? "" : "s"}
            {g.sceneImage ? " · 1 scene" : ""}
            {g.styleImage ? " · 1 style" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {g.subjectImages && g.subjectImages.length > 0 && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                Subjects
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {g.subjectImages.map((a) => (
                  <MediaThumb key={a.id} asset={a} />
                ))}
              </div>
            </div>
          )}
          {(g.sceneImage || g.styleImage) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {g.sceneImage && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                    Scene
                  </p>
                  <MediaThumb asset={g.sceneImage} />
                </div>
              )}
              {g.styleImage && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                    Style
                  </p>
                  <MediaThumb asset={g.styleImage} />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail k="Model" v={g.modelName} />
            <Detail k="Aspect ratio" v={g.aspectRatio ?? "—"} />
            <Detail k="Images requested" v={String(g.n ?? 1)} />
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
