"use client";

import * as React from "react";
import Link from "next/link";
import { use } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, type Carousel, type CarouselSlide } from "@/lib/api-client";
import { formatUsd, relativeTime } from "@/lib/utils";
import { publicUrl } from "@/components/MediaThumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/StatusPill";

type Props = { params: Promise<{ id: string }> };

export default function CarouselDetailPage({ params }: Props) {
  const { id } = use(params);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["carousel", id],
    queryFn: () => api.getCarousel(id),
    refetchInterval: ({ state }) => {
      const c = state.data?.carousel;
      if (!c) return 4_000;
      const allTerminal = c.slides.every(
        (s) => s.status === "completed" || s.status === "failed",
      );
      const captionPending = !c.caption && c.slides.some((s) => s.status === "completed");
      return allTerminal && !captionPending ? false : 4_000;
    },
  });

  const carousel = q.data?.carousel;

  const retry = useMutation({
    mutationFn: (slotIndex: number) => api.retryCarouselSlide(id, slotIndex),
    onSuccess: () => {
      toast.success("Slide re-queued");
      qc.invalidateQueries({ queryKey: ["carousel", id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="aspect-video rounded-[var(--radius-lg)] shimmer" />
      </div>
    );
  }
  if (!carousel) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/library" className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Carousel not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const completed = carousel.slides.filter((s) => s.status === "completed").length;
  const total = carousel.slides.length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/library"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <StatusPill status={carousel.status} />
      </div>

      <CarouselHeader carousel={carousel} completed={completed} total={total} />

      <SlidesGrid
        carousel={carousel}
        onRetry={(slot) => retry.mutate(slot)}
        retryingSlot={retry.isPending ? retry.variables : null}
      />

      <CarouselCaptionPanel carousel={carousel} />

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail k="Slides" v={String(carousel.n)} />
            <Detail k="Model" v={carousel.modelName} />
            <Detail k="Aspect ratio" v={carousel.aspectRatio ?? "—"} />
            <Detail k="Vibe" v={carousel.vibeLabel ?? "—"} />
            <Detail k="Theme" v={carousel.themePrompt ?? "(auto-pick)"} />
            <Detail k="Estimated cost" v={formatUsd(Number(carousel.estimatedCostUsd))} />
            <Detail k="Created" v={relativeTime(carousel.createdAt)} />
            <Detail k="Completed" v={relativeTime(carousel.completedAt)} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function CarouselHeader({
  carousel,
  completed,
  total,
}: {
  carousel: Carousel;
  completed: number;
  total: number;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
        {carousel.subjectImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={publicUrl(carousel.subjectImage.storageKey)}
            alt={carousel.subjectImage.filename}
            className="h-20 w-20 rounded-[var(--radius-md)] object-cover"
          />
        )}
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {carousel.vibeLabel ?? "Carousel"}
            </h2>
            {carousel.themePrompt && (
              <Badge tone="neutral">theme: {carousel.themePrompt}</Badge>
            )}
          </div>
          <p className="text-sm text-[var(--color-fg-muted)]">
            {completed} of {total} slides ready
            {carousel.status === "completed" && " — caption generated"}
            {carousel.status === "partial" && " — some slides failed"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SlidesGrid({
  carousel,
  onRetry,
  retryingSlot,
}: {
  carousel: Carousel;
  onRetry: (slotIndex: number) => void;
  retryingSlot: number | null | undefined;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {carousel.slides.map((slide) => (
        <SlideCard
          key={slide.id}
          slide={slide}
          onRetry={() =>
            slide.slotIndex != null ? onRetry(slide.slotIndex) : undefined
          }
          retrying={retryingSlot === slide.slotIndex}
        />
      ))}
    </div>
  );
}

function SlideCard({
  slide,
  onRetry,
  retrying,
}: {
  slide: CarouselSlide;
  onRetry: () => void;
  retrying: boolean;
}) {
  const url = slide.outputAsset ? publicUrl(slide.outputAsset.storageKey) : null;
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square w-full bg-[var(--color-bg)]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={slide.poseLabel ?? slide.prompt ?? "carousel slide"}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : slide.status === "failed" ? (
          <div className="absolute inset-0 grid place-items-center gap-2 px-4 text-center text-sm text-[var(--color-danger)]">
            <span>{slide.errorMessage || "Generation failed"}</span>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center gap-2 text-sm text-[var(--color-fg-muted)]">
            <div className="h-7 w-7 rounded-full border-2 border-[var(--color-accent-soft)] border-t-[var(--color-accent)] animate-spin" />
            <span>{slide.status === "processing" ? "Generating…" : "Queued…"}</span>
          </div>
        )}
        <div className="absolute left-2 top-2">
          <Badge tone="neutral">
            #{(slide.slotIndex ?? 0) + 1}
          </Badge>
        </div>
      </div>
      <CardContent className="space-y-2 py-3">
        <p className="text-sm font-medium">
          {slide.poseLabel ?? <span className="text-[var(--color-fg-subtle)]">—</span>}
        </p>
        <div className="flex items-center justify-between gap-2">
          <StatusPill status={slide.status} />
          {url && (
            <Button asChild variant="secondary" size="sm">
              <a href={url} download>
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </Button>
          )}
          {slide.status === "failed" && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={retrying}
              onClick={onRetry}
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CarouselCaptionPanel({ carousel }: { carousel: Carousel }) {
  const has = !!carousel.caption || (carousel.captionTags?.length ?? 0) > 0;
  const tagsString = (carousel.captionTags ?? []).map((t) => `#${t}`).join(" ");
  const pending =
    !has &&
    carousel.slides.some((s) => s.status === "completed") &&
    !carousel.slides.every(
      (s) => s.status === "completed" || s.status === "failed",
    );
  const captionWillGenerate =
    !has &&
    carousel.slides.some((s) => s.status === "completed") &&
    carousel.slides.every(
      (s) => s.status === "completed" || s.status === "failed",
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Caption pack</CardTitle>
        <CardDescription>
          {has
            ? "One caption written for the whole carousel."
            : pending
              ? "Will generate once all slides are done."
              : captionWillGenerate
                ? "Generating now…"
                : "Pending."}
        </CardDescription>
      </CardHeader>
      {has && (
        <CardContent className="space-y-4">
          <Field label="Caption" value={carousel.caption ?? ""} multiline />
          <Field label="Hashtags" value={tagsString} multiline copyValue={tagsString} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location" value={carousel.captionLocation ?? ""} />
            <Field
              label="Alt text"
              value={carousel.captionAccessibility ?? ""}
              multiline
              hint="Describes the carousel for screen readers"
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Field({
  label,
  value,
  multiline = false,
  copyValue,
  hint,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  copyValue?: string;
  hint?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = copyValue ?? value;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
          {label}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className={`rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm ${
          multiline ? "whitespace-pre-wrap" : "truncate"
        }`}
      >
        {value || <span className="text-[var(--color-fg-subtle)]">—</span>}
      </div>
      {hint && <p className="text-xs text-[var(--color-fg-subtle)]">{hint}</p>}
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
