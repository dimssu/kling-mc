"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, type MediaAsset } from "@/lib/api-client";
import { formatBytes, formatDuration, formatUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaThumb } from "@/components/MediaThumb";

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

type AssetSlotProps = {
  kind: "source_video" | "reference_image";
  accept: string;
  asset: MediaAsset | null;
  onPick: (a: MediaAsset | null) => void;
};

function AssetSlot({ kind, accept, asset, onPick }: AssetSlotProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: existing } = useQuery({
    queryKey: ["assets", kind],
    queryFn: () => api.listAssets({ kind }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadAsset(file, kind),
    onSuccess: ({ asset: a }) => {
      qc.invalidateQueries({ queryKey: ["assets", kind] });
      onPick(a);
      toast.success("Uploaded");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (asset) {
    return (
      <div className="space-y-3">
        <div className="relative">
          <MediaThumb asset={asset} />
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onPick(null)}
            className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white hover:bg-black/90"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-xs text-[var(--color-fg-muted)] flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-[var(--color-fg)]">{asset.filename}</span>
          <span>{formatBytes(asset.sizeBytes)}</span>
          {asset.durationSec != null && <span>{formatDuration(asset.durationSec)}</span>}
          {asset.width && asset.height && <span>{asset.width}×{asset.height}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="group flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg)] p-8 text-sm text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-fg)] disabled:opacity-50"
      >
        {upload.isPending ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          <Upload className="h-6 w-6 transition-transform group-hover:-translate-y-0.5" />
        )}
        <span>{upload.isPending ? "Uploading…" : "Click to upload"}</span>
        <span className="text-xs text-[var(--color-fg-subtle)]">
          {kind === "source_video" ? "MP4/MOV up to 100 MB" : "JPG/PNG up to 10 MB"}
        </span>
      </button>
      <Input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />

      {existing && existing.items.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            Or pick from {existing.items.length} previous upload{existing.items.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {existing.items.slice(0, 8).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onPick(a)}
                className="text-left transition-transform hover:scale-[1.02]"
              >
                <MediaThumb asset={a} />
                <p className="mt-1 truncate text-xs text-[var(--color-fg-muted)]">{a.filename}</p>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
