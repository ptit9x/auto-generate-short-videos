/**
 * Video format — the single place that knows pixel dimensions.
 *
 * - "short": 1080×1920 (9:16) — the original format, default everywhere.
 * - "long":  1920×1080 (16:9) — long-form tutorials for YouTube.
 *
 * Source of truth / precedence (see parseScript in script-schema.ts):
 *   1. top-level `format` field in script.json
 *   2. VIDEO_FORMAT env (Config.videoFormat, fallback)
 *   3. "short"
 */
export type VideoFormat = "short" | "long";

export interface FormatDimensions {
  width: number;
  height: number;
}

export const FORMAT_DIMENSIONS: Record<VideoFormat, FormatDimensions> = {
  short: { width: 1080, height: 1920 },
  long: { width: 1920, height: 1080 },
};

export function dimensionsForFormat(format: VideoFormat): FormatDimensions {
  return FORMAT_DIMENSIONS[format];
}

export function isVideoFormat(v: unknown): v is VideoFormat {
  return v === "short" || v === "long";
}

/**
 * Default brand tag shown in the shell header (`// <TAG>` in dev-terminal).
 * Shorts are news clips → "IT NEWS". Long videos are tutorials, not news —
 * Henry confirmed the final long tag on 2026-11-19: "CODE TIPS" (his exact
 * choice, locked — not a placeholder). Override per-video via script
 * metadata `brandTag`, composeHtml's `brandTag` arg, or the BRAND_TAG env.
 */
export const DEFAULT_BRAND_TAG_BY_FORMAT: Record<VideoFormat, string> = {
  short: "IT NEWS",
  long: "CODE TIPS",
};

/**
 * Resolve the effective format for a raw (unparsed) script object.
 * An explicit top-level `format` in script.json wins; otherwise the env
 * fallback applies; otherwise "short". Invalid explicit values resolve to
 * "short" here so the short schema produces the validation error.
 */
export function resolveFormat(raw: unknown, envFormat?: VideoFormat): VideoFormat {
  if (raw !== null && typeof raw === "object" && "format" in raw) {
    const f = (raw as { format?: unknown }).format;
    if (f === "long") return "long";
    if (f === "short") return "short";
    return "short";
  }
  return envFormat ?? "short";
}
