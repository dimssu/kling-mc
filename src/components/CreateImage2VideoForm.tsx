"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
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

/** Kling supports native audio only on V2.6 + Pro. Doubles the rate. */
function audioSupported(model: Model, mode: Mode): boolean {
  return model === "kling-v2-6" && mode === "pro";
}

// Standard starting prompt for single-image-to-video. Pre-filled on mount;
// users edit it to taste. Tuned for a confident, flirty, magnetic clip —
// stays spicy without naming anatomy (Kling's risk-control filter rejects
// explicit body-part wording, so we lean on outfit / motion / lighting /
// camera language to carry the vibe).
const DEFAULT_PROMPT = `An ultra-realistic, cinematic video of the exact same woman from the reference image. She is confidently engaging with the camera — speaking softly with a flirty, slightly mysterious smile, a playful lip bite, and magnetic eye contact mixed with teasing glances away. She moves with slow, deliberate confidence: subtle hip sway, gentle shoulder roll, a hypnotic rhythm that flatters her silhouette.

She wears a form-fitting, figure-hugging outfit that drapes elegantly over her frame. As she moves, the fabric shifts naturally, catching the warm light along every line of her shape. She lightly adjusts the line of her dress, runs her fingertips slowly along her waist, smooths the fabric — confident, teasing gestures that read as effortlessly sensual.

The camera glides along her silhouette with smooth, deliberate motion — slow cinematic dolly-ins and gentle orbiting shots that find her most flattering angles. Golden-hour or soft warm cinematic lighting sculpts her figure with creamy shallow depth of field, ultra-realistic skin texture with subtle natural imperfections, and a soft rim light along her jaw and shoulders. Hair drifts in a light breeze. Smooth, lifelike motion with realistic fabric physics throughout.

The overall mood is confidently flirty, magnetic, scroll-stopping — magazine-cover sensuality, pure Instagram-reel fantasy, more about energy and presence than overt display.

IMPORTANT: Use the reference image as the exact starting frame. The woman must be 100% identical in face, identity, hair, body type, proportions, figure, and skin tone throughout the entire video. Maintain perfect face and body consistency. Animate only natural, realistic movements. Keep the video smooth, high-quality, and photorealistic.`;

const DEFAULT_NEGATIVE_PROMPT = `jitter, stutter, jerky motion, frame skips, morphing face, identity drift, face change, body change, deformed hands, extra fingers, missing fingers, melted features, plastic skin, oversharpened, oversaturated, harsh lighting, blown highlights, scene change, fast cuts, walking out of frame, multiple people, duplicate person, extra limbs, low quality, blurry, pixelated, watermark, text, logo, captions, ugly, distorted body`;

export function CreateImage2VideoForm() {
  const router = useRouter();
  const qc = useQueryClient();

  const [startImage, setStartImage] = React.useState<MediaAsset | null>(null);
  const [tailImage, setTailImage] = React.useState<MediaAsset | null>(null);
  const [prompt, setPrompt] = React.useState(DEFAULT_PROMPT);
  const [negativePrompt, setNegativePrompt] = React.useState(DEFAULT_NEGATIVE_PROMPT);
  const [modelName, setModelName] = React.useState<Model>("kling-v2-6");
  const [mode, setMode] = React.useState<Mode>("std");
  const [duration, setDuration] = React.useState<Duration>("5");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("16:9");
  const [cfgScale, setCfgScale] = React.useState<number | null>(null);
  const [enableAudio, setEnableAudio] = React.useState(false);

  const canUseAudio = audioSupported(modelName, mode) && !tailImage;
  // Auto-clear the audio toggle whenever the model/mode/tail combo makes it
  // unavailable, so we don't silently submit a stale `true`.
  React.useEffect(() => {
    if (enableAudio && !canUseAudio) setEnableAudio(false);
  }, [canUseAudio, enableAudio]);

  const resetToDefault = () => {
    setPrompt(DEFAULT_PROMPT);
    setNegativePrompt(DEFAULT_NEGATIVE_PROMPT);
  };

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
        enableAudio: enableAudio && canUseAudio ? true : undefined,
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

  const audioOn = enableAudio && canUseAudio;
  const audioMult = audioOn ? 2 : 1;
  const usdRate = PRICING_PER_5S[modelName][mode] * audioMult;
  const unitsRate = UNITS_PER_5S[modelName][mode] * audioMult;
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
                  onClick={resetToDefault}
                  title="Restore the default starter prompt"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the motion. The default starter is pre-filled — tweak as needed."
                maxLength={2500}
                rows={10}
              />
              <p className="text-xs text-[var(--color-fg-subtle)]">{prompt.length}/2500</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="neg-prompt">Negative prompt (optional)</Label>
              <Textarea
                id="neg-prompt"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="Failure modes to suppress — pre-filled with the standard list."
                maxLength={2500}
                rows={4}
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
            <label
              className={`flex items-start gap-2 text-sm sm:col-span-3 ${
                canUseAudio ? "" : "opacity-60"
              }`}
              title={
                canUseAudio
                  ? "Kling V2.6 Pro will generate a natively-synced audio track. Doubles the cost."
                  : tailImage
                    ? "Audio cannot be combined with an end-frame image."
                    : "Native audio is only supported on Kling V2.6 in Pro mode."
              }
            >
              <input
                type="checkbox"
                checked={enableAudio && canUseAudio}
                disabled={!canUseAudio}
                onChange={(e) => setEnableAudio(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>
                Generate audio (V2.6 + Pro)
                <span className="ml-1 text-xs text-[var(--color-fg-subtle)]">
                  {canUseAudio
                    ? "doubles the rate · adds a synced native audio track"
                    : tailImage
                      ? "unavailable — remove the end frame to enable"
                      : "switch to V2.6 + Pro to enable"}
                </span>
              </span>
            </label>
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
              <Row k="Audio" v={audioOn ? "yes (2×)" : "—"} />
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
