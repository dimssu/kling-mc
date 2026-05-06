"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Sparkles } from "lucide-react";
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

type Endpoint = "multi-image2image" | "image2image";
type Model = "kling-v1" | "kling-v1-5" | "kling-v2" | "kling-v2-new" | "kling-v2-1";

const MODEL_PRICES: Record<Endpoint, Partial<Record<Model, { price: number; label: string }>>> = {
  "image2image": {
    "kling-v1":     { price: 0.0035, label: "Kling v1" },
    "kling-v1-5":   { price: 0.028,  label: "Kling v1.5" },
    "kling-v2":     { price: 0.028,  label: "Kling v2" },
    "kling-v2-new": { price: 0.028,  label: "Kling v2 (restyle)" },
    "kling-v2-1":   { price: 0.028,  label: "Kling v2.1" },
  },
  "multi-image2image": {
    "kling-v2":   { price: 0.056, label: "Kling v2" },
    "kling-v2-1": { price: 0.056, label: "Kling v2.1" },
  },
};

const REF_SUPPORTED: Model[] = ["kling-v1-5", "kling-v2-1"];

type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";

const MAX_SUBJECTS = 4;

export function CreateImageGenerationForm() {
  const router = useRouter();
  const qc = useQueryClient();

  // Subjects: ordered list, length 1..4. Initialise with one empty slot.
  const [subjects, setSubjects] = React.useState<Array<MediaAsset | null>>([null]);
  const [sceneImage, setSceneImage] = React.useState<MediaAsset | null>(null);
  const [styleImage, setStyleImage] = React.useState<MediaAsset | null>(null);

  const [prompt, setPrompt] = React.useState("");
  const [negativePrompt, setNegativePrompt] = React.useState("");
  const [endpoint, setEndpoint] = React.useState<Endpoint>("multi-image2image");
  const [modelName, setModelName] = React.useState<Model>("kling-v2-1");
  const [imageReference, setImageReference] = React.useState<"subject" | "face">("subject");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("16:9");
  const [n, setN] = React.useState(1);
  const [captionPackEnabled, setCaptionPackEnabled] = React.useState(true);
  const [recentCategories, setRecentCategories] = React.useState<string[]>([]);
  const [vibe, setVibe] = React.useState<string | null>(null);

  // Snap the selected model to one supported on the current endpoint.
  React.useEffect(() => {
    if (!MODEL_PRICES[endpoint][modelName]) {
      const first = Object.keys(MODEL_PRICES[endpoint])[0] as Model | undefined;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (first) setModelName(first);
    }
  }, [endpoint, modelName]);

  const suggest = useMutation({
    mutationFn: () =>
      api.suggestImagePrompt({
        // Avoid the last 3 categories so consecutive Suggest clicks roll a
        // visibly different vibe.
        avoidCategories: recentCategories.slice(-3),
      }),
    onSuccess: (s) => {
      setPrompt(s.prompt);
      if (s.negativePrompt) setNegativePrompt(s.negativePrompt);
      setVibe(`${s.categoryLabel} · ${s.vibe}`);
      setRecentCategories((prev) => [...prev, s.categoryKey].slice(-6));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const subjectsFilled = subjects.filter((s): s is MediaAsset => !!s);
  const totalRefs =
    subjectsFilled.length + (sceneImage ? 1 : 0) + (styleImage ? 1 : 0);

  const submit = useMutation({
    mutationFn: () => {
      if (endpoint === "multi-image2image" && totalRefs < 2) {
        throw new Error("Pick at least 2 reference images total.");
      }
      if (endpoint === "image2image" && subjectsFilled.length === 0) {
        throw new Error("Pick a subject image.");
      }
      if (endpoint === "image2image" && !prompt.trim()) {
        throw new Error("Single-image mode needs a prompt.");
      }
      return api.createImageGeneration({
        endpoint,
        subjectImageIds: subjectsFilled.map((s) => s.id),
        // Scene/style only apply on multi-image2image; drop them otherwise.
        sceneImageId: endpoint === "multi-image2image" ? sceneImage?.id : undefined,
        styleImageId: endpoint === "multi-image2image" ? styleImage?.id : undefined,
        prompt: prompt || undefined,
        negativePrompt: negativePrompt || undefined,
        modelName,
        imageReference:
          endpoint === "image2image" && REF_SUPPORTED.includes(modelName)
            ? imageReference
            : undefined,
        aspectRatio,
        n,
        captionPackEnabled,
      });
    },
    onSuccess: ({ imageGeneration }) => {
      toast.success("Image generation queued");
      qc.invalidateQueries({ queryKey: ["image-generations"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
      router.push(`/library/image-gen/${imageGeneration.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const ratePerImage = MODEL_PRICES[endpoint][modelName]?.price ?? 0;
  const cost = ratePerImage * n;
  const supportedModels = Object.keys(MODEL_PRICES[endpoint]) as Model[];
  const refsOk = endpoint === "multi-image2image" ? totalRefs >= 2 : subjectsFilled.length >= 1;
  const promptOk = endpoint === "image2image" ? prompt.trim().length > 0 : true;
  const ready = refsOk && promptOk && !submit.isPending;

  const setSubjectAt = (i: number, a: MediaAsset | null) => {
    setSubjects((prev) => {
      const next = [...prev];
      next[i] = a;
      // Trim trailing empty slots, keeping at least one.
      while (next.length > 1 && next[next.length - 1] === null) next.pop();
      return next;
    });
  };

  const addSubjectSlot = () => {
    if (subjects.length >= MAX_SUBJECTS) return;
    setSubjects((prev) => [...prev, null]);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>1 · Subject images</CardTitle>
            <CardDescription>
              Up to 4 images of your subject(s). Pre-crop them; the API doesn&apos;t crop.
              JPG/PNG, ≤ 10 MB each.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {subjects.map((s, i) => (
                <div key={i} className="space-y-1">
                  <Label className="text-xs text-[var(--color-fg-muted)]">
                    Subject {i + 1}
                  </Label>
                  <AssetSlot
                    kind="reference_image"
                    accept="image/png,image/jpeg"
                    asset={s}
                    onPick={(a) => setSubjectAt(i, a)}
                  />
                </div>
              ))}
            </div>
            {subjects.length < MAX_SUBJECTS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSubjectSlot}
                className="w-full"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another subject ({subjects.length}/{MAX_SUBJECTS})
              </Button>
            )}
          </CardContent>
        </Card>

        {endpoint === "multi-image2image" && (
          <Card>
            <CardHeader>
              <CardTitle>2 · Scene & style (optional)</CardTitle>
              <CardDescription>
                Multi-image mode needs <strong>at least 2 reference images total</strong>{" "}
                across subjects, scene, and style. Add a scene or style image here,
                or a second subject above.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-[var(--color-fg-muted)]">Scene image</Label>
                <AssetSlot
                  kind="reference_image"
                  accept="image/png,image/jpeg"
                  asset={sceneImage}
                  onPick={setSceneImage}
                  emptyHint="Optional · sets background / environment"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-[var(--color-fg-muted)]">Style image</Label>
                <AssetSlot
                  kind="reference_image"
                  accept="image/png,image/jpeg"
                  asset={styleImage}
                  onPick={setStyleImage}
                  emptyHint="Optional · sets aesthetic / look"
                />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>3 · Prompt</CardTitle>
            <CardDescription>
              Describe what you want. The reference images guide composition; the prompt tunes the result.
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
                  title="Generate a fresh on-brand prompt"
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
                placeholder="Click Suggest for an on-brand idea, or type your own."
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
                placeholder="e.g. blurry, low quality, deformed hands"
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
            <div className="space-y-1.5">
              <Label htmlFor="endpoint">Mode</Label>
              <Select value={endpoint} onValueChange={(v) => setEndpoint(v as Endpoint)}>
                <SelectTrigger id="endpoint"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="multi-image2image">Multi-image (≥2 refs)</SelectItem>
                  <SelectItem value="image2image">Single image + prompt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <Select value={modelName} onValueChange={(v) => setModelName(v as Model)}>
                <SelectTrigger id="model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {supportedModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODEL_PRICES[endpoint][m]!.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {endpoint === "image2image" && REF_SUPPORTED.includes(modelName) && (
              <div className="space-y-1.5">
                <Label htmlFor="ref">Reference focus</Label>
                <Select
                  value={imageReference}
                  onValueChange={(v) => setImageReference(v as "subject" | "face")}
                >
                  <SelectTrigger id="ref"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subject">Subject</SelectItem>
                    <SelectItem value="face">Face</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="aspect">Aspect ratio</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                <SelectTrigger id="aspect"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 — landscape</SelectItem>
                  <SelectItem value="9:16">9:16 — portrait</SelectItem>
                  <SelectItem value="1:1">1:1 — square</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                  <SelectItem value="3:4">3:4</SelectItem>
                  <SelectItem value="3:2">3:2</SelectItem>
                  <SelectItem value="2:3">2:3</SelectItem>
                  <SelectItem value="21:9">21:9 — ultrawide</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n">Number of images</Label>
              <Select value={String(n)} onValueChange={(v) => setN(Number(v))}>
                <SelectTrigger id="n"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => (
                    <SelectItem key={k} value={String(k)}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={captionPackEnabled}
                onChange={(e) => setCaptionPackEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>
                Generate a caption pack in Siya&apos;s voice
                <span className="ml-1 text-xs text-[var(--color-fg-subtle)]">
                  (caption · hashtags · location · alt text)
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
              {n} {n === 1 ? "image" : "images"} × {formatUsd(ratePerImage)} per image
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight font-mono">
                {formatUsd(cost)}
              </span>
              <span className="text-xs text-[var(--color-fg-subtle)]">est.</span>
            </div>
            <dl className="space-y-1.5 text-sm">
              <Row k="References" v={`${totalRefs} total`} />
              <Row k="Model" v={modelName} />
              <Row k="Aspect" v={aspectRatio} />
            </dl>
            {!refsOk && (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
                {endpoint === "multi-image2image"
                  ? "Need at least 2 reference images total (subject + scene/style or two subjects)."
                  : "Pick one subject image to continue."}
              </p>
            )}
            {endpoint === "image2image" && !promptOk && (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
                Single-image mode needs a prompt — type one or click Suggest.
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
              {submit.isPending ? "Submitting…" : `Generate ${n > 1 ? `${n} images` : "image"}`}
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
