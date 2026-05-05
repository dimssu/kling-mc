"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
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
  "kling-v2-6": 0.014,
  "kling-v3": 0.020,
};

type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export function CreateImageGenerationForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [referenceImage, setReferenceImage] = React.useState<MediaAsset | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [negativePrompt, setNegativePrompt] = React.useState("");
  const [modelName, setModelName] = React.useState<"kling-v2-6" | "kling-v3">("kling-v2-6");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("1:1");
  const [imageFidelity, setImageFidelity] = React.useState(0.5);

  const submit = useMutation({
    mutationFn: () => {
      if (!referenceImage) throw new Error("Reference image is required");
      return api.createImageGeneration({
        referenceImageId: referenceImage.id,
        prompt: prompt || undefined,
        negativePrompt: negativePrompt || undefined,
        modelName,
        imageFidelity,
        aspectRatio,
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

  const cost = IMAGE_PRICING[modelName] ?? 0;
  const ready = !!referenceImage && !submit.isPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>1 · Reference image</CardTitle>
            <CardDescription>The visual starting point. JPG/PNG, ≤ 10 MB.</CardDescription>
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
            <CardTitle>2 · Prompt</CardTitle>
            <CardDescription>
              Describe what you want. The reference image guides the composition; the prompt tunes the result.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Studio portrait, dramatic side lighting, 50mm lens, shallow depth of field"
                maxLength={2500}
                rows={3}
              />
              <p className="text-xs text-[var(--color-fg-subtle)]">{prompt.length}/2500</p>
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
            <CardTitle>3 · Options</CardTitle>
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
              <Label htmlFor="aspect">Aspect ratio</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                <SelectTrigger id="aspect"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1 — square</SelectItem>
                  <SelectItem value="16:9">16:9 — landscape</SelectItem>
                  <SelectItem value="9:16">9:16 — portrait</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                  <SelectItem value="3:4">3:4</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fidelity">
                Reference fidelity ({imageFidelity.toFixed(2)})
              </Label>
              <input
                id="fidelity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={imageFidelity}
                onChange={(e) => setImageFidelity(Number(e.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
              <p className="text-xs text-[var(--color-fg-subtle)]">
                0 = follow the prompt freely · 1 = stay very close to the reference image
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Estimated cost</CardTitle>
            <CardDescription>Per generated image at the {modelName} rate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight font-mono">
                {formatUsd(cost)}
              </span>
              <span className="text-xs text-[var(--color-fg-subtle)]">est.</span>
            </div>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={!ready}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {submit.isPending ? "Submitting…" : "Generate image"}
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
