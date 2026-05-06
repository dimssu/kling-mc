async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }
  if (!res.ok) {
    const msg = (json as { error?: string })?.error ?? res.statusText;
    throw new Error(msg);
  }
  return json as T;
}

export type MediaAsset = {
  id: string;
  ownerId: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  storageKey: string;
  thumbnailKey: string | null;
  isFavorite: boolean;
  createdAt: string;
};

export type CaptionPackFields = {
  captionPackEnabled: boolean;
  caption: string | null;
  captionTags: string[];
  captionLocation: string | null;
  captionAccessibility: string | null;
  captionPackGeneratedAt: string | null;
};

export type Generation = {
  id: string;
  ownerId: string;
  status: "queued" | "processing" | "completed" | "failed";
  provider: string;
  providerTaskId: string | null;
  externalTaskId: string;
  sourceVideoId: string;
  referenceImageId: string;
  outputAssetId: string | null;
  prompt: string | null;
  modelName: string;
  mode: string;
  characterOrientation: string;
  keepOriginalSound: boolean;
  watermarkEnabled: boolean;
  estimatedCostUsd: string | number;
  actualCostUsd: string | number | null;
  finalUnitDeduction: string | null;
  errorCode: number | null;
  errorMessage: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  sourceVideo?: MediaAsset;
  referenceImage?: MediaAsset;
  outputAsset?: MediaAsset | null;
} & CaptionPackFields;

export type ImageGeneration = {
  id: string;
  ownerId: string;
  status: "queued" | "processing" | "completed" | "failed";
  provider: string;
  providerTaskId: string | null;
  externalTaskId: string;
  subjectImageIds: string[];
  sceneImageId: string | null;
  styleImageId: string | null;
  outputAssetId: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  modelName: string;
  aspectRatio: string | null;
  n: number;
  estimatedCostUsd: string | number;
  actualCostUsd: string | number | null;
  finalUnitDeduction: string | null;
  errorCode: number | null;
  errorMessage: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  // Resolved on the GET-by-id endpoint:
  subjectImages?: MediaAsset[];
  sceneImage?: MediaAsset | null;
  styleImage?: MediaAsset | null;
  outputAsset?: MediaAsset | null;
} & CaptionPackFields;

export type CarouselSlide = ImageGeneration & {
  carouselId: string | null;
  slotIndex: number | null;
  poseLabel: string | null;
};

export type Carousel = {
  id: string;
  ownerId: string;
  status: "queued" | "processing" | "partial" | "completed" | "failed" | string;
  n: number;
  themePrompt: string | null;
  vibeLabel: string | null;
  subjectImageId: string;
  modelName: string;
  aspectRatio: string | null;
  estimatedCostUsd: string | number;
  caption: string | null;
  captionTags: string[];
  captionLocation: string | null;
  captionAccessibility: string | null;
  captionGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  slides: CarouselSlide[];
  // Resolved on the GET-by-id endpoint:
  subjectImage?: MediaAsset | null;
};

export type UsageSummary = {
  cost: { today: number; week: number; month: number; allTime: number; pending: number };
  counts: Record<string, number>;
  pricingTable: Record<string, Record<string, number>>;
};

