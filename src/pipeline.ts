import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { ScriptSchema, type Script } from "./render/script-schema.js";
import { loadConfig } from "./config.js";
import { createTtsClient } from "./tts/tts-client.js";
import { fetchImage } from "./assets/image-fetcher.js";
import { extractMediaFromHtml, type ScrapedMediaItem } from "./assets/media-extractor.js";
import { downloadMedia, type ManifestEntry } from "./assets/media-downloader.js";
import { buildMergedSrt } from "./assets/srt-merge.js";
import { getDurationSec, concatWithSilence, mixSfxOntoVoice, type SfxMixSpec } from "./assets/audio-tools.js";
import { indexSfxLibrary, pickSfxForScene, defaultPlayback } from "./assets/sfx-selector.js";
import { existsSync } from "node:fs";
import { composeHtml } from "./render/html-composer.js";
import { renderWithHyperframes } from "./render/hyperframes-runner.js";
import { log } from "./utils/logger.js";

const TOTAL_STEPS = 8;
const DURATION_MIN_SEC = 48;
const DURATION_MAX_SEC = 72;
const SCENE_GAP_SEC = 0.3;
/**
 * Extra seconds added to the outro scene visual duration AFTER the voice ends.
 * Gives the TikTok follow card time to be read by the viewer (otherwise the
 * video ends a few hundred ms after the card slides up + click animation).
 * Audio stays silent during this hold; visual stays on screen.
 */
const OUTRO_HOLD_SEC = 3;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_DIR = join(__dirname, "render", "templates");
/** Path to the SFX library (relative to project root) */
const SFX_DIR = join(__dirname, "..", "assets", "sfx");

const HYPERFRAMES_CONFIG = {
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  paths: {
    blocks: "compositions",
    components: "compositions/components",
    assets: "assets",
  },
};

/**
 * Fetch the article HTML and scrape extra photos/videos from it.
 * Never throws — returns [] on any failure (illustration is best-effort).
 * Reads the scraped HTML from <outputDir>/article.html when present (written
 * by the agent during content prep), else fetches metadata.source.url.
 */
async function scrapeArticleMedia(script: Script, outputDir: string): Promise<ScrapedMediaItem[]> {
  try {
    let html: string | null = null;
    const articlePath = join(outputDir, "article.html");
    if (existsSync(articlePath)) {
      html = await readFile(articlePath, "utf8");
    } else if (/^https?:/.test(script.metadata.source.url)) {
      const axios = (await import("axios")).default;
      const resp = await axios.get<string>(script.metadata.source.url, {
        responseType: "text",
        timeout: 30_000,
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        validateStatus: (s) => s < 400,
      });
      html = resp.data;
    }
    if (!html) return [];
    const items = extractMediaFromHtml(html, script.metadata.source.url);
    log.info(`  scraped ${items.length} media candidates from article`);
    return items;
  } catch (e: any) {
    log.warn(`article media scrape failed (${String(e.message ?? e)}) → skipping illustration`);
    return [];
  }
}

/** Resolve "$media.N" placeholders in a scene's templateData to local paths. */
function resolveMediaPlaceholders(script: Script, manifest: ManifestEntry[]): void {
  const map = new Map(manifest.map((e) => [e.placeholder, e]));
  for (const scene of script.scenes) {
    const td = scene.templateData as Record<string, unknown>;
    for (const key of ["bgSrc", "videoSrc", "imageSrc"]) {
      const v = td[key];
      if (typeof v === "string" && v.startsWith("$media.")) {
        const entry = map.get(v);
        if (entry) td[key] = entry.relPath;
        else delete td[key]; // placeholder points at a failed download → drop
      }
    }
    if (td.template === "media-strip" && Array.isArray(td.items)) {
      td.items = (td.items as { src: string; caption?: string }[]).filter((item) => {
        if (item.src.startsWith("$media.")) {
          const entry = map.get(item.src);
          if (entry) item.src = entry.relPath;
          return Boolean(entry);
        }
        return true;
      });
    }
  }
}

/**
 * Auto-illustration: assign downloaded article photos as backgrounds for
 * plain body scenes (stat-hero / feature-list / callout) that don't already
 * have a bgSrc. Sequential assignment, one photo per scene, skipping photos
 * already used by the hook bg or explicit references.
 */
