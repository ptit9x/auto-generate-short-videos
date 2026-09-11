import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Script, TemplateDataType } from "./script-schema.js";
import type { TiktokConfig } from "../config.js";

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
}

export function composeHtml(args: ComposeArgs): string {
  const { script, sceneAudio, gapSec, bgImageRelPath, audioRelPath } = args;
  const tiktok = args.tiktok ?? DEFAULT_TIKTOK;
  const tiktokAvatar = args.tiktokAvatarRelPath ?? "tiktok-avatar.jpg";
  const outroHoldSec = args.outroHoldSec ?? 3;
  const sceneBg = args.sceneBg ?? {};

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
    return renderScene(scene, start, duration, bgImageRelPath, sceneBg, tiktok, tiktokAvatar);
  }).join("\n");

  // Persistent shell — uses tiktok handle in footer
  const shellHtml = renderShell(script.metadata);

  const animJs = readFileSync(join(TPL_DIR, "animations.js"), "utf8");

  const tpl = readFileSync(join(TPL_DIR, "base.html.tmpl"), "utf8");
  return tpl
    .replace("{{TITLE}}", escapeHtml(script.metadata.title))
    .replace(/\{\{TOTAL_DURATION\}\}/g, totalDuration.toFixed(2))
    .replace("{{SHELL}}", shellHtml)
    .replace("{{SCENES}}", sceneHtml)
    .replace(/src="voice\.mp3"/g, `src="${audioRelPath}"`)
    .replace('<script src="animations.js"></script>', `<script>\n${animJs}\n</script>`);
}

// ── PERSISTENT SHELL ───────────────────────────────────────────────────────
function renderShell(metadata: Script["metadata"]): string {
  const channel = escapeHtml(metadata.channel);
  const domain = escapeHtml(metadata.source.domain);
  return `
<!-- Shell: persistent brand elements (no data-start → always visible) -->
<div class="shell-bg"></div>

<div class="brand-shell-header">
  <div class="brand-icon">&gt;_</div>
  <div class="brand-text">
    <div class="brand-name">${channel}</div>
    <div class="brand-tag">IT NEWS</div>
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
      inner = renderOutroInner(td, tiktok, tiktokAvatarRelPath);
      layoutName = "outro";
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
): string {
  const ttCard = renderTiktokCard(tiktok, avatarRelPath);
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
