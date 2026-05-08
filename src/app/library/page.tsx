"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type MediaAsset } from "@/lib/api-client";
import { formatBytes, formatDuration, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GenerationCard } from "@/components/GenerationCard";
import { VideoGenerationCard } from "@/components/VideoGenerationCard";
import { ImageGenerationCard } from "@/components/ImageGenerationCard";
import { MediaThumb } from "@/components/MediaThumb";

export default function LibraryPage() {
  const [tab, setTab] = React.useState("videos");
  const [favOnly, setFavOnly] = React.useState(false);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
          Everything you&apos;ve uploaded and generated.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="videos">Videos</TabsTrigger>
            <TabsTrigger value="images">Images</TabsTrigger>
            <TabsTrigger value="uploads">Uploads</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant={favOnly ? "default" : "secondary"}
          size="sm"
          onClick={() => setFavOnly((v) => !v)}
        >
          <Star className={`h-3.5 w-3.5 ${favOnly ? "fill-current" : ""}`} />
          {favOnly ? "Favorites only" : "Show favorites only"}
        </Button>
      </div>

      {tab === "videos" && <GenerationsTab favOnly={favOnly} />}
      {tab === "images" && <ImageGenerationsTab favOnly={favOnly} />}
      {tab === "uploads" && <UploadsTab favOnly={favOnly} />}
    </div>
  );
}

function ImageGenerationsTab({ favOnly }: { favOnly: boolean }) {
  const q = useQuery({
    queryKey: ["image-generations", { favorite: favOnly }],
    queryFn: () => api.listImageGenerations({ favorite: favOnly }),
    refetchInterval: 8_000,
  });

  if (q.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-video rounded-[var(--radius-lg)] shimmer" />
        ))}
      </div>
    );
  }

  if (!q.data?.items.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-bg-elev-2)]">
            <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
          </div>
          <p className="font-medium">No image generations</p>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Try the Image tab on the Create page.
          </p>
          <Button asChild>
            <Link href="/create">Create</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {q.data.items.map((g) => (
        <ImageGenerationCard key={g.id} gen={g} />
      ))}
    </div>
  );
}

function GenerationsTab({ favOnly }: { favOnly: boolean }) {
  const motion = useQuery({
    queryKey: ["generations", { favorite: favOnly }],
    queryFn: () => api.listGenerations({ favorite: favOnly }),
    refetchInterval: 8_000,
  });
  const fromImages = useQuery({
    queryKey: ["video-generations", { favorite: favOnly }],
    queryFn: () => api.listVideoGenerations({ favorite: favOnly }),
    refetchInterval: 8_000,
  });

  const isLoading = motion.isLoading || fromImages.isLoading;
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-video rounded-[var(--radius-lg)] shimmer" />
        ))}
      </div>
    );
  }

  // Merge the two lists by createdAt, newest first. We tag each row with a
  // `_kind` so the renderer picks the right card without re-fetching.
  type Row =
    | { _kind: "motion"; createdAt: string; data: NonNullable<typeof motion.data>["items"][number] }
    | { _kind: "from-images"; createdAt: string; data: NonNullable<typeof fromImages.data>["items"][number] };

  const rows: Row[] = [
    ...(motion.data?.items ?? []).map((g) => ({
      _kind: "motion" as const,
      createdAt: g.createdAt,
      data: g,
    })),
    ...(fromImages.data?.items ?? []).map((g) => ({
      _kind: "from-images" as const,
      createdAt: g.createdAt,
      data: g,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  if (!rows.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-bg-elev-2)]">
            <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
          </div>
          <p className="font-medium">No generations</p>
          <p className="text-sm text-[var(--color-fg-muted)]">Run your first one to see it here.</p>
          <Button asChild><Link href="/create">Create</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) =>
        r._kind === "motion" ? (
          <GenerationCard key={`m-${r.data.id}`} gen={r.data} />
        ) : (
          <VideoGenerationCard key={`v-${r.data.id}`} gen={r.data} />
        ),
      )}
    </div>
  );
}

function UploadsTab({ favOnly }: { favOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["assets", { favorite: favOnly }],
    queryFn: () => api.listAssets({ favorite: favOnly }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteAsset(id),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const fav = useMutation({
    mutationFn: (id: string) => api.toggleAssetFavorite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  if (q.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-video rounded-[var(--radius-lg)] shimmer" />
        ))}
      </div>
    );
  }

  if (!q.data?.items.length) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="font-medium">Nothing here yet</p>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Uploaded source videos and reference images will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {q.data.items.map((a) => (
        <UploadCard key={a.id} asset={a} onFav={() => fav.mutate(a.id)} onDelete={() => del.mutate(a.id)} />
      ))}
    </div>
  );
}

function UploadCard({
  asset,
  onFav,
  onDelete,
}: {
  asset: MediaAsset;
  onFav: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3">
      <MediaThumb asset={asset} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{asset.filename}</p>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {asset.kind === "reference_image" ? "Image" : asset.kind === "source_video" ? "Source" : "Output"}
            {" · "}
            {formatBytes(asset.sizeBytes)}
            {asset.durationSec != null && ` · ${formatDuration(asset.durationSec)}`}
          </p>
          <p className="text-xs text-[var(--color-fg-subtle)]">{relativeTime(asset.createdAt)}</p>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="icon" variant="ghost" aria-label="Favorite" onClick={onFav}>
            <Star className={`h-4 w-4 ${asset.isFavorite ? "fill-current text-[var(--color-warning)]" : ""}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Delete"
            onClick={() => {
              if (window.confirm("Delete this asset?")) onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
