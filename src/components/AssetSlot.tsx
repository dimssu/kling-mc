"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  DuplicateUploadError,
  type DuplicateKind,
  type MediaAsset,
} from "@/lib/api-client";
import { formatBytes, formatDuration, relativeTime } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/MediaThumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AssetKind = "source_video" | "reference_image";

export type AssetSlotProps = {
  kind: AssetKind;
  accept: string;
  asset: MediaAsset | null;
  onPick: (a: MediaAsset | null) => void;
  emptyHint?: string;
};

export function AssetSlot({ kind, accept, asset, onPick, emptyHint }: AssetSlotProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // When the server returns 409 we stash the in-flight file + the existing
  // match so the dialog can offer "use existing" / "upload anyway". `kind`
  // toggles the wording between byte-exact and perceptual near-match.
  const [dupe, setDupe] = React.useState<{
    file: File;
    existing: MediaAsset;
    kind: DuplicateKind;
    distance: number | null;
  } | null>(null);

  const { data: existing } = useQuery({
    queryKey: ["assets", kind],
    queryFn: () => api.listAssets({ kind }),
  });

  const upload = useMutation({
    mutationFn: ({ file, force }: { file: File; force?: boolean }) =>
      api.uploadAsset(file, kind, { force }),
    onSuccess: ({ asset: a }) => {
      qc.invalidateQueries({ queryKey: ["assets", kind] });
      onPick(a);
      toast.success("Uploaded");
      setDupe(null);
    },
    onError: (err: Error, vars) => {
      if (err instanceof DuplicateUploadError) {
        // Don't toast — show the confirm dialog instead.
        setDupe({
          file: vars.file,
          existing: err.existingAsset,
          kind: err.kind,
          distance: err.distance,
        });
        return;
      }
      toast.error(err.message);
    },
  });

  const defaultHint =
    kind === "source_video" ? "MP4/MOV up to 100 MB" : "JPG/PNG up to 10 MB";

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
          {emptyHint ?? defaultHint}
        </span>
      </button>
      <Input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate({ file: f });
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

      <Dialog
        open={!!dupe}
        onOpenChange={(open) => {
          if (!open) setDupe(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dupe?.kind === "perceptual"
                ? "Looks like the same image"
                : "Looks like a duplicate"}
            </DialogTitle>
            <DialogDescription>
              {dupe?.kind === "perceptual"
                ? "This image has the same content as one already in your library — just saved or re-encoded differently. Upload it anyway, or reuse the existing one."
                : "The bytes of this file match an image already in your library. Upload it again, or just reuse the existing one."}
            </DialogDescription>
          </DialogHeader>

          {dupe && (
            <div className="space-y-3">
              <MediaThumb asset={dupe.existing} />
              <div className="text-xs text-[var(--color-fg-muted)] flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-[var(--color-fg)] font-medium">
                  {dupe.existing.filename}
                </span>
                <span>{formatBytes(dupe.existing.sizeBytes)}</span>
                {dupe.existing.width && dupe.existing.height && (
                  <span>
                    {dupe.existing.width}×{dupe.existing.height}
                  </span>
                )}
                <span>{relativeTime(dupe.existing.createdAt)}</span>
              </div>
              <div className="text-xs text-[var(--color-fg-subtle)]">
                Trying to upload:{" "}
                <span className="text-[var(--color-fg-muted)]">
                  {dupe.file.name} ({formatBytes(dupe.file.size)})
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="!flex-col gap-2 sm:!flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDupe(null)}
              disabled={upload.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!dupe || upload.isPending}
              onClick={() => {
                if (!dupe) return;
                onPick(dupe.existing);
                setDupe(null);
                toast.success("Using existing image");
              }}
            >
              Use existing
            </Button>
            <Button
              type="button"
              disabled={!dupe || upload.isPending}
              onClick={() => {
                if (!dupe) return;
                upload.mutate({ file: dupe.file, force: true });
              }}
            >
              {upload.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Upload anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
