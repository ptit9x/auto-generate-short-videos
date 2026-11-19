import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { composeHtml } from "./html-composer.js";
import { parseScript, type Script } from "./script-schema.js";

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

describe("composeHtml — long format (16:9)", () => {
  const longScript = parseScript(JSON.parse(readFileSync("tests/fixtures/sample-script-long.json", "utf8")));
  const longAudio = longScript.scenes.map((s) => ({ id: s.id, durationSec: 20 }));
  const composeLong = (extra: Record<string, unknown> = {}) => composeHtml({
    script: longScript,
    sceneAudio: longAudio,
    gapSec: 0.3,
    bgImageRelPath: null,
    audioRelPath: "voice.mp3",
    ...extra,
  } as Parameters<typeof composeHtml>[0]);

  it("renders the stage at 1920x1080 with the format-long class", () => {
    const html = composeLong();
    expect(html).toContain('data-width="1920"');
    expect(html).toContain('data-height="1080"');
    expect(html).toContain('data-format="long"');
    expect(html).toContain('class="format-long"');
    expect(html).not.toContain('data-width="1080"');
  });

  it("brand tag: long defaults to CODE TIPS and never says IT NEWS", () => {
    const html = composeLong();
    expect(html).toContain('<div class="brand-tag">CODE TIPS</div>');
    expect(html).not.toContain("IT NEWS");
  });

  it("brand tag: a custom brandTag overrides the long default", () => {
    const html = composeLong({ brandTag: "REACT TIPS" });
    expect(html).toContain('<div class="brand-tag">REACT TIPS</div>');
    expect(html).not.toContain("CODE TIPS");
  });

  it("renders chapter divider scenes", () => {
    const html = composeLong();
    expect(html).toContain('data-layout="chapter"');
    expect(html).toContain('class="chapter-number">01<');
    expect(html).toContain("Vì sao gọi API bằng useEffect lại đau?");
  });

  it("renders code-demo as a VS Code window: filename tab, line numbers, Dark+ window", () => {
    const html = composeLong();
    expect(html).toContain('data-layout="code-demo"');
    expect(html).toContain('class="code-tab-name">Users.jsx<');
    expect(html).toContain("Visual Studio Code");
    expect(html).toContain('class="code-lineno">1<');
    expect(html).toContain('class="code-statusbar"');
    // Syntax highlighting is applied
    expect(html).toContain('class="tok-keyword"');
  });

  it("the manual code-demo shows the FULL 30-line file with highlight bands and dense sizing", () => {
    const html = composeLong();
    const manual = html.split('id="scene-code-manual"')[1].split('id="scene-')[0];
    const lineCount = (manual.match(/class="code-lineno">/g) ?? []).length;
    expect(lineCount).toBe(30);
    expect(manual).toContain("code-window--dense");
    expect(manual).toContain("code-line-hl");
    // The useEffect blocks of the real counted file are on screen
    expect(manual).toContain("useEffect");
    expect(manual).toContain("cacheRef");
  });

  it("dense code-demo markup carries the dense layout class and line count", () => {
    const html = composeLong();
    const manual = html.split('id="scene-code-manual"')[1].split('id="scene-')[0];
    expect(manual).toContain("layout-code-demo--dense");
    expect(manual).toContain('data-lines="30"');
  });

  it("dense-tier CSS height budget fits 30 lines + chrome inside the 1080px stage", () => {
    // Regression guard for the v1 render bug: the 30-line manual demo was
    // clipped to 19 lines because the dense sizing (plus the base rule's
    // min-height:1.5em overriding the dense line-height) overflowed the
    // stage. Recompute the full vertical budget from styles.long.css —
    // bumping any dense value re-checks the fit here.
    const css = readFileSync("src/render/templates/styles.long.css", "utf8");
    const rule = (selector: string): string => {
      const i = css.indexOf(selector);
      expect(i, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf("}", i));
    };
    const num = (body: string, prop: string): number => {
      const m = body.match(new RegExp(`${prop}:\\s*([0-9.]+)`));
      expect(m, `${prop} not found`).not.toBeNull();
      return parseFloat(m![1]);
    };
    const padV = (body: string): [number, number] => {
      const m = body.match(/padding:\s*([0-9.]+)(?:px)?\s+([0-9.]+)(?:px)?(?:\s+([0-9.]+)(?:px)?)?/);
      expect(m, "padding shorthand not found").not.toBeNull();
      return [parseFloat(m![1]), m![3] ? parseFloat(m![3]) : parseFloat(m![1])];
    };

    const [layoutTop, layoutBottom] = padV(rule(".layout-code-demo--dense {"));
    const title = rule(".layout-code-demo--dense .code-demo-title");
    const titleBlock = num(title, "font-size") * num(title, "line-height") + num(title, "margin-bottom");
    const caption = rule(".layout-code-demo--dense .code-demo-caption");
    const captionBlock = num(caption, "font-size") * num(caption, "line-height") + num(caption, "margin-top");

    const line = rule(".code-window--dense .code-line {");
    const lineFont = num(line, "font-size");
    // Effective line height: the base .code-line min-height:1.5em trap means
    // the real per-line cost is max(line-height, min-height) × font-size.
    const linePx = Math.max(lineFont * num(line, "line-height"), lineFont * num(line, "min-height"));
    const linesTotal = 30 * linePx;

    // Chrome text heights use each label's base font-size × a normal
    // line-height (titlebar name 20px×1.2, tab 22px×1.25, status 19px×1.25).
    const titlebar = padV(rule(".code-window--dense .code-titlebar"))[0] * 2 + 20 * 1.2;
    const tabbar = padV(rule(".code-window--dense .code-tab {"))[0] * 2 + 22 * 1.25;
    const bodyPad = padV(rule(".code-window--dense .code-body"))[0] * 2;
    const statusbar = padV(rule(".code-window--dense .code-statusbar"))[0] * 2 + 19 * 1.25;

    const total =
      layoutTop + layoutBottom + titleBlock + captionBlock +
      2 /* window border */ + titlebar + tabbar + bodyPad + statusbar + linesTotal;
    expect(total).toBeLessThanOrEqual(1080);
  });

  it("dense title clears the shell header: pinned top padding leaves >=12px gap", () => {
    // Regression guard for the v2 polish defect: the dense scene title
    // floated (centred stack) into the shell header band and collided
    // with the channel name. The dense layout is now pinned to the top
    // (justify-content: flex-start), so the title's top edge is exactly
    // the layout's top padding. The shell header occupies
    // top (36px) + icon height (64px) = 100px of the stage.
    const css = readFileSync("src/render/templates/styles.long.css", "utf8");
    const rule = (selector: string): string => {
      const i = css.indexOf(selector);
      expect(i, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf("}", i));
    };
    const num = (body: string, prop: string): number => {
      const m = body.match(new RegExp(`${prop}:\\s*([0-9.]+)`));
      expect(m, `${prop} not found`).not.toBeNull();
      return parseFloat(m![1]);
    };
    const padTop = (body: string): number => {
      const m = body.match(/padding:\s*([0-9.]+)(?:px)?/);
      expect(m, "padding shorthand not found").not.toBeNull();
      return parseFloat(m![1]);
    };

    const denseLayout = rule(".layout-code-demo--dense {");
    // flex-start is what makes the title's top edge deterministic.
    expect(denseLayout).toContain("justify-content: flex-start");
    const titleTop = padTop(denseLayout);
    const headerBottom =
      num(rule(".brand-shell-header {"), "top") +
      num(rule(".brand-icon {"), "height");
    expect(titleTop - headerBottom).toBeGreaterThanOrEqual(12);
  });

  it("hides the shell keyword chip while a dense code-demo scene is on screen", () => {
    // Regression guard for the v2 polish defect: the persistent shell
    // keyword chip (bottom-centre) painted over the dense code-manual
    // caption. animations.js (inlined into the composed page) hides the
    // chip for dense code-demo spans and restores it afterwards.
    const html = composeLong();
    expect(html).toContain("denseCodeIntervals");
    expect(html).toContain('querySelector(".brand-shell-keyword")');
    expect(html).toContain('querySelector(".layout-code-demo--dense")');
  });

  it("long outro is Subscribe-only: no avatar, no display name in the card", () => {
    const html = composeLong();
    const outro = html.split('id="scene-outro"')[1];
    expect(outro).toContain("tt-card--subscribe-only");
    expect(outro).toContain("Subscribe");
    expect(outro).not.toContain("tt-avatar");
    expect(outro).not.toContain("tt-display-name");
  });

  it("short compositions still default to IT NEWS", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-script-with-image.json", "utf8")) as Script;
    const html = composeHtml({
      script,
      sceneAudio: script.scenes.map((s) => ({ id: s.id, durationSec: 5 })),
      gapSec: 0.3,
      bgImageRelPath: null,
      audioRelPath: "voice.mp3",
    });
    expect(html).toContain('<div class="brand-tag">IT NEWS</div>');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
  });
});
