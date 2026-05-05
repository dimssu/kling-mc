"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type MediaAsset } from "@/lib/api-client";
import { formatDuration, formatUsd } from "@/lib/utils";
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

const PRICING: Record<string, Record<string, number>> = {
  "kling-v2-6": { std: 0.20, pro: 0.33 },
  "kling-v3": { std: 0.375, pro: 0.50 },
};

function estimateCost(model: string, mode: string, durationSec: number) {
  const rate = PRICING[model]?.[mode] ?? 0;
  const sec = Math.max(1, Math.round(durationSec));
  return (sec / 5) * rate;
}

export function CreateGenerationForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [sourceVideo, setSourceVideo] = React.useState<MediaAsset | null>(null);
  const [referenceImage, setReferenceImage] = React.useState<MediaAsset | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [modelName, setModelName] = React.useState<"kling-v2-6" | "kling-v3">("kling-v2-6");
  const [mode, setMode] = React.useState<"std" | "pro">("std");
  const [characterOrientation, setCharacterOrientation] = React.useState<"image" | "video">("image");
  const [keepOriginalSound, setKeepOriginalSound] = React.useState(true);

  const submit = useMutation({
    mutationFn: () => {
      if (!sourceVideo || !referenceImage) throw new Error("Missing inputs");
      return api.createGeneration({
        sourceVideoId: sourceVideo.id,
        referenceImageId: referenceImage.id,
        prompt: prompt || undefined,
        modelName,
        mode,
        characterOrientation,
        keepOriginalSound,
        watermarkEnabled: false,
      });
    },
    onSuccess: ({ generation }) => {
      toast.success("Generation queued");
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
      router.push(`/library/${generation.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const cost = sourceVideo?.durationSec
    ? estimateCost(modelName, mode, sourceVideo.durationSec)
    : null;

  const ready = !!sourceVideo && !!referenceImage && !submit.isPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>1 · Source video</CardTitle>
            <CardDescription>The motion to copy. MP4/MOV, 3–30 s, ≤ 100 MB.</CardDescription>
          </CardHeader>
          <CardContent>
            <AssetSlot
              kind="source_video"
              accept="video/mp4,video/quicktime"
              asset={sourceVideo}
              onPick={setSourceVideo}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Reference image</CardTitle>
            <CardDescription>The person to use. JPG/PNG, ≤ 10 MB.</CardDescription>
          </CardHeader>
          <CardContent>
            <AssetSlot
              kind="reference_image"
              accept="image/png,image/jpeg"
              asset={referenceImage}
              onPick={setReferenceImage}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3 · Options</CardTitle>
            <CardDescription>
              Defaults are tuned for cost-effective testing.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <Select value={modelName} onValueChange={(v) => setModelName(v as typeof modelName)}>
                <SelectTrigger id="model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kling-v2-6">Kling v2.6</SelectItem>
                  <SelectItem value="kling-v3">Kling v3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger id="mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="std">Standard (cost-effective)</SelectItem>
                  <SelectItem value="pro">Professional (higher quality)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="orientation">Character orientation</Label>
              <Select value={characterOrientation} onValueChange={(v) => setCharacterOrientation(v as typeof characterOrientation)}>
                <SelectTrigger id="orientation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Match image (output ≤ 10 s)</SelectItem>
                  <SelectItem value="video">Match video (output ≤ 30 s)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-[var(--color-fg-subtle)]">
                {characterOrientation === "image"
                  ? "Source video must be ≤ 10 s in this mode."
                  : "Output orientation follows the source video."}
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="prompt">Prompt (optional)</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. The girl is wearing a loose gray T-shirt and denim shorts"
                maxLength={2500}
                rows={3}
              />
              <p className="text-xs text-[var(--color-fg-subtle)]">{prompt.length}/2500</p>
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={keepOriginalSound}
                onChange={(e) => setKeepOriginalSound(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Keep the original sound from the source video
            </label>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Estimated cost</CardTitle>
            <CardDescription>Based on the source video duration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight font-mono">
                {cost == null ? "—" : formatUsd(cost)}
              </span>
              <span className="text-xs text-[var(--color-fg-subtle)]">est.</span>
            </div>
            <dl className="space-y-1.5 text-sm">
              <Row k="Model" v={modelName} />
              <Row k="Mode" v={mode === "pro" ? "Professional" : "Standard"} />
              <Row k="Source duration" v={formatDuration(sourceVideo?.durationSec)} />
              <Row k="Rate" v={`${formatUsd(PRICING[modelName][mode])} / 5 s`} />
            </dl>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={!ready}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {submit.isPending ? "Submitting…" : "Generate"}
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

