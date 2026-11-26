import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Script, TemplateDataType } from "./script-schema.js";
import type { TiktokConfig } from "../config.js";
import { dimensionsForFormat, DEFAULT_BRAND_TAG_BY_FORMAT, type VideoFormat } from "./format.js";
import { highlightCodeLine } from "./code-highlight.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_DIR = join(__dirname, "templates");

// Grain overlay HTML inline (from installed component)
const GRAIN_OVERLAY_HTML = `<div id="grain-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;"><div class="grain-texture"></div></div>`;

// Vignette — darkens far edges so content doesn't feel like it's floating in a flat void.
const VIGNETTE_HTML = `<div class="vignette"></div>`;

// Default TikTok config (used if not passed)
const DEFAULT_TIKTOK: TiktokConfig = {
  displayName: "Lập trình là cuộc sống",
  handle: "Lập trình là cuộc sống",
  followers: "Video mỗi ngày",
};

export interface SceneAudio {
  id: string;
  durationSec: number;
}

export interface ComposeArgs {
  script: Script;
  sceneAudio: SceneAudio[];
  gapSec: number;
  /** Hook background image relative path (legacy single-image mode). null => gradient. */
  bgImageRelPath: string | null;   // null => no image available
  audioRelPath: string;
  /** TikTok follow card config (injected into outro scene). Optional — defaults used if omitted. */
  tiktok?: TiktokConfig;
  /** Relative path to avatar image inside the output dir (e.g. "tiktok-avatar.jpg"). */
  tiktokAvatarRelPath?: string;
  /** Extra seconds added to outro scene visual duration after voice ends (TikTok card hold). Default 3. */
  outroHoldSec?: number;
  /**
   * Per-scene background image relative paths (auto-illustration). Keyed by scene id.
   * Wins over bgImageRelPath for that scene's background.
   */
  sceneBg?: Record<string, string>;
  /**
   * Video format. Defaults to the script's own `format` field, then "short".
   * Drives stage dimensions (short 1080×1920, long 1920×1080) and the
   * `format-*` CSS class.
   */
  format?: VideoFormat;
  /**
   * Shell brand tag override. Precedence: this arg → script metadata
   * `brandTag` → per-format default (short "IT NEWS", long "CODE TIPS").
   */
  brandTag?: string;
}

export function composeHtml(args: ComposeArgs): string {
  const { script, sceneAudio, gapSec, bgImageRelPath, audioRelPath } = args;
  const tiktok = args.tiktok ?? DEFAULT_TIKTOK;
  const tiktokAvatar = args.tiktokAvatarRelPath ?? "tiktok-avatar.jpg";
  const outroHoldSec = args.outroHoldSec ?? 3;
  const sceneBg = args.sceneBg ?? {};
  const format: VideoFormat = args.format ?? script.format ?? "short";
  const dims = dimensionsForFormat(format);
  const brandTag = args.brandTag ?? script.metadata.brandTag ?? DEFAULT_BRAND_TAG_BY_FORMAT[format];

  // Compute timing per scene. Outro scene gets extra HOLD seconds so the
  // TikTok follow card stays visible after the voice ends.
  let cursor = 0;
  const timing = script.scenes.map((scene) => {
    const audio = sceneAudio.find((a) => a.id === scene.id);
    if (!audio) throw new Error(`No audio entry for scene id=${scene.id}`);
    const isOutro = scene.type === "outro";
    const dur = audio.durationSec + gapSec + (isOutro ? outroHoldSec : 0);
    const start = cursor;
    cursor += dur;
    return { scene, start, duration: dur };
  });
  const totalDuration = cursor;

  // Render scenes
  const sceneHtml = timing.map(({ scene, start, duration }) => {
    return renderScene(scene, start, duration, bgImageRelPath, sceneBg, tiktok, tiktokAvatar, format);
  }).join("\n");

  // Persistent shell — uses tiktok handle in footer
  const shellHtml = renderShell(script.metadata, brandTag);

  const animJs = readFileSync(join(TPL_DIR, "animations.js"), "utf8");
  // Vendored locally: the render sandbox cannot reach CDNs (GSAP/Google Fonts
  // time out -> scenes stay at opacity 0). Inline both instead of linking.
  const gsapJs = readFileSync(join(TPL_DIR, "gsap.min.js"), "utf8");
  const fontsCss = readFileSync(join(TPL_DIR, "fonts.css"), "utf8");

  const tpl = readFileSync(join(TPL_DIR, "base.html.tmpl"), "utf8");
  return tpl
    .replace(/\{\{WIDTH\}\}/g, String(dims.width))
    .replace(/\{\{HEIGHT\}\}/g, String(dims.height))
    .replace(/\{\{FORMAT\}\}/g, format)
    .replace("{{TITLE}}", escapeHtml(script.metadata.title))
    .replace(/\{\{TOTAL_DURATION\}\}/g, totalDuration.toFixed(2))
    .replace("{{SHELL}}", shellHtml)
    .replace("{{SCENES}}", sceneHtml)
    .replace(/src="voice\.mp3"/g, `src="${audioRelPath}"`)
    .replace('<script src="animations.js"></script>', `<script>\n${animJs}\n</script>`)
    .replace('<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>', `<script>\n${gsapJs}\n</script>`)
    .replace('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Anton&family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;700;800&display=swap" rel="stylesheet">', `<style>\n${fontsCss}\n</style>`);
}

