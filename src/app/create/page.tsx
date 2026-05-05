"use client";

import * as React from "react";
import { CreateGenerationForm } from "@/components/CreateGenerationForm";
import { CreateImageGenerationForm } from "@/components/CreateImageGenerationForm";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function CreatePage() {
  const [tab, setTab] = React.useState("video");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="text-sm text-[var(--color-fg-muted)]">Create</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">New generation</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-fg-muted)]">
          Pick what you want to make. We&apos;ll submit it to Kling, poll until it&apos;s
          done, and store the result in your library.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="video">Motion control (video)</TabsTrigger>
          <TabsTrigger value="image">Image (image-to-image)</TabsTrigger>
        </TabsList>
        <TabsContent value="video">
          <p className="mb-4 max-w-prose text-sm text-[var(--color-fg-muted)]">
            Replace the person in a source video with the person in a reference image.
          </p>
          <CreateGenerationForm />
        </TabsContent>
        <TabsContent value="image">
          <p className="mb-4 max-w-prose text-sm text-[var(--color-fg-muted)]">
            Generate a new image from a reference + prompt. Useful for variations,
            style transfer, and edits guided by language.
          </p>
          <CreateImageGenerationForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
