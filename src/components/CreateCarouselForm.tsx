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

type Endpoint = "multi-image2image" | "image2image";
type Model = "kling-v1" | "kling-v1-5" | "kling-v2" | "kling-v2-new" | "kling-v2-1";

// Mirror of src/lib/kling/models.ts. Kept here as plain data so the client
// bundle doesn't import the registry (which is fine to import — but a small
// duplication keeps the dropdown rendering pure-string and avoids a server-
// only import showing up in client output).
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

const N_OPTIONS = [4, 5, 6, 7, 8, 9, 10] as const;

export function CreateCarouselForm() {
  const router = useRouter();
  const qc = useQueryClient();

  const [subject, setSubject] = React.useState<MediaAsset | null>(null);
  const [n, setN] = React.useState<number>(6);
  const [themePrompt, setThemePrompt] = React.useState("");
  const [endpoint, setEndpoint] = React.useState<Endpoint>("image2image");
  const [modelName, setModelName] = React.useState<Model>("kling-v2-1");
  const [imageReference, setImageReference] = React.useState<"subject" | "face">("subject");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("9:16");

  // When the user switches endpoint, snap the model to one supported on it.
  React.useEffect(() => {
    if (!MODEL_PRICES[endpoint][modelName]) {
      const first = Object.keys(MODEL_PRICES[endpoint])[0] as Model | undefined;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (first) setModelName(first);
    }
  }, [endpoint, modelName]);

  const submit = useMutation({
    mutationFn: () => {
      if (!subject) throw new Error("Pick a subject image first.");
      return api.createCarousel({
        subjectImageId: subject.id,
        n,
        themePrompt: themePrompt.trim() || undefined,
        endpoint,
        modelName,
        imageReference: REF_SUPPORTED.includes(modelName) ? imageReference : undefined,
        aspectRatio,
      });
    },
    onSuccess: ({ carousel }) => {
      toast.success(`Carousel queued — ${carousel.n} slides being planned`);
      qc.invalidateQueries({ queryKey: ["carousels"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
      router.push(`/library/carousel/${carousel.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const ratePerImage = MODEL_PRICES[endpoint][modelName]?.price ?? 0;
  const cost = ratePerImage * n;
  const ready = !!subject && !submit.isPending;
  const supportedModels = Object.keys(MODEL_PRICES[endpoint]) as Model[];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>1 · Subject image</CardTitle>
            <CardDescription>
              One photo of your subject. Each slide will be a different
              pose/expression of the same person, in the same outfit and lighting.
              JPG/PNG, ≤ 10 MB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssetSlot
              kind="reference_image"
              accept="image/png,image/jpeg"
              asset={subject}
              onPick={setSubject}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Theme (optional)</CardTitle>
            <CardDescription>
              Leave blank and we&apos;ll pick a vibe at random. Or pin one — e.g.
              &ldquo;minimalist editorial in beige tones&rdquo; — and every slide
              will share that wardrobe / lighting / setting and only vary the pose.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              id="theme"
              value={themePrompt}
              onChange={(e) => setThemePrompt(e.target.value)}
              placeholder="e.g. rooftop golden hour, beige editorial, soft natural light"
              maxLength={500}
              rows={3}
            />
            <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
              {themePrompt.length}/500
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3 · Options</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="n">Slides</Label>
              <Select value={String(n)} onValueChange={(v) => setN(Number(v))}>
                <SelectTrigger id="n"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {N_OPTIONS.map((k) => (
                    <SelectItem key={k} value={String(k)}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endpoint">Mode</Label>
              <Select value={endpoint} onValueChange={(v) => setEndpoint(v as Endpoint)}>
                <SelectTrigger id="endpoint"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image2image">Single image</SelectItem>
                  <SelectItem value="multi-image2image">Multi-image</SelectItem>
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
            {REF_SUPPORTED.includes(modelName) && endpoint === "image2image" && (
              <div className="space-y-1.5">
                <Label htmlFor="ref">Reference focus</Label>
                <Select
                  value={imageReference}
                  onValueChange={(v) => setImageReference(v as "subject" | "face")}
                >
                  <SelectTrigger id="ref"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subject">Subject (full body / outfit)</SelectItem>
                    <SelectItem value="face">Face (likeness)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="aspect">Aspect ratio</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                <SelectTrigger id="aspect"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 — portrait</SelectItem>
                  <SelectItem value="1:1">1:1 — square</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                  <SelectItem value="3:4">3:4</SelectItem>
                  <SelectItem value="16:9">16:9 — landscape</SelectItem>
                  <SelectItem value="3:2">3:2</SelectItem>
                  <SelectItem value="2:3">2:3</SelectItem>
                  <SelectItem value="21:9">21:9 — ultrawide</SelectItem>
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
              {n} slides × {formatUsd(ratePerImage)} per slide
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
              <Row k="Slides" v={String(n)} />
              <Row k="Model" v={modelName} />
              <Row k="Aspect" v={aspectRatio} />
              <Row k="Theme" v={themePrompt.trim() ? "custom" : "auto-pick"} />
            </dl>
            {!subject && (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
                Upload a subject image to continue.
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
              {submit.isPending ? "Planning…" : `Generate ${n}-slide carousel`}
            </Button>
            <p className="text-xs text-[var(--color-fg-subtle)]">
              We&apos;ll plan {n} different poses with the LLM, then queue {n}{" "}
              image-to-image jobs and a unified caption.
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
