"use client";

import * as React from "react";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Generation, type ImageGeneration } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type CaptionPackHolder = Pick<
  Generation | ImageGeneration,
  | "id"
  | "status"
  | "captionPackEnabled"
  | "caption"
  | "captionTags"
  | "captionLocation"
  | "captionAccessibility"
  | "captionPackGeneratedAt"
>;

export function CaptionPackPanel({
  kind,
  row,
}: {
  kind: "video" | "image";
  row: CaptionPackHolder;
}) {
  const qc = useQueryClient();
  const queryKey = kind === "video" ? ["generation", row.id] : ["image-generation", row.id];

  const regen = useMutation<unknown, Error>({
    mutationFn: async () => {
      if (kind === "video") {
        return api.regenerateGenerationCaptionPack(row.id);
      }
      return api.regenerateImageCaptionPack(row.id);
    },
    onSuccess: () => {
      toast.success("Caption pack updated");
      qc.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const has = !!row.caption || (row.captionTags?.length ?? 0) > 0;
  const canRegen = row.status === "completed";
  const tagsString = (row.captionTags ?? []).map((t) => `#${t}`).join(" ");

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Caption pack</CardTitle>
          <CardDescription>
            {has
              ? "AI-written for Siya. Copy a field; regenerate for a new vibe."
              : row.captionPackEnabled
                ? "Will appear here once the media is ready."
                : "Not requested for this generation."}
          </CardDescription>
        </div>
        {canRegen && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={regen.isPending}
            onClick={() => regen.mutate()}
          >
            {regen.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {has ? "Regenerate" : "Generate"}
          </Button>
        )}
      </CardHeader>
      {has && (
        <CardContent className="space-y-4">
          <Field label="Caption" value={row.caption ?? ""} multiline />
          <Field label="Hashtags" value={tagsString} multiline copyValue={tagsString} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location" value={row.captionLocation ?? ""} />
            <Field
              label="Alt text"
              value={row.captionAccessibility ?? ""}
              multiline
              hint="For accessibility — literal description of the image"
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Field({
  label,
  value,
  multiline = false,
  copyValue,
  hint,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  copyValue?: string;
  hint?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = copyValue ?? value;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
          {label}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className={`rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm ${
          multiline ? "whitespace-pre-wrap" : "truncate"
        }`}
      >
        {value || <span className="text-[var(--color-fg-subtle)]">—</span>}
      </div>
      {hint && <p className="text-xs text-[var(--color-fg-subtle)]">{hint}</p>}
    </div>
  );
}
