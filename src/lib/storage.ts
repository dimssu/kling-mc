import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { getEnv } from "./env";

let _client: S3Client | null = null;
function client() {
  if (_client) return _client;
  const env = getEnv();
  _client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return _client;
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