// ── PERSISTENT SHELL ───────────────────────────────────────────────────────
function renderShell(metadata: Script["metadata"], brandTag: string): string {
  const channel = escapeHtml(metadata.channel);
  const domain = escapeHtml(metadata.source.domain);
  return `
<!-- Shell: persistent brand elements (no data-start → always visible) -->
<div class="shell-bg"></div>

<div class="brand-shell-header">
  <div class="brand-icon">&gt;_</div>
  <div class="brand-text">
    <div class="brand-name">${channel}</div>
    <div class="brand-tag">${escapeHtml(brandTag)}</div>
  </div>
</div>

<div class="brand-shell-keyword">
  <span>${escapeHtml(domain)}</span>
</div>

${VIGNETTE_HTML}
${GRAIN_OVERLAY_HTML}`.trim();
}

// ── SCENE DISPATCH ─────────────────────────────────────────────────────────
function renderScene(
  scene: Script["scenes"][number],
  start: number,
  duration: number,
  bgImageRelPath: string | null,
  sceneBg: Record<string, string>,
  tiktok: TiktokConfig,
  tiktokAvatarRelPath: string,
  format: VideoFormat,
): string {
  const td = scene.templateData;

  let inner: string;
  let layoutName: string;

  switch (td.template) {
    case "hook":
      inner = renderHookInner(td, bgImageRelPath);
      layoutName = "hook";
      break;
    case "comparison":
      inner = renderComparisonInner(td);
      layoutName = "comparison";
      break;
    case "stat-hero":
      inner = renderStatHeroInner(td, td.bgSrc?.startsWith("media/") ? td.bgSrc : (sceneBg[scene.id] ?? null));
      layoutName = "stat-hero";
      break;
    case "feature-list":
      inner = renderFeatureListInner(td, td.bgSrc?.startsWith("media/") ? td.bgSrc : (sceneBg[scene.id] ?? null));
      layoutName = "feature-list";
      break;
    case "callout":
      inner = renderCalloutInner(td, td.bgSrc?.startsWith("media/") ? td.bgSrc : (sceneBg[scene.id] ?? null));
      layoutName = "callout";
      break;
    case "media-strip":
      inner = renderMediaStripInner(td);
      layoutName = "media-strip";
      break;
    case "outro":
      inner = renderOutroInner(td, tiktok, tiktokAvatarRelPath, format);
      layoutName = "outro";
      break;
    case "chapter":
      inner = renderChapterInner(td);
      layoutName = "chapter";
      break;
    case "code-demo":
      inner = renderCodeDemoInner(td);
      layoutName = "code-demo";
      break;
    default: {
      const _never: never = td;
      throw new Error(`Unknown template: ${(_never as any).template}`);
    }
  }

  return buildScene(scene, start, duration, layoutName, inner);
}

/** Photo background layer behind a body-scene card (auto-illustration). */
function renderSceneBgLayer(relPath: string): string {
  return `<div class="scene-bg" style="background-image: url('${relPath}')"></div>
  <div class="scene-bg-overlay"></div>`;
}

