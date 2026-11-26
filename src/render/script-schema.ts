import { z } from "zod";
import { resolveFormat, type VideoFormat } from "./format.js";

// ── Template data shapes (discriminated by template field) ─────────────────
//
// Two limit sets share the same builders:
//  - SHORT (original): scenes 5–8, tight text caps tuned for a 60s 9:16 card.
//  - LONG (v1, 2026-11-19): scenes 8–60, relaxed caps for a 5–10 min 16:9
//    tutorial — hook headline ≤90, callout statement ≤160, feature-list
//    title ≤80 / bullets ≤6 × ≤90 chars, stat-hero value ≤30 / label ≤70 /
//    context ≤100, comparison label ≤50 / value ≤30, media caption ≤100,
//    outro ctaTop ≤60 / source ≤80. Plus two long-only templates:
//    `chapter` (section divider) and `code-demo` (VS Code–style code scene).

const KenBurns = z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]);

interface TextLimits {
  hookHeadline: number;
  hookSubhead: number;
  cmpLabel: number;
  cmpValue: number;
  statValue: number;
  statLabel: number;
  statContext: number;
  featTitle: number;
  featBullet: number;
  featMaxBullets: number;
  calloutStatement: number;
  calloutTag: number;
  mediaTitle: number;
  mediaCaption: number;
  outroCta: number;
  outroChannel: number;
  outroSource: number;
}

const SHORT_LIMITS: TextLimits = {
  hookHeadline: 40, hookSubhead: 40,
  cmpLabel: 30, cmpValue: 20,
  statValue: 20, statLabel: 40, statContext: 50,
  featTitle: 40, featBullet: 50, featMaxBullets: 4,
  calloutStatement: 80, calloutTag: 20,
  mediaTitle: 40, mediaCaption: 60,
  outroCta: 30, outroChannel: 30, outroSource: 40,
};

const LONG_LIMITS: TextLimits = {
  hookHeadline: 90, hookSubhead: 90,
  cmpLabel: 50, cmpValue: 30,
  statValue: 30, statLabel: 70, statContext: 100,
  featTitle: 80, featBullet: 90, featMaxBullets: 6,
  calloutStatement: 160, calloutTag: 30,
  mediaTitle: 80, mediaCaption: 100,
  outroCta: 60, outroChannel: 40, outroSource: 80,
};

const MediaItem = z.object({
  /** "$media.N" placeholder or a relative path like "images/media-3.jpg" */
  src: z.string().min(1),
  /** Optional one-line caption */
  caption: z.string().max(100).optional(),
});

