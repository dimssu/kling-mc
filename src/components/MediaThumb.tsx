"use client";

import { type MediaAsset } from "@/lib/api-client";
import { Film, Image as ImageIcon } from "lucide-react";

export function publicUrl(key: string) {
  const base = (process.env.NEXT_PUBLIC_S3_PUBLIC_URL_BASE ?? "http://localhost:9000/kling-mc-media").replace(
    /\/+$/,
    "",
  );
  return `${base}/${key}`;
}

export function MediaThumb({ asset, className = "" }: { asset: MediaAsset; className?: string }) {
  const isVideo = asset.kind === "source_video" || asset.kind === "generated_video";
  const isImage = asset.kind === "reference_image";
  const url = publicUrl(asset.storageKey);

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-bg)] ${className}`}
    >
      {isVideo ? (
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
          onMouseLeave={(e) => {
            const v = e.currentTarget as HTMLVideoElement;
            v.pause();
            v.currentTime = 0;
          }}
        />
      ) : isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={asset.filename} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[var(--color-fg-subtle)]">
          {isVideo ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
        </div>
      )}
    </div>
  );
}
