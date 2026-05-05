import busboy from "busboy";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Streams a multipart/form-data request to disk without buffering the
 * entire body into JS memory. Returns the parsed text fields and the
 * tmp file path of the (single) uploaded file.
 *
 * If the file exceeds maxBytes, the stream is truncated, the partial tmp
 * file is left for cleanup by the caller, and { tooLarge: true } is set.
 *
 * Why not req.formData()? Next 16's formData() buffers the entire body
 * via undici before yielding, which OOMs the dev server on 17 MB+ files.
 */
export type ParsedMultipart = {
  fields: Record<string, string>;
  file: {
    fieldname: string;
    filename: string;
    mimeType: string;
    tmpPath: string;
    bytesWritten: number;
    tooLarge: boolean;
  } | null;
};

export async function parseMultipartToDisk(
  req: Request,
  tmpPath: string,
  maxBytes: number,
): Promise<ParsedMultipart> {
  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new Error("Expected multipart/form-data");
  }
  if (!req.body) {
    throw new Error("Empty body");
  }

  const fields: Record<string, string> = {};
  let fileMeta: ParsedMultipart["file"] = null;

  const bb = busboy({
    headers: { "content-type": contentType },
    limits: {
      fileSize: maxBytes,
      files: 1,
      fields: 16,
    },
  });

  // Promise that resolves once busboy has emitted "close" and any in-flight
  // file-write pipeline is settled. We track the file pipeline separately so
  // we can await it before resolving.
  let filePipeline: Promise<void> | null = null;
  let firstError: Error | null = null;

  const done = new Promise<void>((resolve, reject) => {
    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("file", (fieldname, fileStream, info) => {
      const meta = {
        fieldname,
        filename: info.filename ?? "",
        mimeType: info.mimeType ?? "application/octet-stream",
        tmpPath,
        bytesWritten: 0,
        tooLarge: false,
      };

      let bytes = 0;
      fileStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      fileStream.on("limit", () => {
        meta.tooLarge = true;
      });

      const writer = createWriteStream(tmpPath);
      filePipeline = pipeline(fileStream, writer)
        .then(() => {
          meta.bytesWritten = bytes;
        })
        .catch((err) => {
          firstError = firstError ?? err;
        });

      fileMeta = meta;
    });

    bb.on("error", (err: Error) => {
      firstError = firstError ?? err;
      reject(err);
    });

    bb.on("close", () => {
      resolve();
    });
  });

  // Pipe the request body through busboy. We don't await this; the "close"
  // event drives completion.
  Readable.fromWeb(req.body as never)
    .pipe(bb)
    .on("error", (err: Error) => {
      firstError = firstError ?? err;
    });

  await done;
  if (filePipeline) await filePipeline;
  if (firstError) throw firstError;

  return { fields, file: fileMeta };
}
