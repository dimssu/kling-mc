"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, type MediaAsset } from "@/lib/api-client";
import { formatUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetSlot } from "@/components/AssetSlot";

type Mode = "std" | "pro";
type Duration = "5" | "10";
type AspectRatio = "16:9" | "9:16" | "1:1";

const PRICING_PER_5S: Record<Mode, number> = {
  std: 0.28,
  pro: 0.49,
};

const UNITS_PER_5S: Record<Mode, number> = {
  std: 2,
  pro: 3.5,
};

const MAX_IMAGES = 4;

function estimateCost(mode: Mode, duration: Duration) {
  const rate = PRICING_PER_5S[mode];
  return (Number(duration) / 5) * rate;
}

function estimateUnits(mode: Mode, duration: Duration) {
  return (Number(duration) / 5) * UNITS_PER_5S[mode];
}

function formatUnits(n: number) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

export function CreateVideoFromImagesForm() {
  const router = useRouter();
  const qc = useQueryClient();

  const [images, setImages] = React.useState<Array<MediaAsset | null>>([null]);
  const [prompt, setPrompt] = React.useState("");
  const [negativePrompt, setNegativePrompt] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("std");
  const [duration, setDuration] = React.useState<Duration>("5");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("16:9");

  const filled = images.filter((x): x is MediaAsset => !!x);

  const setImageAt = (i: number, a: MediaAsset | null) => {
    setImages((prev) => {
      const next = [...prev];
      next[i] = a;
      while (next.length > 1 && next[next.length - 1] === null) next.pop();
      return next;
    });
  };

  const addImageSlot = () => {
    if (images.length >= MAX_IMAGES) return;
    setImages((prev) => [...prev, null]);
  };

  const submit = useMutation({
    mutationFn: () => {
      if (filled.length === 0) throw new Error("Pick at least one reference image.");
      if (!prompt.trim()) throw new Error("Prompt is required.");
      return api.createVideoGeneration({
        imageIds: filled.map((a) => a.id),
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        modelName: "kling-v1-6",
        mode,
        duration,
        aspectRatio,
      });
    },
    onSuccess: ({ videoGeneration }) => {
      toast.success("Video generation queued");
      qc.invalidateQueries({ queryKey: ["video-generations"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
      router.push(`/library/video-from-images/${videoGeneration.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cost = estimateCost(mode, duration);
  const units = estimateUnits(mode, duration);
  const ready = filled.length >= 1 && prompt.trim().length > 0 && !submit.isPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>1 · Reference images</CardTitle>
            <CardDescription>
              Up to 4 images of subjects/elements. JPG/PNG, ≤ 10 MB each. Pre-crop them;
              the API doesn&apos;t crop.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {images.map((s, i) => (
                <div key={i} className="space-y-1">
                  <Label className="text-xs text-[var(--color-fg-muted)]">
                    Image {i + 1}
                  </Label>
                  <AssetSlot
                    kind="reference_image"
                    accept="image/png,image/jpeg"
                    asset={s}
                    onPick={(a) => setImageAt(i, a)}
                  />
                </div>
              ))}
            </div>
            {images.length < MAX_IMAGES && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addImageSlot}
                className="w-full"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another image ({images.length}/{MAX_IMAGES})
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Prompt</CardTitle>
            <CardDescription>
              Describe the scene or motion you want. Required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A white Bichon Frise wearing a red floral cotton jacket, licking its paw"
                maxLength={2500}
                rows={4}
              />
              <p className="text-xs text-[var(--color-fg-subtle)]">{prompt.length}/2500</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="neg-prompt">Negative prompt (optional)</Label>
              <Textarea
                id="neg-prompt"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="e.g. blurry, low quality, deformed"
                maxLength={2500}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3 · Options</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger id="mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="std">Standard (cost-effective)</SelectItem>
                  <SelectItem value="pro">Professional (higher quality)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="duration">Duration</Label>
              <Select value={duration} onValueChange={(v) => setDuration(v as Duration)}>
                <SelectTrigger id="duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 seconds</SelectItem>
                  <SelectItem value="10">10 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aspect">Aspect ratio</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                <SelectTrigger id="aspect"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 — landscape</SelectItem>
                  <SelectItem value="9:16">9:16 — portrait</SelectItem>
                  <SelectItem value="1:1">1:1 — square</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Estimated cost</CardTitle>
            <CardDescription>
              {duration} s × {UNITS_PER_5S[mode]} units per 5 s ({formatUsd(PRICING_PER_5S[mode])})
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight font-mono">
                {formatUnits(units)}
              </span>
              <span className="text-sm text-[var(--color-fg-muted)]">units</span>
              <span className="ml-1 text-xs text-[var(--color-fg-subtle)]">
                · {formatUsd(cost)} est.
              </span>
            </div>
            <dl className="space-y-1.5 text-sm">
              <Row k="Model" v="kling-v1-6" />
              <Row k="Mode" v={mode === "pro" ? "Professional" : "Standard"} />
              <Row k="Images" v={`${filled.length}/${MAX_IMAGES}`} />
              <Row k="Aspect" v={aspectRatio} />
              <Row k="Units" v={formatUnits(units)} />
            </dl>
            {filled.length === 0 && (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
                Pick at least one reference image to continue.
              </p>
            )}
            {filled.length >= 1 && !prompt.trim() && (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
                A prompt is required.
              </p>
            )}
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={!ready}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {submit.isPending ? "Submitting…" : "Generate video"}
            </Button>
            <p className="text-xs text-[var(--color-fg-subtle)]">
              Actual cost may differ; we record Kling&apos;s reported deduction on completion.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--color-fg-muted)]">{k}</dt>
      <dd className="text-right text-[var(--color-fg)] font-mono">{v}</dd>
    </div>
  );
}
