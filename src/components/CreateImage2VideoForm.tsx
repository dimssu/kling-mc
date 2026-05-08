"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
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

type Model =
  | "kling-v1"
  | "kling-v1-5"
  | "kling-v1-6"
  | "kling-v2-1"
  | "kling-v2-5-turbo"
  | "kling-v2-6";
type Mode = "std" | "pro";
type Duration = "5" | "10";
type AspectRatio = "16:9" | "9:16" | "1:1";

const MODEL_LABELS: Record<Model, string> = {
  "kling-v1": "Kling V1",
  "kling-v1-5": "Kling V1.5",
  "kling-v1-6": "Kling V1.6",
  "kling-v2-1": "Kling V2.1",
  "kling-v2-5-turbo": "Kling V2.5 Turbo",
  "kling-v2-6": "Kling V2.6",
};

// USD per 5 s, mirrors lib/kling/pricing.ts.
const PRICING_PER_5S: Record<Model, Record<Mode, number>> = {
  "kling-v1": { std: 0.14, pro: 0.49 },
  "kling-v1-5": { std: 0.28, pro: 0.49 },
  "kling-v1-6": { std: 0.28, pro: 0.49 },
  "kling-v2-1": { std: 0.28, pro: 0.49 },
  "kling-v2-5-turbo": { std: 0.21, pro: 0.35 },
  "kling-v2-6": { std: 0.21, pro: 0.35 },
};

const UNITS_PER_5S: Record<Model, Record<Mode, number>> = {
  "kling-v1": { std: 1, pro: 3.5 },
  "kling-v1-5": { std: 2, pro: 3.5 },
  "kling-v1-6": { std: 2, pro: 3.5 },
  "kling-v2-1": { std: 2, pro: 3.5 },
  "kling-v2-5-turbo": { std: 1.5, pro: 2.5 },
  "kling-v2-6": { std: 1.5, pro: 2.5 },
};

function multiplier(duration: Duration) {
  return Number(duration) / 5;
}

function formatUnits(n: number) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

export function CreateImage2VideoForm() {
  const router = useRouter();
  const qc = useQueryClient();

  const [startImage, setStartImage] = React.useState<MediaAsset | null>(null);
  const [tailImage, setTailImage] = React.useState<MediaAsset | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [negativePrompt, setNegativePrompt] = React.useState("");
  const [modelName, setModelName] = React.useState<Model>("kling-v2-6");
  const [mode, setMode] = React.useState<Mode>("std");
  const [duration, setDuration] = React.useState<Duration>("5");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("16:9");
  const [cfgScale, setCfgScale] = React.useState<number | null>(null);
  const [vibe, setVibe] = React.useState<string | null>(null);

  const suggest = useMutation({
    mutationFn: () => api.suggestVideoPrompt(),
    onSuccess: (s) => {
      setPrompt(s.prompt);
      setNegativePrompt(s.negativePrompt);
      setVibe(s.vibe || null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = useMutation({
    mutationFn: () => {
      if (!startImage) throw new Error("Pick a start image.");
      return api.createVideoGeneration({
        endpoint: "image2video",
        imageId: startImage.id,
        tailImageId: tailImage?.id,
        prompt: prompt.trim() || undefined,
        negativePrompt: negativePrompt.trim() || undefined,
        modelName,
        mode,
        duration,
        aspectRatio,
        cfgScale: cfgScale ?? undefined,
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

  const usdRate = PRICING_PER_5S[modelName][mode];
  const unitsRate = UNITS_PER_5S[modelName][mode];
  const cost = usdRate * multiplier(duration);
  const units = unitsRate * multiplier(duration);
  const ready = !!startImage && !submit.isPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>1 · Start image</CardTitle>
            <CardDescription>
              The first frame of the video. JPG/PNG, ≤ 10 MB. Pre-crop; the API doesn&apos;t crop.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssetSlot
              kind="reference_image"
              accept="image/png,image/jpeg"
              asset={startImage}
              onPick={setStartImage}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · End frame (optional)</CardTitle>
            <CardDescription>
              If supplied, the model transitions from the start image to this end frame.
              Same format/size limits as the start image.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssetSlot
              kind="reference_image"
              accept="image/png,image/jpeg"
              asset={tailImage}
              onPick={setTailImage}
              emptyHint="Optional — sets the last frame"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3 · Prompt</CardTitle>
            <CardDescription>
              Optional but strongly recommended. Tells the model what motion / style to produce.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="prompt">Prompt</Label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => suggest.mutate()}
                  disabled={suggest.isPending}
                  title="AI-fill positive + negative prompts for a gentle single-image-to-video clip"
                >
                  {suggest.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Suggest
                </Button>
              </div>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setVibe(null);
                }}
                placeholder="Click Suggest for an AI-written gentle motion prompt, or type your own."
                maxLength={2500}
                rows={4}
              />
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-subtle)]">
                <span>{prompt.length}/2500</span>
                {vibe && <span className="italic">vibe: {vibe}</span>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="neg-prompt">Negative prompt (optional)</Label>
              <Textarea
                id="neg-prompt"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="e.g. blurry, low quality, deformed, jitter"
                maxLength={2500}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4 · Options</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="model">Model</Label>
              <Select value={modelName} onValueChange={(v) => setModelName(v as Model)}>
                <SelectTrigger id="model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODEL_LABELS) as Model[]).map((m) => (
                    <SelectItem key={m} value={m}>{MODEL_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger id="mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="std">Standard</SelectItem>
                  <SelectItem value="pro">Professional</SelectItem>
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
            <div className="space-y-1.5">
              <Label htmlFor="cfg">CFG scale (optional)</Label>
              <Select
                value={cfgScale == null ? "auto" : String(cfgScale)}
                onValueChange={(v) => setCfgScale(v === "auto" ? null : Number(v))}
              >
                <SelectTrigger id="cfg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Kling default)</SelectItem>
                  <SelectItem value="0.3">0.3 — looser</SelectItem>
                  <SelectItem value="0.5">0.5 — balanced</SelectItem>
                  <SelectItem value="0.7">0.7 — strict</SelectItem>
                  <SelectItem value="1">1.0 — strictest</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-[var(--color-fg-subtle)]">
                Higher = follows prompt more strictly.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Estimated cost</CardTitle>
            <CardDescription>
              {duration} s × {unitsRate} units per 5 s ({formatUsd(usdRate)})
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
              <Row k="Model" v={MODEL_LABELS[modelName]} />
              <Row k="Mode" v={mode === "pro" ? "Professional" : "Standard"} />
              <Row k="Duration" v={`${duration} s`} />
              <Row k="Aspect" v={aspectRatio} />
              <Row k="End frame" v={tailImage ? "yes" : "—"} />
            </dl>
            {!startImage && (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
                Pick a start image to continue.
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
