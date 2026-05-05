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
  }) =>
    request<{ generation: Generation }>("/api/generations", {
      method: "POST",
      body: JSON.stringify(input),
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
  getUsage: () => request<UsageSummary>("/api/usage"),
};
