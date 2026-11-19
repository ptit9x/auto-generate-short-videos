// v2 Animation Engine — template-specific entrance animations
// HyperFrames runtime drives playback by seeking the timeline.
//
// IMPORTANT: Only use supported GSAP props: opacity, x, y, scale, scaleX, scaleY, rotation, width, height, visibility.
// Do NOT use `delay:` in vars — use position parameter (3rd arg) instead.
// Do NOT use `attr:` settings. No complex easings.

window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
window.__timelines["news-video"] = tl;

(function () {
  // ── Inject shimmer masks into all .shimmer-sweep-target elements ──────────
  document.querySelectorAll(".shimmer-sweep-target").forEach((el) => {
    if (!el.querySelector(".shimmer-mask")) {
      const mask = document.createElement("div");
      mask.className = "shimmer-mask";
      el.appendChild(mask);
    }
  });

  const stage = document.getElementById("stage");
  const stageW = parseFloat(stage.dataset.width) || 1080;
  const scenes = Array.from(stage.querySelectorAll(".scene"));

  // Persistent shell keyword chip (bottom-centre source pill). A dense
  // code-demo scene (>20 lines) ends with a caption line exactly where
  // this chip sits, so the chip paints over the caption's middle
  // (v2 render test, 2026-11-19). Collect the dense scenes' spans here;
  // the chip is hidden for those spans after the dispatch loop.
  const keywordChip = stage.querySelector(".brand-shell-keyword");
  const denseCodeIntervals = [];

  // ── Scene dispatch ──────────────────────────────────────────────────────
  scenes.forEach((scene) => {
    const start = parseFloat(scene.dataset.start);
    const dur   = parseFloat(scene.dataset.duration);
    const layout = scene.dataset.layout;

    // Scene visibility: fade in/out
    tl.set(scene, { opacity: 1 }, start);
    tl.set(scene, { opacity: 0 }, start + dur);

    if (layout === "code-demo" && scene.querySelector(".layout-code-demo--dense")) {
      denseCodeIntervals.push([start, start + dur]);
    }

    if (layout === "hook") {
      animateHook(scene, tl, start);
    } else if (layout === "comparison") {
      animateComparison(scene, tl, start);
    } else if (layout === "stat-hero") {
      animateStatHero(scene, tl, start);
    } else if (layout === "feature-list") {
      animateFeatureList(scene, tl, start);
    } else if (layout === "callout") {
      animateCallout(scene, tl, start);
    } else if (layout === "media-strip") {
      animateMediaStrip(scene, tl, start, dur);
    } else if (layout === "chapter") {
      animateChapter(scene, tl, start);
    } else if (layout === "code-demo") {
      animateCodeDemo(scene, tl, start);
    } else if (layout === "outro") {
      animateOutro(scene, tl, start, dur);
    }

    // Photo background behind body scenes (auto-illustration): slow Ken Burns
    // via GSAP (supported props only). CSS var --scene-dur isn't available here.
    animateSceneBg(scene, tl, start, dur);
  });

  // ── Shell keyword chip vs dense code-demo captions ────────────────────
  // Hide the chip while a dense code-demo scene is on screen; restore it
  // when the span ends so every other scene keeps the chip exactly as
  // before. Adjacent dense scenes are merged into one span so the chip
  // never flickers at a scene cut.
  if (keywordChip && denseCodeIntervals.length > 0) {
    const merged = [];
    for (const [s, e] of denseCodeIntervals) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1] + 0.001) {
        last[1] = Math.max(last[1], e);
      } else {
        merged.push([s, e]);
      }
    }
    for (const [s, e] of merged) {
      tl.set(keywordChip, { opacity: 0 }, s);
      tl.set(keywordChip, { opacity: 1 }, e);
    }
  }

  // ── HOOK ──────────────────────────────────────────────────────────────
  function animateHook(scene, tl, start) {
    const headline = scene.querySelector(".hook-headline");
    if (headline) {
      // Scale pop in
      tl.fromTo(headline, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6 }, start + 0.15);
      // Shimmer sweep after entrance
      const mask = headline.querySelector(".shimmer-mask");
      if (mask) {
        tl.fromTo(mask, { x: "-120%" }, { x: "120%", duration: 1.0 }, start + 0.7);
      }
    }

    const subhead = scene.querySelector(".hook-subhead");
    if (subhead) {
      tl.fromTo(subhead, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, start + 0.55);
    }
  }

  // ── COMPARISON ────────────────────────────────────────────────────────
  function animateComparison(scene, tl, start) {
    const leftCard = scene.querySelector(".cmp-left");
    if (leftCard) {
      tl.fromTo(leftCard, { x: -80, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5 }, start + 0.15);
    }

    const vs = scene.querySelector(".cmp-vs");
    if (vs) {
      tl.fromTo(vs, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35 }, start + 0.45);
    }

    const rightCard = scene.querySelector(".cmp-right");
    if (rightCard) {
      tl.fromTo(rightCard, { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5 }, start + 0.6);
    }
  }

  // ── STAT HERO ─────────────────────────────────────────────────────────
  function animateStatHero(scene, tl, start) {
    const value = scene.querySelector(".stat-value");
    if (value) {
      tl.fromTo(value, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6 }, start + 0.15);
      // Shimmer sweep on the stat value
      const mask = value.querySelector(".shimmer-mask");
      if (mask) {
        tl.fromTo(mask, { x: "-120%" }, { x: "120%", duration: 1.0 }, start + 0.7);
      }
    }

    const label = scene.querySelector(".stat-label");
    if (label) {
      tl.fromTo(label, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, start + 0.55);
    }

    const context = scene.querySelector(".stat-context");
    if (context) {
      tl.fromTo(context, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, start + 0.85);
    }
  }

  // ── FEATURE LIST ──────────────────────────────────────────────────────
  function animateFeatureList(scene, tl, start) {
    const card = scene.querySelector(".feat-card");
    if (card) {
      tl.fromTo(card, { y: 60, scale: 0.95, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5 }, start + 0.1);
    }

    const rule = scene.querySelector(".feat-rule");
    if (rule) {
      tl.fromTo(rule, { scaleX: 0, opacity: 1 }, { scaleX: 1, opacity: 1, duration: 0.4 }, start + 0.45);
    }

    const bullets = scene.querySelectorAll(".feat-bullet");
    bullets.forEach((b, i) => {
      tl.fromTo(b, { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4 }, start + 0.6 + i * 0.15);
    });

    const demoVideo = scene.querySelector(".demo-video-wrap");
    if (demoVideo) {
      tl.fromTo(demoVideo, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, start + 1.1);
    }
  }

  // ── CALLOUT ───────────────────────────────────────────────────────────
  function animateCallout(scene, tl, start) {
    const card = scene.querySelector(".callout-card");
    if (card) {
      tl.fromTo(card, { y: 50, scale: 0.92, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.55 }, start + 0.2);
    }
    const image = scene.querySelector(".callout-image-wrap");
    if (image) {
      tl.fromTo(image, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, start + 0.7);
    }
  }

  // ── SCENE BG (auto-illustrated photo behind body cards) ───────────────
  function animateSceneBg(scene, tl, start, dur) {
    const bg = scene.querySelector(".scene-bg");
    if (!bg) return;
    // Start visible (no flash), then slow zoom 1 → 1.14 across the scene.
    // (GSAP props only — no `ease` here: HyperFrames supports a limited set.)
    tl.set(bg, { opacity: 1, scale: 1.02 }, start);
    tl.to(bg, { scale: 1.14, duration: Math.max(0.5, dur - 0.05) }, start);
  }

  // ── MEDIA STRIP (scraped-article gallery) ─────────────────────────────
  function animateMediaStrip(scene, tl, start, dur) {
    const title = scene.querySelector(".strip-title");
    if (title) {
      tl.fromTo(title, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, start + 0.15);
    }

    const items = Array.from(scene.querySelectorAll(".strip-item"));
    if (items.length === 0) return;

    const per = Math.max(1.6, (dur - 1.0) / items.length);

    items.forEach((item, i) => {
      const at = start + 0.6 + i * per;
      if (i === 0) {
        // First item is already on screen — visible from scene start.
        tl.set(item, { opacity: 1, x: 0 }, start);
      } else {
        // Slide in from the right while the previous one slides out left.
        tl.set(item, { opacity: 1, x: stageW }, at - 0.55);
        tl.to(item, { x: 0, duration: 0.55 }, at - 0.55);
        const prev = items[i - 1];
        tl.to(prev, { x: -stageW, duration: 0.55 }, at - 0.55);
      }

      // Subtle zoom on the visible media while it holds.
      const media = item.querySelector(".strip-media");
      if (media) {
        tl.fromTo(media, { scale: 1.0 }, { scale: 1.07, duration: per }, Math.max(start, at - (i === 0 ? 0.6 : 0)));
      }
    });
  }

  // ── CHAPTER (long only) ───────────────────────────────────────────────
  function animateChapter(scene, tl, start) {
    const kicker = scene.querySelector(".chapter-kicker");
    if (kicker) {
      tl.fromTo(kicker, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, start + 0.1);
    }
    const number = scene.querySelector(".chapter-number");
    if (number) {
      tl.fromTo(number, { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55 }, start + 0.2);
    }
    const title = scene.querySelector(".chapter-title");
    if (title) {
      tl.fromTo(title, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, start + 0.45);
    }
    const rule = scene.querySelector(".chapter-rule");
    if (rule) {
      tl.fromTo(rule, { scaleX: 0, opacity: 1 }, { scaleX: 1, opacity: 1, duration: 0.4 }, start + 0.8);
    }
    const subtitle = scene.querySelector(".chapter-subtitle");
    if (subtitle) {
      tl.fromTo(subtitle, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, start + 0.95);
    }
  }

  // ── CODE DEMO (long only) ─────────────────────────────────────────────
  function animateCodeDemo(scene, tl, start) {
    const title = scene.querySelector(".code-demo-title");
    if (title) {
      tl.fromTo(title, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, start + 0.1);
    }
    const win = scene.querySelector(".code-window");
    if (win) {
      tl.fromTo(win, { y: 50, scale: 0.97, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5 }, start + 0.2);
    }
    // Lines fade/slide in staggered; highlighted lines land last-ish so
    // the eye is drawn to them after the file is on screen.
    const lines = scene.querySelectorAll(".code-line");
    lines.forEach((line, i) => {
      tl.fromTo(line, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.25 }, start + 0.45 + i * 0.03);
    });
    const caption = scene.querySelector(".code-demo-caption");
    if (caption) {
      tl.fromTo(caption, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, start + 0.9);
    }
  }

  // ── OUTRO ─────────────────────────────────────────────────────────────
  function animateOutro(scene, tl, start, dur) {
    const cta = scene.querySelector(".out-cta-top");
    if (cta) {
      tl.fromTo(cta, { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: 0.45 }, start + 0.2);
    }

    const channel = scene.querySelector(".out-channel");
    if (channel) {
      tl.fromTo(channel, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55 }, start + 0.55);
    }

    const underline = scene.querySelector(".out-underline");
    if (underline) {
      tl.fromTo(underline, { width: 0 }, { width: "600px", duration: 0.5 }, start + 0.9);
    }

    const source = scene.querySelector(".out-source");
    if (source) {
      tl.fromTo(source, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4 }, start + 1.3);
    }

    // ── TikTok follow card animation (last ~3.5s of outro) ──────────────
    // Adapted from HyperFrames `tiktok-follow` block.
    // Card lives inside the outro scene (id="tt-card"); slide up + button click sequence.
    const ttCard = scene.querySelector("#tt-card");
    if (ttCard) {
      const ttBtn      = scene.querySelector("#tt-follow-btn");
      const ttFollow   = scene.querySelector("#tt-btn-follow");
      const ttFollwing = scene.querySelector("#tt-btn-following");
      const ttBase     = start + 1.6;  // start TikTok sequence 1.6s into outro

      // Slide in from bottom + fade in
      tl.fromTo(ttCard,
        { opacity: 0, y: 300 },
        { opacity: 1, y: 0, duration: 0.5 },
        ttBase
      );

      // Button press (scale down)
      if (ttBtn) {
        tl.to(ttBtn, { scale: 0.92, duration: 0.15 }, ttBase + 0.9);
        // Release with slight bounce (use scale up)
        tl.to(ttBtn, { scale: 1, duration: 0.4 }, ttBase + 1.05);
      }

      // Swap "Follow" → "Following" (opacity)
      if (ttFollow) {
        tl.to(ttFollow, { opacity: 0, duration: 0.08 }, ttBase + 1.05);
      }
      if (ttFollwing) {
        tl.to(ttFollwing, { opacity: 1, duration: 0.08 }, ttBase + 1.08);
      }

      // Hold + subtle zoom-in to focus viewer attention on the card.
      // Slow zoom from scale 1 → 1.08 over the remaining outro duration.
      const holdStart = ttBase + 1.3;             // after click animation
      const holdEnd   = start + dur - 0.1;        // ends just before scene ends
      const holdLen   = Math.max(0.5, holdEnd - holdStart);
      tl.to(ttCard, { scale: 1.08, duration: holdLen }, holdStart);
    }
  }
})();
