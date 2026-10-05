import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { composeHtml } from "./html-composer.js";
import type { Script } from "./script-schema.js";

describe("composeHtml", () => {
  it("produces deterministic HTML for sample script with image", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-script-with-image.json", "utf8")) as Script;
    const sceneAudio = [
      { id: "hook",   durationSec: 3.2 },
      { id: "body-1", durationSec: 11.5 },
      { id: "body-2", durationSec: 10.8 },
      { id: "body-3", durationSec: 12.1 },
      { id: "outro",  durationSec: 3.4 },
    ];
    const html = composeHtml({
      script,
      sceneAudio,
      gapSec: 0.3,
      bgImageRelPath: "images/bg.jpg",
      audioRelPath: "voice.mp3",
    });

    // ── HyperFrames structural requirements ──────────────────
    expect(html).toContain('id="stage"');
    expect(html).toContain('data-composition-id="news-video"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('data-start="0"');           // root composition timing
    expect(html).toContain('id="voice"');               // audio element discoverable by hyperframes
    expect(html).toContain('class="scene clip"');       // clip class required for hyperframes visibility
    expect(html).toContain('window.__timelines');       // timeline registry (inlined JS)

    // ── Persistent brand shell ────────────────────────────────
    expect(html).toContain('class="brand-shell-header"');
    expect(html).toContain('class="brand-shell-keyword"');
    expect(html).toContain('id="grain-overlay"');
    // Shell has no data-start (persistent)
    expect(html).toContain('class="brand-name"');
    expect(html).toContain("Công nghệ 24h");

    // ── Hook scene ─────────────────────────────────────────────
    expect(html).toContain('data-layout="hook"');
    expect(html).toContain('class="hook-headline shimmer-sweep-target"');
    expect(html).toContain("iPhone 17");                // headline content
    expect(html).toContain("Camera 200MP!");            // subhead content

    // Image background (hook has bgSrc + bgImageRelPath provided)
    expect(html).toContain('class="bg kb-zoom-in"');
    expect(html).toContain("background-image: url('images/bg.jpg')");
    // ── Body templates ─────────────────────────────────────────
    // body-1: stat-hero
    expect(html).toContain('data-layout="stat-hero"');
    expect(html).toContain('class="stat-value shimmer-sweep-target"');
    expect(html).toContain('class="stat-label"');
    expect(html).toContain("200MP");

    // body-2: feature-list
    expect(html).toContain('data-layout="feature-list"');
    expect(html).toContain('class="feat-card"');
    expect(html).toContain('class="feat-title"');
    expect(html).toContain("Nâng cấp lớn");

    // body-3: callout
    expect(html).toContain('data-layout="callout"');
    expect(html).toContain('class="callout-card"');
    expect(html).toContain('class="callout-statement"');

    // ── Outro scene ────────────────────────────────────────────
    expect(html).toContain('data-layout="outro"');
    expect(html).toContain('class="out-channel"');
    expect(html).toContain('class="out-underline"');
    expect(html).toContain('class="out-source"');
    expect(html).toContain("Theo dõi ngay");            // ctaTop content
    expect(html).toContain('class="out-cta-top"');

    // Audio src
    expect(html).toContain('src="voice.mp3"');
    expect(html).toMatch(/data-duration="[\d.]+"/);

    // Google Fonts present
    expect(html).toContain("fonts.googleapis.com");
  });

  it("falls back to gradient when bgImageRelPath is null", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-script-with-image.json", "utf8")) as Script;
    const sceneAudio = script.scenes.map((s) => ({ id: s.id, durationSec: 5 }));
    const html = composeHtml({
      script,
      sceneAudio,
      gapSec: 0.3,
      bgImageRelPath: null,
      audioRelPath: "voice.mp3",
    });
    // Hook scene with bgSrc but no bgImageRelPath → gradient fallback
    expect(html).toContain('class="bg gradient-news-dark"');
    expect(html).not.toContain("background-image: url");
  });

  it("renders sceneBg photo backgrounds behind body scenes", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-script-with-image.json", "utf8")) as Script;
    const sceneAudio = script.scenes.map((s) => ({ id: s.id, durationSec: 5 }));
    const html = composeHtml({
      script,
      sceneAudio,
      gapSec: 0.3,
      bgImageRelPath: null,
      sceneBg: { "body-1": "media/media-2.jpg", "body-3": "media/media-4.jpg" },
      audioRelPath: "voice.mp3",
    });
    expect(html).toContain('class="scene-bg" style="background-image: url(\'media/media-2.jpg\')"');
    expect(html).toContain('class="scene-bg" style="background-image: url(\'media/media-4.jpg\')"');
    expect(html).toContain('class="scene-bg-overlay"');
    // body-2 has no sceneBg → no bg layer inside its scene
    const body2 = html.split('id="scene-body-2"')[1].split('id="scene-')[0];
    expect(body2).not.toContain("scene-bg");
  });

  it("renders a media-strip scene with images and videos", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-script-no-image.json", "utf8")) as Script;
    // Replace a body scene with a media-strip
    script.scenes[1] = {
      id: "body-1",
      type: "body",
      voiceText: "Nhìn xem app trông thế nào.",
      templateData: {
        template: "media-strip",
        title: "Hình ảnh thực tế",
        items: [
          { src: "media/media-1.jpg", caption: "Dashboard chính" },
          { src: "media/media-2.mp4" },
          { src: "media/media-3.png", caption: "Bảng giá" },
        ],
      },
    } as Script["scenes"][number];
    const sceneAudio = script.scenes.map((s) => ({ id: s.id, durationSec: 8 }));
    const html = composeHtml({
      script,
      sceneAudio,
      gapSec: 0.3,
      bgImageRelPath: null,
      audioRelPath: "voice.mp3",
    });

    expect(html).toContain('data-layout="media-strip"');
    expect(html).toContain('class="strip-title"');
    expect(html).toContain('src="media/media-1.jpg"');
    expect(html).toContain('class="strip-caption"');
    // Video items become <video> elements with HyperFrames data attrs
    expect(html).toMatch(/<video class="strip-media" src="media\/media-2\.mp4"[^>]*data-track-index="2"/);
    // Image items become <img>
    expect(html).toContain('<img class="strip-media" src="media/media-3.png"');
    // No caption → no stray caption div for item 2
    const item2 = html.split("strip-item-1")[1].split("strip-item-2")[0];
    expect(item2).not.toContain("strip-caption");
  });
});
