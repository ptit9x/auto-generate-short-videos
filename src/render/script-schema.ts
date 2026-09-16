import { z } from "zod";

// ── Template data shapes (discriminated by template field) ─────────────────

const KenBurns = z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]);

const HookData = z.object({
  template: z.literal("hook"),
  headline: z.string().min(1).max(40),
  subhead: z.string().max(40).optional(),
  /** background image path (literal "$source.image" → substituted at pipeline level) */
  bgSrc: z.string().optional(),
  /** Ken Burns effect class */
  kenBurns: KenBurns.default("zoom-in"),
});

const ComparisonSide = z.object({
  label: z.string().min(1).max(30),
  value: z.string().min(1).max(20),
  color: z.enum(["cyan", "purple"]),
});

const ComparisonData = z.object({
  template: z.literal("comparison"),
  left: ComparisonSide,
  right: ComparisonSide.extend({ winner: z.boolean().optional() }),
});

const StatHeroData = z.object({
  template: z.literal("stat-hero"),
  value: z.string().min(1).max(20),
  label: z.string().min(1).max(40),
  context: z.string().max(50).optional(),
  /**
   * Optional photo background behind the stat card ("$media.N" placeholder or
   * a relative path like "images/media-2.jpg" — substituted at pipeline level).
   */
  bgSrc: z.string().optional(),
  kenBurns: KenBurns.default("zoom-in"),
});

const FeatureListData = z.object({
  template: z.literal("feature-list"),
  title: z.string().min(1).max(40),
  bullets: z.array(z.string().min(1).max(50)).min(1).max(4),
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

const CalloutData = z.object({
  template: z.literal("callout"),
  statement: z.string().min(1).max(80),
  tag: z.string().max(20).optional(),
  /**
   * Optional photo background behind the callout card ("$media.N" placeholder
   * or a relative path — substituted at pipeline level).
   */
  bgSrc: z.string().optional(),
  /**
   * Optional illustration image displayed BELOW the callout card in a
   * terminal-style frame ("$media.N" placeholder or relative path).
   */
  imageSrc: z.string().optional(),
  kenBurns: KenBurns.default("zoom-in"),
});

/**
 * Media strip — a swipey vertical carousel of 2–3 photos/videos scraped from
 * the source article. Use for scenes like "what it looks like" or a gallery
 * of screenshots. Each item is "$media.N" (substituted at pipeline level) or
 * a relative path inside the output dir.
 */
const MediaItem = z.object({
  /** "$media.N" placeholder or a relative path like "images/media-3.jpg" */
  src: z.string().min(1),
  /** Optional one-line caption (max 60 chars) */
  caption: z.string().max(60).optional(),
});

const MediaStripData = z.object({
  template: z.literal("media-strip"),
  title: z.string().min(1).max(40),
  items: z.array(MediaItem).min(2).max(3),
});

const OutroData = z.object({
  template: z.literal("outro"),
  ctaTop: z.string().min(1).max(30),
  channelName: z.string().min(1).max(30),
  source: z.string().min(1).max(40),
});

export const TemplateData = z.discriminatedUnion("template", [
  HookData,
  ComparisonData,
  StatHeroData,
  FeatureListData,
  CalloutData,
  MediaStripData,
  OutroData,
]);

export type TemplateDataType = z.infer<typeof TemplateData>;

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

// ── Scene schema ───────────────────────────────────────────────────────────

const Scene = z.object({
  id: z.string().min(1),
  type: z.enum(["hook", "body", "outro"]),
  voiceText: z.string().min(1),
  templateData: TemplateData,
  /** Optional sound effect override (else pipeline picks per template) */
  sfx: SfxSpec.optional(),
});

// ── Root schema ────────────────────────────────────────────────────────────

export const ScriptSchema = z.object({
  version: z.literal("1.0"),
  metadata: z.object({
    title: z.string().min(1),
    source: z.object({
      url: z.string(),
      domain: z.string(),
      image: z.string().url().nullable(),
      /** Photos/videos scraped from the source article (pipeline fills this in) */
      media: z.array(MediaItem).max(12).optional(),
    }),
    channel: z.string().min(1),
  }),
  voice: z.object({
    provider: z.string().min(1),
    voiceId: z.string().min(1),
    speed: z.number().min(0.5).max(2.0),
  }),
  scenes: z
    .array(Scene)
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

export type Script = z.infer<typeof ScriptSchema>;
