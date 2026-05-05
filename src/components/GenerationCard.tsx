"use client";

import Link from "next/link";
import { Star, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Generation } from "@/lib/api-client";
import { formatUsd, relativeTime } from "@/lib/utils";
import { StatusPill } from "@/components/StatusPill";
import { MediaThumb } from "@/components/MediaThumb";
import { Button } from "@/components/ui/button";

export function GenerationCard({ gen }: { gen: Generation }) {
  const qc = useQueryClient();

  const fav = useMutation({
    mutationFn: () => api.toggleGenerationFavorite(gen.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generations"] }),
  });

  const del = useMutation({
    mutationFn: () => api.deleteGeneration(gen.id),
    onSuccess: () => {
      toast.success("Generation deleted");
      qc.invalidateQueries({ queryKey: ["generations"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const display = gen.outputAsset ?? gen.sourceVideo;

  return (
    <div className="group relative flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 transition-colors hover:border-[var(--color-border-strong)]">
      <Link href={`/library/${gen.id}`} className="contents">
        {display ? (
          <MediaThumb asset={display} />
        ) : (
          <div className="aspect-video w-full rounded-[var(--radius-md)] shimmer" />
        )}
      </Link>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Link href={`/library/${gen.id}`} className="block truncate text-sm font-medium hover:underline">
            {gen.prompt || `${gen.modelName} · ${gen.mode}`}
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
          <Star className={`h-4 w-4 ${gen.isFavorite ? "fill-current text-[var(--color-warning)]" : ""}`} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Delete"
          onClick={() => {
            if (window.confirm("Delete this generation? This also removes any generated video.")) {
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
