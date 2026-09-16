import axios from "axios";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { ScrapedMediaItem } from "./media-extractor.js";

/**
 * Download scraped article media into <outputDir>/media/ with deterministic
 * names media-1.jpg, media-2.mp4 … and write a media-manifest.json mapping
 * placeholders ("$media.1" …) to local relative paths + source URLs.
 *
 * Idempotent: if the local file already exists it is reused (delete to refetch).
 * Failed downloads are skipped — the pipeline falls back to whatever succeeded.
 */

export interface ManifestEntry {
  /** Placeholder token used in script.json, e.g. "$media.1" */
  placeholder: string;
  /** Relative path inside the output dir, e.g. "media/media-1.jpg" */
  relPath: string;
  /** Original absolute URL the file was fetched from */
  sourceUrl: string;
  kind: "image" | "video";
  /** Downloaded file size in bytes */
  bytes: number;
}

export interface DownloadResult {
  entries: ManifestEntry[];
  /** URLs that failed to download (with reason) */
  failures: { url: string; reason: string }[];
}

const MAX_FILES = 6;
/** Skip videos larger than this (bytes) — demo clips only */
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
/** Skip images larger than this (bytes) */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Overall per-file timeout */
const TIMEOUT_MS = 45_000;

function extFor(url: string, contentType: string): string {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (/^\.(jpe?g|png|webp|avif|mp4|webm|mov)$/.test(fromUrl)) {
    return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  }
  const ct = contentType.toLowerCase();
  if (ct.includes("mp4")) return ".mp4";
  if (ct.includes("webm")) return ".webm";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("avif")) return ".avif";
  return ".jpg";
}

export async function downloadMedia(
  items: ScrapedMediaItem[],
  outputDir: string,
  opts: { maxFiles?: number; onStart?: (url: string) => void } = {},
): Promise<DownloadResult> {
  const maxFiles = Math.min(opts.maxFiles ?? MAX_FILES, MAX_FILES);
  const mediaDir = join(outputDir, "media");
  await mkdir(mediaDir, { recursive: true });

  const entries: ManifestEntry[] = [];
  const failures: { url: string; reason: string }[] = [];

  let index = 0;
  for (const item of items) {
    if (entries.length >= maxFiles) break;
    index += 1;

    const placeholder = `$media.${index}`;
    const relPathPrefix = `media/media-${index}`;

    // Idempotent reuse: find any existing file for this index
    const existing = ["jpg", "jpeg", "png", "webp", "avif", "mp4", "webm", "mov"]
      .map((ext) => `${relPathPrefix}.${ext}`)
      .find((rel) => existsSync(join(outputDir, rel)));
    if (existing) {
      const { statSync } = await import("node:fs");
      entries.push({
        placeholder,
        relPath: existing,
        sourceUrl: item.url,
        kind: item.kind,
        bytes: statSync(join(outputDir, existing)).size,
      });
      continue;
    }

    opts.onStart?.(item.url);
    try {
      const cap = item.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      const resp = await axios.get<ArrayBuffer>(item.url, {
        responseType: "arraybuffer",
        timeout: TIMEOUT_MS,
        validateStatus: (s) => s < 400,
        maxContentLength: cap,
        // Many CDNs require a UA + referer to serve assets
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Referer: new URL(item.url).origin + "/",
        },
      });

      const ct = String(resp.headers["content-type"] ?? "");
      const kindOk = item.kind === "video" ? ct.startsWith("video/") || ct === "application/octet-stream" : ct.startsWith("image/");
      if (!kindOk) {
        failures.push({ url: item.url, reason: `non-${item.kind} content-type: ${ct}` });
        continue;
      }

      const buf = Buffer.from(resp.data);
      if (buf.length < 2048) {
        failures.push({ url: item.url, reason: `too small (${buf.length}B — likely error page)` });
        continue;
      }

      const relPath = `${relPathPrefix}${extFor(item.url, ct)}`;
      await writeFile(join(outputDir, relPath), buf);
      entries.push({ placeholder, relPath, sourceUrl: item.url, kind: item.kind, bytes: buf.length });
    } catch (e: any) {
      failures.push({ url: item.url, reason: e.response?.status ? `http ${e.response.status}` : String(e.message ?? e) });
    }
  }

  await writeFile(join(outputDir, "media-manifest.json"), JSON.stringify(entries, null, 2));
  return { entries, failures };
}

/** Load a previously written manifest (for rerender / tests). */
export async function loadManifest(outputDir: string): Promise<ManifestEntry[]> {
  const { readFile } = await import("node:fs/promises");
  const p = join(outputDir, "media-manifest.json");
  if (!existsSync(p)) return [];
  return JSON.parse(await readFile(p, "utf8")) as ManifestEntry[];
}
