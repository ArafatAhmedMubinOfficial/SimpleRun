// packages/mcp-server/src/resultImage.js
// Builds MCP inline image content blocks for completed image jobs.
import fs from "node:fs";
import path from "node:path";

const DIRECT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const DEFAULT_BUDGET_BYTES = 700 * 1024;

const note = (text) => ({ content: [{ type: "text", text }] });

export async function buildResultImageContent(job, opts = {}) {
  const readFile = opts.readFile || fs.readFileSync;
  const budget = opts.budgetBytes || DEFAULT_BUDGET_BYTES;

  if (!job) return note("No such job.");
  if (job.status !== "completed") {
    return note(`Job ${job.jobId || ""} is "${job.status || "unknown"}"; no result image yet.`);
  }
  const p = job.resultPath;
  if (!p) return note("Job completed but has no result path.");
  if (job.mediaType === "video") {
    return note(`Result is a video, which cannot be displayed inline. It is at: ${p}`);
  }
  const ext = path.extname(p).toLowerCase();
  const directMime = DIRECT_MIME[ext];
  if (!directMime) {
    return note(`Result is not an inlineable image (${ext || "no extension"}). It is at: ${p}`);
  }
  let original;
  try {
    original = readFile(p);
  } catch (e) {
    return note(`Could not read result file (${e.code || e.message}). It is at: ${p}`);
  }
  if (original.length <= budget) {
    return {
      content: [
        { type: "image", data: original.toString("base64"), mimeType: directMime },
        { type: "text", text: `Result image (${directMime}, full file): ${p}` },
      ],
    };
  }
  return note(`Image exceeds inline budget (${original.length} bytes). Full-quality original is at: ${p}`);
}
