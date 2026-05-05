import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
  r_frame_rate?: string;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: { duration?: string };
};

export type MediaProbe = {
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

export async function probeMedia(buffer: Buffer, ext = "bin"): Promise<MediaProbe> {
  const tmpFile = join(tmpdir(), `kmc-${randomUUID()}.${ext}`);
  await writeFile(tmpFile, buffer);
  try {
    const out = await runFfprobe(tmpFile);
    const videoStream = out.streams?.find((s) => s.codec_type === "video");
    const duration = parseFloat(out.format?.duration ?? videoStream?.duration ?? "");
    return {
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      durationSec: Number.isFinite(duration) ? duration : null,
    };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

function runFfprobe(path: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      path,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}
