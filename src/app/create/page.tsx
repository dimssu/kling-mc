import { CreateGenerationForm } from "@/components/CreateGenerationForm";

export const metadata = { title: "Create — Kling Studio" };

export default function CreatePage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="text-sm text-[var(--color-fg-muted)]">Motion Control</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">New generation</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-fg-muted)]">
          Replace the person in a source video with the person in a reference image. Upload both,
          tweak the options, and submit. We&apos;ll keep polling the Kling API and notify you when
          it&apos;s done.
        </p>
      </div>
      <CreateGenerationForm />
    </div>
  );
}
