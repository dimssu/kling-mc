import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

const TONE = {
  queued: "neutral",
  processing: "accent",
  completed: "success",
  failed: "danger",
} as const;

const LABEL = {
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
} as const;

export function StatusPill({ status }: { status: string }) {
  const tone = (TONE[status as keyof typeof TONE] ?? "neutral") as "neutral" | "accent" | "success" | "danger";
  const label = LABEL[status as keyof typeof LABEL] ?? status;
  return (
    <Badge tone={tone}>
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "queued" && <Clock className="h-3 w-3" />}
      {status === "completed" && <CheckCircle2 className="h-3 w-3" />}
      {status === "failed" && <XCircle className="h-3 w-3" />}
      {label}
    </Badge>
  );
}
