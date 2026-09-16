import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Extract illustrative photos and videos from a scraped article HTML:
 *  - <img src / data-src / srcset (largest candidate)>
 *  - <source src="...mp4"> and <video src> (mp4/webm)
 *  - JSON-LD (schema.org Article image / VideoObject contentUrl)
 *
 * Returns absolute https URLs, de-duplicated, ordered by first appearance in
 * the document. Og:image / logo / icon / avatar / emoji / tracking-pixel
 * assets are filtered out (the og:image already lands as the hook bg).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_HTML = join(__dirname, "..", "..", "tests", "fixtures", "article.html");

export interface ScrapedMediaItem {
  kind: "image" | "video";
  url: string;
  /** Optional short caption scraped from alt/title attributes */
  caption?: string;
}

// URL fragments that mark an asset as non-illustrative (icons, UI, tracking…)
const JUNK_PATTERNS = [
  /\/favicon/i, /\/logo[s]?\b|[-_]logo[-_.]/i, /\/icons?\//i, /\/avatars?\//i,
  /sprite/i, /\/emoji[s]?\//i, /spacer\.gif|^data:image\/svg/i,
  /1x1|pixel\.gif|\/blank\./i, /\/ads?\/|doubleclick|googletagmanager/i,
  /\/flags?\//i, /placeholder/i, /loading\.gif|spinner/i,
];

/** W×H below this is considered an icon/tracking pixel, not a photo */
const MIN_WIDTH = 400;

function absUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  const u = raw.trim().replace(/^["']|["']$/g, "");
  if (!u || u.startsWith("data:") || u.startsWith("javascript:") || u.startsWith("#")) return null;
  try {
    const abs = new URL(u, baseUrl);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    return abs.toString();
  } catch {
    return null;
  }
}

function looksJunky(url: string): boolean {
  return JUNK_PATTERNS.some((re) => re.test(url));
}

function isImageExt(url: string): boolean {
  return /\.(jpe?g|png|webp|avif)(?=\?|#|$)/i.test(url);
}

function isVideoExt(url: string): boolean {
  return /\.(mp4|webm|mov)(?=\?|#|$)/i.test(url);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** Parse a srcset attribute and return the widest candidate URL. */
function widestFromSrcset(srcset: string): string | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const seg = part.trim().split(/\s+/);
    if (!seg[0]) continue;
    const w = seg[1]?.endsWith("w") ? parseInt(seg[1], 10) : 0;
    if (!best || w > best.w) best = { url: seg[0], w };
  }
  return best?.url ?? null;
}

export function extractMediaFromHtml(html: string, baseUrl: string): ScrapedMediaItem[] {
  const out: ScrapedMediaItem[] = [];
  const seen = new Set<string>();

  const push = (kind: "image" | "video", rawUrl: string | null | undefined, caption?: string) => {
    const url = absUrl(rawUrl ?? null, baseUrl);
    if (!url || seen.has(url)) return;
    if (looksJunky(url)) return;
    // Content-type hints from the URL itself: only accept known media extensions
    if (kind === "image" && !isImageExt(url)) return;
    if (kind === "video" && !isVideoExt(url)) return;
    seen.add(url);
    out.push({ kind, url, caption: caption ? decodeEntities(caption).trim().slice(0, 80) || undefined : undefined });
  };

  // ── JSON-LD first (highest quality, often original-res images) ──────────
  for (const m of html.matchAll(/<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(decodeEntities(m[1]).trim());
      for (const node of Array.isArray(data) ? data : [data]) {
        const jsonldImages: unknown = node?.image;
        const imgs = Array.isArray(jsonldImages)
          ? jsonldImages
          : typeof jsonldImages === "object" && jsonldImages !== null && "url" in (jsonldImages as Record<string, unknown>)
            ? [jsonldImages]
            : jsonldImages
              ? [jsonldImages]
              : [];
        for (const img of imgs as unknown[]) {
          const u = typeof img === "string" ? img : (img as { url?: string })?.url;
          if (typeof u === "string") push("image", u, undefined);
        }
        const videoUrl: unknown = node?.video?.contentUrl ?? node?.contentUrl;
        if (typeof videoUrl === "string" && isVideoExt(videoUrl)) push("video", videoUrl, typeof node?.name === "string" ? node.name : undefined);
      }
    } catch {
      // malformed JSON-LD → skip silently
    }
  }

  // ── <img> tags ──────────────────────────────────────────────────────────
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = m[1];
    const src = /(?:data-src|data-original|data-lazy-src|src)=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = src?.[2] ?? src?.[3] ?? src?.[4] ?? null;

    const srcsetM = /\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const srcsetRaw = srcsetM?.[2] ?? srcsetM?.[3];

    const widthM = /\b(?:width|data-width)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const width = widthM ? parseInt(widthM[2] ?? widthM[3] ?? widthM[4], 10) : NaN;

    const altM = /\balt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const caption = altM?.[2] ?? altM?.[3];

    // Prefer srcset's widest candidate; fall back to data-src, then src.
    const candidate = (srcsetRaw ? widestFromSrcset(srcsetRaw) : null) ?? raw;
    if (!candidate) continue;
    // Reject tiny explicit widths (icons, avatars, emoji)
    if (!Number.isNaN(width) && width > 0 && width < MIN_WIDTH) continue;
    push("image", candidate, caption);
  }

  // ── <video> / <source> tags ─────────────────────────────────────────────
  for (const m of html.matchAll(/<(?:video|source)\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (/type\s*=\s*["'][^"']*image/i.test(attrs)) continue; // <picture> sources
    const src = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (src) push("video", src[2] ?? src[3] ?? src[4] ?? null);
  }

  return out;
}

/** Convenience wrapper for tests / CLI debugging: read HTML from disk. */
export function extractMediaFromFile(path: string, baseUrl: string): ScrapedMediaItem[] {
  return extractMediaFromHtml(readFileSync(path, "utf8"), baseUrl);
}

// CLI debug entry: npx tsx src/assets/media-extractor.ts <url-or-file> [baseUrl]
if (process.argv[1] && process.argv[1].endsWith("media-extractor.ts")) {
  void (async () => {
    const target = process.argv[2];
    const baseUrl = process.argv[3] ?? target ?? "https://example.com/";
    if (!target) {
      console.error("Usage: npx tsx src/assets/media-extractor.ts <html-file-or-url> [baseUrl]");
      process.exit(2);
    }
    const html = await loadHtml(target);
    const items = extractMediaFromHtml(html, baseUrl);
    console.log(JSON.stringify(items, null, 2));
  })().catch((e) => { console.error(e); process.exit(1); });
}

async function loadHtml(target: string): Promise<string> {
  if (/^https?:/.test(target)) {
    const axios = (await import("axios")).default;
    const resp = await axios.get<string>(target, { responseType: "text" });
    return resp.data;
  }
  return readFileSync(target, "utf8");
}
