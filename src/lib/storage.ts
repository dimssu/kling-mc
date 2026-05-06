import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { getEnv } from "./env";

let _client: S3Client | null = null;
function client() {
  if (_client) return _client;
  const env = getEnv();
  _client = new S3Client({
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

// Key-prefix convention. Both projects share one bucket; kling-mc writes
// under `mc/`, kling-gallery writes under `gallery/`.
export const MC_PREFIX = "mc";

export function makeUploadKey(userId: string, kind: string, ext: string): string {
  const id = randomUUID().replace(/-/g, "");
  return `${MC_PREFIX}/uploads/${userId}/${kind}/${id}.${ext.replace(/^\./, "")}`;
}

export function makeOutputKey(userId: string, generationId: string, ext: string): string {
  return `${MC_PREFIX}/outputs/${userId}/${generationId}.${ext.replace(/^\./, "")}`;
}

export type UploadInput = {
  key: string;
  body: Buffer | Uint8Array | Readable;
  contentType: string;
  contentLength?: number;
};

export async function uploadObject(input: UploadInput): Promise<void> {
  const env = getEnv();
  await client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    }),
  );
}

/**
 * Streaming multipart upload — keeps memory bounded at ~5 MB regardless of
 * input size. Use this for user uploads where the file may be up to 100 MB.
 */
export async function uploadObjectStream(input: {
  key: string;
  body: Readable;
  contentType: string;
}): Promise<void> {
  const env = getEnv();
  const upload = new Upload({
    client: client(),
    params: {
      Bucket: env.S3_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    },
    queueSize: 2,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();
}

export async function deleteObject(key: string): Promise<void> {
  const env = getEnv();
  await client().send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
}

export async function objectExists(key: string): Promise<boolean> {
  const env = getEnv();
  try {
    await client().send(
      new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresInSec = 3600,
): Promise<string> {
  const env = getEnv();
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: expiresInSec },
  );
}

export function getPublicUrl(key: string): string {
  const env = getEnv();
  return `${env.S3_PUBLIC_URL_BASE.replace(/\/+$/, "")}/${key}`;
}

/**
 * URL we hand to Kling so it can fetch our uploads. With real AWS S3 (not
 * MinIO), the public URL is directly fetchable — no tunnel rewrite needed.
 * Kept as a separate helper so call sites that semantically mean "give Kling
 * a URL to fetch" stay self-documenting.
 */
export function getKlingFetchUrl(key: string): string {
  return getPublicUrl(key);
}

export async function downloadToBuffer(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return { buffer, contentType };
}