function autoIllustrateScenes(script: Script, manifest: ManifestEntry[], usedRelPaths: Set<string>): Record<string, string> {
  const sceneBg: Record<string, string> = {};
  const pool = manifest.filter((e) => e.kind === "image" && !usedRelPaths.has(e.relPath));
  if (pool.length === 0) return sceneBg;

  const eligible = script.scenes.filter((s) => {
    const t = s.templateData.template;
    if (s.type !== "body") return false;
    if (t !== "stat-hero" && t !== "feature-list" && t !== "callout") return false;
    const td = s.templateData as { bgSrc?: string; imageSrc?: string };
    // imageSrc = dedicated illustration below the card → no bg photo wanted.
    return !td.bgSrc && !td.imageSrc;
  });

  let i = 0;
  for (const scene of eligible) {
    if (i >= pool.length) break;
    sceneBg[scene.id] = pool[i].relPath;
    log.info(`  auto-illustrate scene ${scene.id} ← ${pool[i].relPath}`);
    i += 1;
  }
  return sceneBg;
}

export async function runPipeline(scriptPath: string): Promise<void> {
  const cfg = loadConfig();
  const outputDir = dirname(scriptPath);
  log.info(`Output directory: ${outputDir}`);

  // STEP 1
  log.step(1, TOTAL_STEPS, `Load env + validate script.json (TTS provider: ${cfg.ttsProvider})`);
  const raw = JSON.parse(await readFile(scriptPath, "utf8"));
  // Substitute env placeholder before validation (works for all providers)
  if (raw.voice?.voiceId === "${VIETNAMESE_VOICEID}" || raw.voice?.voiceId === "${VOICE_ID}") {
    raw.voice.voiceId =
      cfg.ttsProvider === "edge-tts" ? cfg.edgeTtsVoice
      : cfg.ttsProvider === "lucylab" ? cfg.lucylabVoiceId!
      : cfg.ttsProvider === "elevenlabs" ? cfg.elevenlabsVoiceId!
      : cfg.ttsProvider === "google-tts" ? cfg.googleVoice
      : cfg.vbeeVoiceCode;
  }
  const script: Script = ScriptSchema.parse(raw);

  // STEP 2
  log.step(2, TOTAL_STEPS, "Write script.txt for CapCut");
  const fullText = script.scenes.map((s) => s.voiceText).join("\n\n");
  await writeFile(join(outputDir, "script.txt"), fullText);

  // STEP 3 + 4 in parallel
  log.step(3, TOTAL_STEPS, "Fetch og:image + scrape article media (parallel) + Step 4 TTS");
  const imgPath = join(outputDir, "images", "bg.jpg");
  const imgPromise = fetchImage(script.metadata.source.image, imgPath);

  // Scrape + download article media in the background (best-effort illustration)
  const mediaPromise = (async () => {
    let scraped = await scrapeArticleMedia(script, outputDir);
    // The og:image already lands as the hook bg — don't duplicate it in the strip
    const ogImage = script.metadata.source.image;
    if (ogImage) scraped = scraped.filter((m) => m.url !== ogImage);
    if (scraped.length === 0) return { entries: [] as ManifestEntry[] };
    const { entries, failures } = await downloadMedia(scraped, outputDir);
    for (const f of failures.slice(0, 3)) log.warn(`  media download failed: ${f.url} (${f.reason})`);
    log.info(`  article media: ${entries.length} downloaded → media/`);
    return { entries };
  })();

  // STEP 4
  const ttsClient = createTtsClient(cfg);
  // Concurrency: LucyLab requires 1 (only 1 concurrent export per key);
  // ElevenLabs supports parallel calls but we keep 1 by default to be polite.
  const limit = pLimit(cfg.ttsConcurrency);
  const voiceDir = join(outputDir, "voice");
  await mkdir(voiceDir, { recursive: true });

  const sceneAudioPromises = script.scenes.map((scene) =>
    limit(async () => {
      const out = join(voiceDir, `scene-${scene.id}.mp3`);
      const srtOut = join(voiceDir, `scene-${scene.id}.srt`);

      // IDEMPOTENT: skip TTS if voice file already exists.
      // To force re-TTS for a scene, delete its mp3 file before running.
      // This saves API quota when only some scenes' voiceText changed.
      if (existsSync(out)) {
        const dur = await getDurationSec(out);
        log.info(`  scene ${scene.id}: REUSE existing mp3 (${dur.toFixed(2)}s) — delete to force re-TTS`);
        return { id: scene.id, path: out, durationSec: dur };
      }

      log.info(`  TTS scene ${scene.id} (${scene.voiceText.length} chars)...`);
      await ttsClient.generate(scene.voiceText, out, srtOut);
      const dur = await getDurationSec(out);
      log.info(`  scene ${scene.id}: ${dur.toFixed(2)}s`);
      return { id: scene.id, path: out, durationSec: dur };
    }),
  );

  const [imgResult, mediaResult, sceneAudio] = await Promise.all([
    imgPromise,
    mediaPromise,
    Promise.all(sceneAudioPromises),
  ]);

  let bgImageRelPath: string | null = null;
  if (imgResult.success) {
    bgImageRelPath = "images/bg.jpg";
  } else {
    log.warn(`Background image fetch failed: ${imgResult.reason} → using gradient fallback`);
  }

  // Resolve "$media.N" placeholders → local paths, then auto-illustrate
  // remaining plain body scenes with unused article photos.
  const manifest = mediaResult.entries;
  resolveMediaPlaceholders(script, manifest);
  const usedRelPaths = new Set<string>();
  if (bgImageRelPath) usedRelPaths.add(bgImageRelPath);
  for (const scene of script.scenes) {
    const td = scene.templateData as { bgSrc?: string; videoSrc?: string; items?: { src: string }[] };
    if (td.bgSrc?.startsWith("media/")) usedRelPaths.add(td.bgSrc);
    if (td.videoSrc?.startsWith("media/")) usedRelPaths.add(td.videoSrc);
    for (const item of td.items ?? []) if (item.src.startsWith("media/")) usedRelPaths.add(item.src);
  }
  const sceneBg = autoIllustrateScenes(script, manifest, usedRelPaths);

  // STEP 5
  log.step(5, TOTAL_STEPS, "Concat voice scenes + mix SFX layer");
  const voiceRawMp3 = join(outputDir, "voice-raw.mp3");
  const voiceMp3 = join(outputDir, "voice.mp3");
  await concatWithSilence(sceneAudio.map((a) => a.path), SCENE_GAP_SEC, voiceRawMp3);

  // Compute scene start times (cumulative voice durations + gaps)
  let cursor = 0;
  const sceneStarts: Record<string, number> = {};
  for (const a of sceneAudio) {
    sceneStarts[a.id] = cursor;
    cursor += a.durationSec + SCENE_GAP_SEC;
  }

  // Build SFX mix list using smart 3-tier selector
  const sfxIndex = indexSfxLibrary(SFX_DIR);
  const indexCats = Object.keys(sfxIndex).length;
  const indexFiles = Object.values(sfxIndex).reduce((s, a) => s + a.length, 0);
  log.info(`  SFX library: ${indexFiles} files in ${indexCats} categories`);

  const sfxList: SfxMixSpec[] = [];
  for (const scene of script.scenes) {
    const startSec = sceneStarts[scene.id];

    // Tier 1: explicit override in script.json
    if (scene.sfx) {
      if (scene.sfx.name === "none") {
        log.info(`  scene ${scene.id}: SFX disabled (explicit "none")`);
        continue;
      }
      const sfxPath = join(SFX_DIR, `${scene.sfx.name}.mp3`);
      if (existsSync(sfxPath)) {
        sfxList.push({ path: sfxPath, startSec: startSec + scene.sfx.startOffsetSec, volume: scene.sfx.volume });
        log.info(`  scene ${scene.id}: SFX override -> ${scene.sfx.name}.mp3`);
      } else {
        log.warn(`  scene ${scene.id}: explicit SFX not found, skipping: ${scene.sfx.name}.mp3`);
      }
      continue;
    }

    // Tier 2/3: smart selection by content + template
    const picked = pickSfxForScene({
      voiceText: scene.voiceText,
      templateName: scene.templateData.template,
      sceneId: scene.id,
      index: sfxIndex,
    });
    if (!picked) {
      log.warn(`  scene ${scene.id}: no SFX available (empty library?)`);
      continue;
    }

    const sfxPath = join(SFX_DIR, picked.relPath);
    const playback = defaultPlayback(picked);
    sfxList.push({ path: sfxPath, startSec: startSec + playback.offsetSec, volume: playback.volume });

    const why = picked.source === "semantic"
      ? `semantic match "${picked.matchedKeyword}"`
      : picked.source;
    log.info(`  scene ${scene.id}: SFX -> ${picked.relPath} (${why})`);
  }
  log.info(`  mixing ${sfxList.length} SFX into voice.mp3`);
  await mixSfxOntoVoice(voiceRawMp3, sfxList, voiceMp3);

  const totalAudioSec = await getDurationSec(voiceMp3);
  log.info(`  voice.mp3 total: ${totalAudioSec.toFixed(2)}s`);
  if (totalAudioSec < DURATION_MIN_SEC || totalAudioSec > DURATION_MAX_SEC) {
    log.warn(`Total duration ${totalAudioSec.toFixed(1)}s outside [${DURATION_MIN_SEC}, ${DURATION_MAX_SEC}]s tolerance — proceeding anyway`);
  }

  // Merged, timeline-accurate subtitles (matches the final video exactly)
  const mergedSrt = await buildMergedSrt(
    sceneAudio.map((a) => ({ id: a.id, durationSec: a.durationSec })),
    voiceDir,
    SCENE_GAP_SEC,
  );
  if (mergedSrt) {
    await writeFile(join(outputDir, "subtitles.srt"), mergedSrt);
    log.info(`  subtitles.srt written (${mergedSrt.split("\n\n").length} cues)`);
  } else {
    log.warn("no per-scene SRT available → skipping subtitles.srt");
  }

  // STEP 6 — Compose HTML + write hyperframes project files
  log.step(6, TOTAL_STEPS, "Compose HTML + project files");

  // Resolve TikTok avatar — download URL if provided, else copy bundled default
  // Bundled avatar can be jpg/jpeg/png/webp — pick whichever exists
  const findBundledAvatar = (): string => {
    const baseDir = join(__dirname, "..", "assets");
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const p = join(baseDir, `avatar.${ext}`);
      if (existsSync(p)) return p;
    }
    throw new Error(`No bundled avatar found. Place an image at assets/avatar.{jpg,png,webp}`);
  };
  const bundledAvatar = findBundledAvatar();
  const ttAvatarExt = bundledAvatar.split(".").pop()!.toLowerCase();
  const ttAvatarFile = `tiktok-avatar.${ttAvatarExt}`;
  const ttAvatarOut = join(outputDir, ttAvatarFile);
  if (cfg.tiktok.avatarUrl) {
    const r = await fetchImage(cfg.tiktok.avatarUrl, ttAvatarOut);
    if (!r.success) {
      log.warn(`TikTok avatar download failed: ${r.reason} → falling back to bundled default`);
      await copyFile(bundledAvatar, ttAvatarOut);
    }
  } else {
    await copyFile(bundledAvatar, ttAvatarOut);
  }

  const html = composeHtml({
    script,
    sceneAudio: sceneAudio.map((a) => ({ id: a.id, durationSec: a.durationSec })),
    gapSec: SCENE_GAP_SEC,
    bgImageRelPath,
    sceneBg,
    audioRelPath: "voice.mp3",
    tiktok: cfg.tiktok,
    tiktokAvatarRelPath: ttAvatarFile,
    outroHoldSec: OUTRO_HOLD_SEC,
  });

  // hyperframes expects: index.html (NOT composition.html), hyperframes.json, meta.json in DIR
  await writeFile(join(outputDir, "index.html"), html);

  await writeFile(join(outputDir, "hyperframes.json"), JSON.stringify(HYPERFRAMES_CONFIG, null, 2));

  const slug = basename(outputDir);
  await writeFile(join(outputDir, "meta.json"), JSON.stringify({
    id: slug,
    name: script.metadata.title,
    createdAt: new Date().toISOString(),
  }, null, 2));

  // Copy templates next to the index.html so relative paths resolve.
  // base.html.tmpl + animations.js are shared across themes (structure/behavior);
  // only styles.<theme>.css differs (visual look), and always lands as "styles.css".
  const themeFile =
    cfg.videoTheme === "light-pro" ? "styles.light-pro.css" :
    cfg.videoTheme === "dev-terminal" ? "styles.dev-terminal.css" :
    "styles.css";
  await copyFile(join(TPL_DIR, themeFile),       join(outputDir, "styles.css"));
  await copyFile(join(TPL_DIR, "animations.js"), join(outputDir, "animations.js"));

  // STEP 7
  log.step(7, TOTAL_STEPS, "Render with hyperframes");
  const videoPath = join(outputDir, "video.mp4");
  await renderWithHyperframes({ compositionDir: outputDir, outputPath: videoPath });

  // STEP 8
  log.step(8, TOTAL_STEPS, "Done");
  console.log("\n=== Result ===");
  console.log(`Video:  ${videoPath}`);
  console.log(`Audio:  ${voiceMp3}  (cho CapCut)`);
  console.log(`Subs:   ${join(outputDir, "subtitles.srt")}  (khớp timeline video)`);
  console.log(`Script: ${join(outputDir, "script.txt")}  (cho CapCut auto-caption)`);
  console.log(`Tong thoi luong: ${totalAudioSec.toFixed(2)}s`);
}