function buildTemplates(l: TextLimits) {
  const hook = z.object({
    template: z.literal("hook"),
    headline: z.string().min(1).max(l.hookHeadline),
    subhead: z.string().max(l.hookSubhead).optional(),
    /** background image path (literal "$source.image" → substituted at pipeline level) */
    bgSrc: z.string().optional(),
    /** Ken Burns effect class */
    kenBurns: KenBurns.default("zoom-in"),
  });

  const comparisonSide = z.object({
    label: z.string().min(1).max(l.cmpLabel),
    value: z.string().min(1).max(l.cmpValue),
    color: z.enum(["cyan", "purple"]),
  });
  const comparison = z.object({
    template: z.literal("comparison"),
    left: comparisonSide,
    right: comparisonSide.extend({ winner: z.boolean().optional() }),
  });

  const statHero = z.object({
    template: z.literal("stat-hero"),
    value: z.string().min(1).max(l.statValue),
    label: z.string().min(1).max(l.statLabel),
    context: z.string().max(l.statContext).optional(),
    /**
     * Optional photo background behind the stat card ("$media.N" placeholder or
     * a relative path like "images/media-2.jpg" — substituted at pipeline level).
     */
    bgSrc: z.string().optional(),
    kenBurns: KenBurns.default("zoom-in"),
  });

  const featureList = z.object({
    template: z.literal("feature-list"),
    title: z.string().min(1).max(l.featTitle),
    bullets: z.array(z.string().min(1).max(l.featBullet)).min(1).max(l.featMaxBullets),
    icon: z.string().optional(),
    /** Optional demo video (relative path in output dir, e.g. "videos/demo.mp4") — shown in a device frame */
    videoSrc: z.string().optional(),
    /**
     * Optional photo background behind the feature card ("$media.N" placeholder
     * or a relative path — substituted at pipeline level).
     */
    bgSrc: z.string().optional(),
    kenBurns: KenBurns.default("zoom-in"),
  });

  const callout = z.object({
    template: z.literal("callout"),
    statement: z.string().min(1).max(l.calloutStatement),
    tag: z.string().max(l.calloutTag).optional(),
    /** Optional photo background behind the callout card ("$media.N" placeholder or relative path). */
    bgSrc: z.string().optional(),
    /**
     * Optional illustration image displayed BELOW the callout card in a
     * terminal-style frame ("$media.N" placeholder or relative path).
     */
    imageSrc: z.string().optional(),
    kenBurns: KenBurns.default("zoom-in"),
  });

  /**
   * Media strip — a carousel of 2–3 photos/videos scraped from the source
   * article. Each item is "$media.N" (substituted at pipeline level) or
   * a relative path inside the output dir.
   */
  const mediaStrip = z.object({
    template: z.literal("media-strip"),
    title: z.string().min(1).max(l.mediaTitle),
    items: z.array(MediaItem.extend({ caption: z.string().max(l.mediaCaption).optional() })).min(2).max(3),
  });

  const outro = z.object({
    template: z.literal("outro"),
    ctaTop: z.string().min(1).max(l.outroCta),
    channelName: z.string().min(1).max(l.outroChannel),
    source: z.string().min(1).max(l.outroSource),
  });

  return { hook, comparison, statHero, featureList, callout, mediaStrip, outro };
}

const shortT = buildTemplates(SHORT_LIMITS);
const longT = buildTemplates(LONG_LIMITS);

export const TemplateData = z.discriminatedUnion("template", [
  shortT.hook, shortT.comparison, shortT.statHero, shortT.featureList,
  shortT.callout, shortT.mediaStrip, shortT.outro,
]);

// ── Long-only templates ────────────────────────────────────────────────────

/** Chapter divider — a full-screen section break in a long tutorial. */
const ChapterData = z.object({
  template: z.literal("chapter"),
  /** Chapter number as shown on screen, e.g. 1 or "01" or "Phần 1". */
  index: z.union([z.number(), z.string().min(1).max(10)]).optional(),
  title: z.string().min(1).max(90),
  subtitle: z.string().max(120).optional(),
});

/**
 * Code demo — code shown as a real VS Code window (tab with the filename,
 * line numbers, Dark+ palette). `code` is one array entry per line so line
 * numbers and highlightLines (1-based) stay exact.
 */
const CodeDemoData = z.object({
  template: z.literal("code-demo"),
  title: z.string().max(80).optional(),
  filename: z.string().min(1).max(120),
  language: z.string().max(20).optional(),
  code: z.array(z.string().max(120)).min(1).max(40),
  /**
   * Displayed line number of the first code line minus 1 (default 0).
   * Lets one long file be shown across consecutive code-demo scenes
   * (e.g. lines 1–25, then 26–50 with lineOffset 25) while the gutter
   * and highlightLines keep the file's real 1-based numbers.
   */
  lineOffset: z.number().int().min(0).max(500).optional(),
  /** 1-based line numbers to highlight (absolute, incl. lineOffset). */
  highlightLines: z.array(z.number().int().min(1).max(540)).max(40).optional(),
  caption: z.string().max(120).optional(),
});

export const LongTemplateData = z.discriminatedUnion("template", [
  longT.hook, longT.comparison, longT.statHero, longT.featureList,
  longT.callout, longT.mediaStrip, longT.outro,
  ChapterData, CodeDemoData,
]);

export type TemplateDataType =
  | z.infer<typeof TemplateData>
  | z.infer<typeof LongTemplateData>;