// ── HOOK SCENE ─────────────────────────────────────────────────────────────
function renderHookInner(td: Extract<TemplateDataType, { template: "hook" }>, bgImageRelPath: string | null): string {
  // Background
  const hasImage = Boolean(td.bgSrc && bgImageRelPath);
  let bgHtml: string;
  if (hasImage) {
    // Ken Burns image
    const kbClass = td.kenBurns ?? "zoom-in";
    bgHtml = `<div class="bg kb-${kbClass}" style="background-image: url('${bgImageRelPath}')"></div>`;
  } else {
    bgHtml = `<div class="bg gradient-news-dark"></div>`;
  }
  // Only darken when there's a real photo to tame for text legibility —
  // our own gradient backgrounds are already tuned for contrast, and a flat
  // black scrim on top of them just muddies the theme's colors (esp. light-pro).
  const overlayHtml = hasImage ? `<div class="overlay" style="opacity: 0.55"></div>` : "";

  const headline = escapeHtml(td.headline);
  const subhead = td.subhead ? escapeHtml(td.subhead) : "";

  return `${bgHtml}
  ${overlayHtml}
  <div class="layout-hook">
    <div class="hook-headline shimmer-sweep-target">${headline}</div>
    ${subhead ? `<div class="hook-subhead">${subhead}</div>` : ""}
  </div>`;
}

// ── COMPARISON SCENE ───────────────────────────────────────────────────────
function renderComparisonInner(td: Extract<TemplateDataType, { template: "comparison" }>): string {
  const lColor = td.left.color;  // "cyan" | "purple"
  const rColor = td.right.color;

  const winnerClass = td.right.winner ? " card-winner" : "";

  return `
<div class="layout-comparison">
  <div class="cmp-card cmp-left color-${lColor}">
    <div class="cmp-label">${escapeHtml(td.left.label)}</div>
    <div class="cmp-value">${escapeHtml(td.left.value)}</div>
  </div>
  <div class="cmp-vs">VS</div>
  <div class="cmp-card cmp-right color-${rColor}${winnerClass}">
    <div class="cmp-label">${escapeHtml(td.right.label)}</div>
    <div class="cmp-value">${escapeHtml(td.right.value)}</div>
    ${td.right.winner ? '<div class="cmp-winner-badge">WINNER</div>' : ""}
  </div>
</div>`.trim();
}

// ── STAT HERO SCENE ────────────────────────────────────────────────────────
function renderStatHeroInner(td: Extract<TemplateDataType, { template: "stat-hero" }>, bgRelPath: string | null): string {
  const context = td.context ? `<div class="stat-context">${escapeHtml(td.context)}</div>` : "";
  const bgLayer = bgRelPath ? renderSceneBgLayer(bgRelPath) : "";
  return `${bgLayer}
<div class="layout-stat-hero">
  <div class="stat-value shimmer-sweep-target">${escapeHtml(td.value)}</div>
  <div class="stat-label">${escapeHtml(td.label)}</div>
  ${context}
</div>`.trim();
}

// ── FEATURE LIST SCENE ─────────────────────────────────────────────────────
function renderFeatureListInner(td: Extract<TemplateDataType, { template: "feature-list" }>, bgRelPath: string | null): string {
  const bullets = td.bullets.map((b, i) =>
    `<div class="feat-bullet feat-bullet-${i}" data-idx="${i}">
      <div class="feat-dot"></div>
      <div class="feat-text">${escapeHtml(b)}</div>
    </div>`
  ).join("\n    ");

  const hasVideo = Boolean(td.videoSrc);
  const demoVideo = hasVideo ? renderDemoVideo(td.videoSrc!) : "";

  const bgLayer = bgRelPath ? renderSceneBgLayer(bgRelPath) : "";

  return `${bgLayer}
<div class="layout-feature-list${hasVideo ? " layout-feature-list--stacked" : ""}">
  <div class="feat-card">
    <div class="feat-title">${escapeHtml(td.title)}</div>
    <div class="feat-rule"></div>
    <div class="feat-bullets">
      ${bullets}
    </div>
  </div>
  ${demoVideo}
</div>`.trim();
}

// ── DEMO VIDEO FRAME (feature-list videoSrc) ───────────────────────────────
function renderDemoVideo(videoSrc: string): string {
  return `
<div class="demo-video-wrap">
  <div class="demo-video-frame">
    <div class="demo-video-titlebar">
      <span class="demo-dot red"></span><span class="demo-dot yellow"></span><span class="demo-dot green"></span>
      <span class="demo-video-title">Orca</span>
    </div>
    <video class="demo-video-el" src="${escapeHtml(videoSrc)}" muted playsinline loop autoplay
           data-start="0" data-duration="9999" data-track-index="1"></video>
  </div>
</div>`.trim();
}

