"use client";

import Link from "next/link";
import { Star, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ImageGeneration } from "@/lib/api-client";
import { formatUsd, relativeTime } from "@/lib/utils";
import { StatusPill } from "@/components/StatusPill";
import { MediaThumb } from "@/components/MediaThumb";
import { Button } from "@/components/ui/button";

export function ImageGenerationCard({ gen }: { gen: ImageGeneration }) {
  const qc = useQueryClient();

  const fav = useMutation({
    mutationFn: () => api.toggleImageGenerationFavorite(gen.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["image-generations"] }),
  });

  const del = useMutation({
    mutationFn: () => api.deleteImageGeneration(gen.id),
    onSuccess: () => {
      toast.success("Image generation deleted");
      qc.invalidateQueries({ queryKey: ["image-generations"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // The list endpoint doesn't include subjectImages (only the GET-by-id does),
  // so before completion the card may not have a thumbnail to show — that's OK,
  // the shimmer placeholder takes over.
  const display = gen.outputAsset ?? gen.subjectImages?.[0] ?? gen.sceneImage ?? gen.styleImage ?? null;

  return (
    <div className="group relative flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 transition-colors hover:border-[var(--color-border-strong)]">
      <Link href={`/library/image-gen/${gen.id}`} className="contents">
        {display ? (
          <MediaThumb asset={display} />
        ) : (
          <div className="aspect-video w-full rounded-[var(--radius-md)] shimmer" />
        )}
      </Link>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/library/image-gen/${gen.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {gen.prompt || `${gen.modelName} · image`}
          </Link>
          <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
            <StatusPill status={gen.status} />
            <span>{relativeTime(gen.createdAt)}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-mono">
            {gen.actualCostUsd != null
              ? formatUsd(Number(gen.actualCostUsd))
              : `~${formatUsd(Number(gen.estimatedCostUsd))}`}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button size="icon" variant="ghost" aria-label="Favorite" onClick={() => fav.mutate()}>
          <Star
            className={`h-4 w-4 ${gen.isFavorite ? "fill-current text-[var(--color-warning)]" : ""}`}
          />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Delete"
          onClick={() => {
            if (window.confirm("Delete this image generation? This also removes the generated image.")) {
              del.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