// ── SFX schema ─────────────────────────────────────────────────────────────
/**
 * Per-scene sound effect override. If omitted, the pipeline picks a default
 * SFX based on the template type (see SKILL.md / pipeline DEFAULT_SFX).
 *
 * `name` examples: "transition/whoosh-soft", "emphasis/ding", "alert/notification"
 *   → resolves to assets/sfx/<name>.mp3
 * Set `name: "none"` to explicitly disable SFX for this scene.
 */
const SfxSpec = z.object({
  name: z.string().min(1),
  /** Volume 0–1, default 0.4 (so SFX doesn't drown the voice) */
  volume: z.number().min(0).max(1).default(0.4),
  /** Seconds offset from scene start (default 0). Negative = before scene. */
  startOffsetSec: z.number().default(0),
});

export type SfxSpecType = z.infer<typeof SfxSpec>;

// ── Scene + root schemas ───────────────────────────────────────────────────

const Metadata = z.object({
  title: z.string().min(1),
  source: z.object({
    url: z.string(),
    domain: z.string(),
    image: z.string().url().nullable(),
    /** Photos/videos scraped from the source article (pipeline fills this in) */
    media: z.array(MediaItem).max(12).optional(),
  }),
  channel: z.string().min(1),
  /** Shell header tag override (e.g. "CODE TIPS"). Default depends on format. */
  brandTag: z.string().min(1).max(40).optional(),
});

const Voice = z.object({
  provider: z.string().min(1),
  voiceId: z.string().min(1),
  speed: z.number().min(0.5).max(2.0),
});

const ShortScene = z.object({
  id: z.string().min(1),
  type: z.enum(["hook", "body", "outro"]),
  voiceText: z.string().min(1),
  templateData: TemplateData,
  /** Optional sound effect override (else pipeline picks per template) */
  sfx: SfxSpec.optional(),
});

const LongScene = z.object({
  id: z.string().min(1),
  // "chapter" scenes carry a `chapter` template; they are neither hook nor outro.
  type: z.enum(["hook", "body", "chapter", "outro"]),
  voiceText: z.string().min(1),
  templateData: LongTemplateData,
  sfx: SfxSpec.optional(),
});

export const ScriptSchema = z.object({
  version: z.literal("1.0"),
  /** Top-level format field — absent means "short" (all pre-long scripts). */
  format: z.literal("short").default("short"),
  metadata: Metadata,
  voice: Voice,
  scenes: z
    .array(ShortScene)
    .min(5)
    .max(8, "scenes must have at most 8 items")
    .refine(
      (s) => s[0]?.type === "hook",
      { message: "scenes[0] must be type=hook" }
    )
    .refine(
      (s) => s[s.length - 1]?.type === "outro",
      { message: "last scene must be type=outro" }
    ),
});

export const LongScriptSchema = z.object({
  version: z.literal("1.0"),
  // Defaulted so parseScript can route here via the VIDEO_FORMAT env
  // fallback when script.json omits the field.
  format: z.literal("long").default("long"),
  metadata: Metadata,
  voice: Voice,
  scenes: z
    .array(LongScene)
    .min(8)
    .max(60, "long scenes must have at most 60 items")
    .refine(
      (s) => s[0]?.type === "hook",
      { message: "scenes[0] must be type=hook" }
    )
    .refine(
      (s) => s[s.length - 1]?.type === "outro",
      { message: "last scene must be type=outro" }
    ),
});

export type ShortScript = z.infer<typeof ScriptSchema>;
export type LongScript = z.infer<typeof LongScriptSchema>;
export type Script = ShortScript | LongScript;

/**
 * Parse a raw script.json of either format.
 * Format precedence: script.json `format` field → `envFormat` (VIDEO_FORMAT
 * env via Config) → "short".
 */
export function parseScript(raw: unknown, envFormat?: VideoFormat): Script {
  const format = resolveFormat(raw, envFormat);
  return format === "long" ? LongScriptSchema.parse(raw) : ScriptSchema.parse(raw);
}
