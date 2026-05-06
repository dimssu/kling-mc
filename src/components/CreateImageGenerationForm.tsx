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

const IMAGE_PRICING: Record<string, number> = {
  "kling-v2": 0.014,
  "kling-v2-1": 0.020,
};

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
  const [modelName, setModelName] = React.useState<"kling-v2" | "kling-v2-1">("kling-v2-1");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("16:9");
  const [n, setN] = React.useState(1);
  const [captionPackEnabled, setCaptionPackEnabled] = React.useState(true);
  const [recentCategories, setRecentCategories] = React.useState<string[]>([]);
  const [vibe, setVibe] = React.useState<string | null>(null);

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
      if (totalRefs < 2) throw new Error("Pick at least 2 reference images total.");
      return api.createImageGeneration({
        subjectImageIds: subjectsFilled.map((s) => s.id),
        sceneImageId: sceneImage?.id,
        styleImageId: styleImage?.id,
        prompt: prompt || undefined,
        negativePrompt: negativePrompt || undefined,
        modelName,
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

  const ratePerImage = IMAGE_PRICING[modelName] ?? 0;
  const cost = ratePerImage * n;
  const ready = totalRefs >= 2 && !submit.isPending;

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

        <Card>
          <CardHeader>
            <CardTitle>2 · Scene & style (optional)</CardTitle>
            <CardDescription>
              Kling needs <strong>at least 2 reference images total</strong> across
              subjects, scene, and style. Add a scene or style image here, or a
              second subject above.
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
              <Label htmlFor="model">Model</Label>
              <Select value={modelName} onValueChange={(v) => setModelName(v as typeof modelName)}>
                <SelectTrigger id="model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kling-v2">Kling v2</SelectItem>
                  <SelectItem value="kling-v2-1">Kling v2.1</SelectItem>
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
            {totalRefs < 2 && (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
                Need at least 2 reference images total (subject + scene/style or two subjects).
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
