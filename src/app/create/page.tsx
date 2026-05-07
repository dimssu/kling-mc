"use client";

import * as React from "react";
import { CreateGenerationForm } from "@/components/CreateGenerationForm";
import { CreateImageGenerationForm } from "@/components/CreateImageGenerationForm";
import { CreateCarouselForm } from "@/components/CreateCarouselForm";
import { CreateVideoFromImagesForm } from "@/components/CreateVideoFromImagesForm";
import { CreateImage2VideoForm } from "@/components/CreateImage2VideoForm";
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
          <TabsTrigger value="carousel">Carousel</TabsTrigger>
          <TabsTrigger value="image-to-video">Image to video</TabsTrigger>
          <TabsTrigger value="multi-image-to-video">Multi-image to video</TabsTrigger>
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
        <TabsContent value="carousel">
          <p className="mb-4 max-w-prose text-sm text-[var(--color-fg-muted)]">
            Upload one photo and we&apos;ll plan a multi-slide carousel — same
            person and aesthetic, a different pose or expression on each slide.
          </p>
          <CreateCarouselForm />
        </TabsContent>
        <TabsContent value="image-to-video">
          <p className="mb-4 max-w-prose text-sm text-[var(--color-fg-muted)]">
            Generate a video from a single start image (and an optional end-frame image)
            plus a prompt. Pick from V1, V1.5, V1.6, V2.1, V2.5 Turbo, V2.6 in standard
            or professional mode.
          </p>
          <CreateImage2VideoForm />
        </TabsContent>
        <TabsContent value="multi-image-to-video">
          <p className="mb-4 max-w-prose text-sm text-[var(--color-fg-muted)]">
            Generate a video from up to 4 reference images plus a prompt. Each image
            is treated as an element/subject the model should weave into the scene.
            Kling restricts this endpoint to V1.6 only.
          </p>
          <CreateVideoFromImagesForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