export const api = {
  uploadAsset: async (file: File, kind: "source_video" | "reference_image") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    return request<{ asset: MediaAsset }>("/api/uploads", { method: "POST", body: fd });
  },
  listAssets: (params: { kind?: string; favorite?: boolean } = {}) => {
    const sp = new URLSearchParams();
    if (params.kind) sp.set("kind", params.kind);
    if (params.favorite) sp.set("favorite", "true");
    return request<{ items: MediaAsset[]; nextCursor: string | null }>(`/api/assets?${sp}`);
  },
  deleteAsset: (id: string) => request<{ ok: true }>(`/api/assets/${id}`, { method: "DELETE" }),
  toggleAssetFavorite: (id: string, value?: boolean) =>
    request<{ asset: MediaAsset }>(`/api/assets/${id}/favorite`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  createGeneration: (input: {
    sourceVideoId: string;
    referenceImageId: string;
    prompt?: string;
    modelName: "kling-v2-6" | "kling-v3";
    mode: "std" | "pro";
    characterOrientation: "image" | "video";
    keepOriginalSound: boolean;
    watermarkEnabled: boolean;
    captionPackEnabled?: boolean;
  }) =>
    request<{ generation: Generation }>("/api/generations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  regenerateGenerationCaptionPack: (id: string) =>
    request<{ generation: Generation }>(`/api/generations/${id}/caption-pack`, {
      method: "POST",
    }),
  listGenerations: (params: { status?: string; favorite?: boolean } = {}) => {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.favorite) sp.set("favorite", "true");
    return request<{ items: Generation[]; nextCursor: string | null }>(`/api/generations?${sp}`);
  },
  getGeneration: (id: string) => request<{ generation: Generation }>(`/api/generations/${id}`),
  deleteGeneration: (id: string) =>
    request<{ ok: true }>(`/api/generations/${id}`, { method: "DELETE" }),
  toggleGenerationFavorite: (id: string, value?: boolean) =>
    request<{ generation: Generation }>(`/api/generations/${id}/favorite`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  createImageGeneration: (input: {
    endpoint?: "multi-image2image" | "image2image";
    subjectImageIds: string[];
    sceneImageId?: string;
    styleImageId?: string;
    prompt?: string;
    negativePrompt?: string;
    modelName:
      | "kling-v1"
      | "kling-v1-5"
      | "kling-v2"
      | "kling-v2-new"
      | "kling-v2-1";
    imageReference?: "subject" | "face";
    aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";
    n?: number;
    captionPackEnabled?: boolean;
  }) =>
    request<{ imageGeneration: ImageGeneration }>("/api/image-generations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  regenerateImageCaptionPack: (id: string) =>
    request<{ imageGeneration: ImageGeneration }>(
      `/api/image-generations/${id}/caption-pack`,
      { method: "POST" },
    ),
  suggestImagePrompt: (params?: { avoidCategories?: string[] }) =>
    request<{
      prompt: string;
      negativePrompt: string;
      categoryKey: string;
      categoryLabel: string;
      vibe: string;
    }>(
      `/api/image-generations/suggest-prompt`,
      { method: "POST", body: JSON.stringify(params ?? {}) },
    ),
  listImageGenerations: (params: { status?: string; favorite?: boolean } = {}) => {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.favorite) sp.set("favorite", "true");
    return request<{ items: ImageGeneration[]; nextCursor: string | null }>(
      `/api/image-generations?${sp}`,
    );
  },
  getImageGeneration: (id: string) =>
    request<{ imageGeneration: ImageGeneration }>(`/api/image-generations/${id}`),
  deleteImageGeneration: (id: string) =>
    request<{ ok: true }>(`/api/image-generations/${id}`, { method: "DELETE" }),
  toggleImageGenerationFavorite: (id: string, value?: boolean) =>
    request<{ imageGeneration: ImageGeneration }>(
      `/api/image-generations/${id}/favorite`,
      { method: "POST", body: JSON.stringify({ value }) },
    ),
  getUsage: () => request<UsageSummary>("/api/usage"),
  createCarousel: (input: {
    subjectImageId: string;
    n: number;
    themePrompt?: string;
    endpoint?: "multi-image2image" | "image2image";
    modelName:
      | "kling-v1"
      | "kling-v1-5"
      | "kling-v2"
      | "kling-v2-new"
      | "kling-v2-1";
    imageReference?: "subject" | "face";
    aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";
  }) =>
    request<{ carousel: Carousel }>("/api/carousels", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getCarousel: (id: string) =>
    request<{ carousel: Carousel }>(`/api/carousels/${id}`),
  listCarousels: (params: { status?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    return request<{ items: Carousel[]; nextCursor: string | null }>(
      `/api/carousels?${sp}`,
    );
  },
  deleteCarousel: (id: string) =>
    request<{ ok: true }>(`/api/carousels/${id}`, { method: "DELETE" }),
  retryCarouselSlide: (id: string, slotIndex: number) =>
    request<{ ok: true }>(
      `/api/carousels/${id}/slides/${slotIndex}/retry`,
      { method: "POST" },
    ),
};
