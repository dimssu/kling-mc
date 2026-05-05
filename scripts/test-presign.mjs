import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  forcePathStyle: true,
});

const url = await getSignedUrl(
  client,
  new GetObjectCommand({
    Bucket: "kling-mc-media",
    Key: "uploads/local/source_video/ce17feb6f49b43ee8caf24e42c41e84c.mp4",
  }),
  { expiresIn: 3600 },
);
console.log("Original (localhost):");
console.log(url);

const u = new URL(url);
u.protocol = "https:";
u.host = "laugh-negotiations-medicaid-qld.trycloudflare.com";
console.log("\nRewritten host (tunnel):");
console.log(u.toString());