// ── CALLOUT SCENE ──────────────────────────────────────────────────────────
function renderCalloutInner(td: Extract<TemplateDataType, { template: "callout" }>, bgRelPath: string | null): string {
  const tag = td.tag ? `<div class="callout-tag">${escapeHtml(td.tag)}</div>` : "";
  const bgLayer = bgRelPath ? renderSceneBgLayer(bgRelPath) : "";
  const image = td.imageSrc ? renderCalloutImage(td.imageSrc) : "";
  return `${bgLayer}
<div class="layout-callout${td.imageSrc ? " layout-callout--with-image" : ""}">
  <div class="callout-card">
    ${tag}
    <div class="callout-statement">${escapeHtml(td.statement)}</div>
  </div>
  ${image}
</div>`.trim();
}

/** Illustration image below the callout card (terminal-style frame). */
function renderCalloutImage(imageSrc: string): string {
  return `
<div class="callout-image-wrap">
  <div class="callout-image-frame">
    <div class="callout-image-titlebar">
      <span class="demo-dot red"></span><span class="demo-dot yellow"></span><span class="demo-dot green"></span>
      <span class="callout-image-title">Settings</span>
    </div>
    <img class="callout-image-el" src="${escapeHtml(imageSrc)}" alt="" />
  </div>
</div>`.trim();
}

// ── MEDIA STRIP SCENE (scraped-article gallery) ────────────────────────────
function renderMediaStripInner(td: Extract<TemplateDataType, { template: "media-strip" }>): string {
  const items = td.items.map((item, i) => {
    const isVideo = /\.(mp4|webm|mov)$/i.test(item.src);
    const mediaEl = isVideo
      ? `<video class="strip-media" src="${escapeHtml(item.src)}" muted playsinline loop autoplay
           data-start="0" data-duration="9999" data-track-index="${i + 1}"></video>`
      : `<img class="strip-media" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.caption ?? "")}" crossorigin="anonymous" />`;
    return `
    <div class="strip-item strip-item-${i}">
      <div class="strip-frame">${mediaEl}</div>
      ${item.caption ? `<div class="strip-caption">${escapeHtml(item.caption)}</div>` : ""}
    </div>`;
  }).join("\n");

  return `
<div class="layout-media-strip">
  <div class="strip-title">${escapeHtml(td.title)}</div>
  <div class="strip-track">
    ${items}
  </div>
</div>`.trim();
}

// ── OUTRO SCENE ────────────────────────────────────────────────────────────
function renderOutroInner(
  td: Extract<TemplateDataType, { template: "outro" }>,
  tiktok: TiktokConfig,
  avatarRelPath: string,
  format: VideoFormat,
): string {
  // Long outro (Henry's outro-v2 rule): hero line once, then a card that
  // holds ONLY the Subscribe button — no avatar, no display name repeat.
  const ttCard = format === "long"
    ? renderSubscribeOnlyCard()
    : renderTiktokCard(tiktok, avatarRelPath);
  return `
<div class="layout-outro">
  <div class="out-cta-top">${escapeHtml(td.ctaTop)}</div>
  <div class="out-channel">${escapeHtml(td.channelName)}</div>
  <div class="out-underline"></div>
  <div class="out-source">Nguồn: ${escapeHtml(td.source)}</div>
</div>
${ttCard}`.trim();
}

/**
 * Subscribe-only card for the long outro: just the Subscribe button
 * (same ids as the TikTok card so animations.js drives it unchanged),
 * centred, with no avatar and no channel/display name.
 */
function renderSubscribeOnlyCard(): string {
  return `
<div id="tt-card" class="tt-card tt-card--subscribe-only">
  <div id="tt-follow-btn" class="tt-follow-btn">
    <span id="tt-btn-follow" class="tt-btn-text">Subscribe</span>
    <span id="tt-btn-following" class="tt-btn-text tt-btn-text-following">
      <span>Subscribed</span>
      <span class="tt-check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
    </span>
  </div>
</div>`.trim();
}

/**
 * TikTok follow card — adapted from HyperFrames `tiktok-follow` block.
 * Slides up from bottom mid-outro. Animations are added by animations.js
 * targeting elements with id="tt-card", id="tt-follow-btn", etc.
 */
function renderTiktokCard(tiktok: TiktokConfig, avatarRelPath: string): string {
  return `
<div id="tt-card" class="tt-card">
  <img class="tt-avatar" src="${escapeHtml(avatarRelPath)}" alt="${escapeHtml(tiktok.displayName)}" crossorigin="anonymous" />
  <div class="tt-profile-info">
    <div class="tt-display-name">${escapeHtml(tiktok.displayName)}</div>
  </div>
  <div id="tt-follow-btn" class="tt-follow-btn">
    <span id="tt-btn-follow" class="tt-btn-text">Subscribe</span>
    <span id="tt-btn-following" class="tt-btn-text tt-btn-text-following">
      <span>Subscribed</span>
      <span class="tt-check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
    </span>
  </div>
</div>`.trim();
}

// ── CHAPTER SCENE (long only) ──────────────────────────────────────────────
function renderChapterInner(td: Extract<TemplateDataType, { template: "chapter" }>): string {
  const indexDisplay = td.index === undefined
    ? ""
    : typeof td.index === "number" ? String(td.index).padStart(2, "0") : td.index;
  return `
<div class="layout-chapter">
  ${indexDisplay ? `<div class="chapter-kicker">CHƯƠNG ${escapeHtml(indexDisplay)}</div>
  <div class="chapter-number">${escapeHtml(indexDisplay)}</div>` : ""}
  <div class="chapter-title">${escapeHtml(td.title)}</div>
  <div class="chapter-rule"></div>
  ${td.subtitle ? `<div class="chapter-subtitle">${escapeHtml(td.subtitle)}</div>` : ""}
</div>`.trim();
}

// ── CODE DEMO SCENE (long only) ────────────────────────────────────────────
/**
 * Code rendered as a real VS Code window: title bar with traffic-light
 * dots, a tab showing the filename, a line-number gutter, JetBrains Mono
 * on the Dark+ palette (#1e1e1e), highlighted lines with a subtle
 * background + left accent. Density class scales the font down so a full
 * 30-line file fits a 1080px-high landscape frame without overflow:
 * default ≤12 lines, --medium ≤20, --dense >20.
 */
function renderCodeDemoInner(td: Extract<TemplateDataType, { template: "code-demo" }>): string {
  const highlighted = new Set(td.highlightLines ?? []);
  const density = td.code.length > 20 ? " code-window--dense" : td.code.length > 12 ? " code-window--medium" : "";
  const layoutDensity = td.code.length > 20 ? " layout-code-demo--dense" : "";
  const lineOffset = td.lineOffset ?? 0;
  const lines = td.code.map((line, i) => {
    const n = lineOffset + i + 1;
    const hl = highlighted.has(n) ? " code-line-hl" : "";
    const html = highlightCodeLine(line);
    return `<div class="code-line${hl}"><span class="code-lineno">${n}</span><span class="code-text">${html === "" ? "&nbsp;" : html}</span></div>`;
  }).join("\n      ");

  return `
<div class="layout-code-demo${layoutDensity}">
  ${td.title ? `<div class="code-demo-title">${escapeHtml(td.title)}</div>` : ""}
  <div class="code-window${density}" data-lines="${td.code.length}">
    <div class="code-titlebar">
      <span class="demo-dot red"></span><span class="demo-dot yellow"></span><span class="demo-dot green"></span>
      <span class="code-titlebar-name">${escapeHtml(td.filename)} — Visual Studio Code</span>
    </div>
    <div class="code-tabbar">
      <div class="code-tab code-tab-active">
        <span class="code-tab-name">${escapeHtml(td.filename)}</span>
        <span class="code-tab-close">×</span>
      </div>
    </div>
    <div class="code-body">
      <div class="code-lines">
      ${lines}
      </div>
    </div>
    <div class="code-statusbar">
      <span class="code-status-item">main*</span>
      <span class="code-status-item">${escapeHtml(td.language ?? "JavaScript JSX")}</span>
      <span class="code-status-item">UTF-8</span>
      <span class="code-status-item">Spaces: 2</span>
    </div>
  </div>
  ${td.caption ? `<div class="code-demo-caption">${escapeHtml(td.caption)}</div>` : ""}
</div>`.trim();
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function buildScene(
  scene: Script["scenes"][number],
  start: number,
  duration: number,
  layoutName: string,
  innerHtml: string,
): string {
  return `
<div class="scene clip" id="scene-${scene.id}"
     data-start="${start.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-active="0"
     data-layout="${layoutName}">
  ${innerHtml}
</div>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
