# AGENTS.md — AI Agent Context for auto-generate-short-videos

> This file provides essential context for AI coding agents (Claude Code, ChatGPT, Cursor, Copilot, Antigravity, etc.) working on this codebase.

---

## Project Overview

**Auto Generate Short Videos** — Tự động tạo video ngắn 9:16 (TikTok/Reels/Shorts) từ URL bài báo hoặc file text, hoàn toàn bằng code.

**Pipeline tóm tắt:**
```
URL/txt → AI viết script.json → TTS giọng đọc → HTML motion graphics → FFmpeg mix audio + SFX → HyperFrames render → video.mp4
```

**Video output:** 1080×1920 (9:16), 48–72 giây, nội dung tiếng Việt.

---

## Tech Stack

| Layer | Technology |
|:---|:---|
| Language | TypeScript 5+ (ESM, `"type": "module"`) |
| Runtime | Node.js 22+ |
| Validation | Zod 4 |
| Video Render | [HyperFrames](https://github.com/heygen-com/hyperframes) (HTML → MP4) |
| Animation | GSAP 3.14 (loaded via CDN in HTML templates) |
| Audio | FFmpeg / FFprobe (external binary, must be installed) |
| TTS | 7 providers — Edge TTS (free, default), LucyLab, ElevenLabs, Vbee, Google TTS, Saydi, Revid |
| Test | Vitest 4 |
| Build | tsx (dev run), tsc (type check) |

---

## Directory Structure

```
auto-generate-short-videos/
├── src/
│   ├── cli.ts                  # CLI entry — loads .env.local, calls runPipeline()
│   ├── config.ts               # Env vars → typed Config (TTS, theme, branding)
│   ├── pipeline.ts             # 8-step main pipeline (TTS → render → MP4)
│   ├── render/
│   │   ├── script-schema.ts    # Zod schema for script.json (templates, scenes)
│   │   ├── html-composer.ts    # Generates HTML from script + theme
│   │   ├── hyperframes-runner.ts  # Spawns `npx hyperframes render`
│   │   ├── blocks/             # HTML block components (tiktok-follow, grain, shimmer)
│   │   └── templates/
│   │       ├── base.html.tmpl      # HTML5 skeleton (placeholders: TITLE, SHELL, SCENES)
│   │       ├── animations.js       # GSAP scene animations
│   │       ├── styles.css          # Theme: dark-neon (default legacy)
│   │       ├── styles.dev-terminal.css  # Theme: dev-terminal (current default)
│   │       └── styles.light-pro.css     # Theme: light-pro
│   ├── tts/
│   │   ├── tts-client.ts       # TtsClient interface + factory createTtsClient()
│   │   ├── edge-tts-client.ts  # Free Edge TTS (vi-VN, retry with backoff)
│   │   ├── lucylab-client.ts   # LucyLab async polling + SRT
│   │   ├── elevenlabs-client.ts
│   │   ├── vbee-client.ts
│   │   ├── google-tts-client.ts
│   │   ├── saydi-client.ts
│   │   └── revid-client.ts
│   ├── assets/
│   │   ├── audio-tools.ts      # FFmpeg: getDurationSec, concatWithSilence, mixSfxOntoVoice
│   │   ├── sfx-selector.ts     # 3-tier smart SFX picker (keyword → template → fallback)
│   │   ├── image-fetcher.ts    # Download og:image
│   │   ├── media-downloader.ts # Batch download scraped media → $media.N placeholders
│   │   ├── media-extractor.ts  # Scrape images/videos from HTML (JSON-LD, <img>, <video>)
│   │   └── srt-merge.ts        # Merge word-level SRT cues into readable phrases
│   └── utils/
│       ├── logger.ts           # log.step(), log.info(), log.warn(), log.error()
│       └── slug.ts             # Vietnamese-safe URL slug generator
├── scripts/
│   ├── download-sfx.ts         # Download SFX library from myinstants.com
│   ├── filter-sfx.ts           # Filter SFX by duration → assets/sfx/
│   ├── upload-youtube.ts       # YouTube Shorts uploader (OAuth2, resumable)
│   ├── align_split.py          # Whisper-based voice alignment (scene splitting)
│   ├── video-registry.py       # Dedupe + upload tracking registry
│   └── yt-stats.py             # YouTube performance logger
├── tests/fixtures/             # Test fixtures (script JSONs, audio samples, HTML)
├── output/                     # Generated videos (gitignored)
├── assets/                     # Static assets (avatar.png, logo.svg)
├── .claude/skills/             # AI agent skill
│   └── create-news-video/      # Skill: tạo video tin tức từ URL/txt
├── hyperframes.json            # HyperFrames project config
├── rerender.ts                 # Re-render video without re-generating TTS
└── .env.example                # All env var documentation
```

---

## Key Commands

```bash
# Install
npm install

# Run full pipeline from script.json
npm run pipeline -- output/<slug>/script.json

# Re-render (keep existing voice, regenerate video)
npm run rerender -- output/<slug>

# Tests
npm test                    # Vitest run
npm run test:watch          # Vitest watch mode

# Type check
npm run typecheck           # tsc --noEmit

# Upload to YouTube
npm run upload -- output/<slug> [--title "..."] [--privacy unlisted]

# SFX management
npm run sfx:download        # Download SFX library
npm run sfx:filter          # Filter usable SFX clips
```

---

## Configuration (.env.local)

Copy `.env.example` → `.env.local`. Key variables:

```bash
# TTS Provider (required)
TTS_PROVIDER=edge-tts              # edge-tts | lucylab | elevenlabs | vbee | google-tts | saydi | revid

# Edge TTS (free, no API key needed)
EDGE_TTS_VOICE=vi-VN-NamMinhNeural
EDGE_TTS_RATE=+0%
EDGE_TTS_PITCH=+0Hz
EDGE_TTS_VOLUME=+0%

# Visual theme
VIDEO_THEME=dev-terminal           # dev-terminal | dark-neon | light-pro

# TikTok/YouTube branding
TIKTOK_DISPLAY_NAME=Tên Kênh
TIKTOK_HANDLE=@handle

# Pipeline tuning
TTS_CONCURRENCY=1                  # Parallel TTS requests
```

> Each TTS provider has its own env vars (API keys, voice IDs, endpoints). See `.env.example` for full list.

---

## script.json Schema

The AI agent generates `script.json` — the single input to the pipeline. Validated by Zod in `src/render/script-schema.ts`.

### Root Structure

```jsonc
{
  "version": "1.0",
  "metadata": {
    "title": "Tiêu đề video",
    "source": {
      "url": "https://...",
      "domain": "vnexpress.net",
      "image": "https://og-image-url...",  // og:image
      "media": [...]                        // scraped media items (optional)
    },
    "channel": "Tên Kênh"
  },
  "voice": {
    "provider": "edge-tts",
    "voiceId": "vi-VN-NamMinhNeural",
    "speed": 1.0
  },
  "scenes": [/* 5–8 scenes, first=hook, last=outro */]
}
```

### Scene Templates (7 types)

| Template | Type | Key Fields | Max Chars |
|:---|:---|:---|:---|
| `hook` | hook | headline, subhead, bgSrc?, kenBurns? | 40, 40 |
| `comparison` | body | left{label,value,color}, right{…,winner} | — |
| `stat-hero` | body | value, label, context, bgSrc?, kenBurns? | 20, 40, 50 |
| `feature-list` | body | title, bullets(1–4), icon, bgSrc?, kenBurns? | 40, 50/bullet |
| `callout` | body | statement, tag, bgSrc?, imageSrc?, kenBurns? | 80, 20 |
| `media-strip` | body | title, items(2–3){src, caption} | 40 |
| `outro` | outro | ctaTop, channelName, source | 30, 30, 40 |

### Scene Object

```jsonc
{
  "id": "unique-scene-id",
  "type": "hook" | "body" | "outro",
  "voiceText": "Nội dung giọng đọc tiếng Việt...",
  "templateData": { "template": "stat-hero", /* ... */ },
  "sfx": { "name": "whoosh.mp3", "volume": 0.4, "startOffsetSec": 0 }  // optional — usually auto-selected
}
```

### Constraints

- **5–8 scenes** total, first scene type = `hook`, last = `outro`
- **150–200 words** total voiceText across all scenes
- **Duration**: 48–72 seconds final video
- **kenBurns** options: `zoom-in`, `zoom-out`, `pan-left`, `pan-right`
- **Media placeholders**: use `$media.1`, `$media.2`… in bgSrc/imageSrc (auto-resolved from scraped article media)

---

## Pipeline Architecture (8 Steps)

```
Step 1: Load .env.local + validate script.json (Zod)
Step 2: Write script.txt (concatenated voiceText for CapCut backup)
Step 3: Fetch og:image + scrape article media (parallel with Step 4)
Step 4: TTS per scene (parallel with p-limit, idempotent — skips existing .mp3)
Step 5: Concat voice.mp3 + mix SFX layer (ffmpeg concat + micro-fades)
Step 6: Compose HTML (theme CSS + avatar + index.html + hyperframes meta)
Step 7: Render with HyperFrames (npx hyperframes render → video.mp4)
Step 8: Report output paths (video.mp4, voice.mp3, subtitles.srt, script.txt)
```

**Key constants** in `pipeline.ts`:
- `DURATION_MIN_SEC = 48`, `DURATION_MAX_SEC = 72`
- `SCENE_GAP_SEC = 0.3` (silence between scenes)
- `OUTRO_HOLD_SEC = 3` (extra hold on outro screen)

---

## SFX System (3-Tier Smart Selector)

SFX is almost always auto-selected. Manual `sfx` field in scenes is rarely needed.

| Tier | Source | Logic |
|:---|:---|:---|
| Tier 2 | Semantic keyword | Regex matches voiceText (e.g., "cảnh báo" → alert, "thất bại" → fail) |
| Tier 3 | Template default | Each template maps to default categories (hook→transition, callout→alert) |
| Tier 4 | Fallback | Random from any category, deterministic via hash(sceneId) |

SFX categories: `transition`, `cinematic`, `emphasis`, `alert`, `success`, `fail`, `reveal`, `countdown`, `drumroll`, `outro`

---

## Vietnamese TTS Phonetic Rules

When generating `voiceText`, these rules are **critical** for natural Vietnamese TTS:

| Pattern | ❌ Wrong | ✅ Correct |
|:---|:---|:---|
| Decimals | 5.5 | năm chấm năm |
| Percentages | 30% | ba mươi phần trăm |
| Currency | $100M | một trăm triệu đô |
| Tech specs | 16GB RAM | mười sáu ghi-ga-bai RAM |
| Abbreviations | AI, API | ây-ai, ây-pi-ai |
| Ordinals | Top 3 | top ba |
| Version numbers | v2.0 | phiên bản hai chấm không |

---

## Testing

- **Framework**: Vitest 4 with globals enabled
- **Test files**: co-located as `*.test.ts` next to source
- **Fixtures**: `tests/fixtures/` (sample scripts, audio, HTML)
- **Run**: `npm test` (single run) or `npm run test:watch`
- **Coverage**: `@vitest/coverage-v8` available

### Test conventions
- Tests mock external calls (HTTP via nock, file I/O via vi.mock)
- Edge TTS, LucyLab, Vbee, etc. all have dedicated test files
- Schema validation tests cover valid + invalid script.json fixtures

---

## Code Conventions

- **ESM only** — `"type": "module"` in package.json, use `import`/`export`
- **Strict TypeScript** — `strict: true` in tsconfig
- **Zod for validation** — all external inputs (env, script.json) validated with Zod schemas
- **Idempotent operations** — TTS skips if mp3 exists, media download skips existing files
- **Logging** — use `log.step()`, `log.info()`, `log.warn()`, `log.error()` from `src/utils/logger.ts`
- **Slug generation** — Vietnamese diacritics stripped, max 40 chars, word-boundary truncation
- **Error handling** — retry with exponential backoff for TTS; graceful fallback for media fetch

---

## Common Agent Tasks

### Create a new video from URL
1. Fetch article content from URL
2. Generate `script.json` following the schema above + Vietnamese phonetic rules
3. Write to `output/<slug>/script.json`
4. Run `npm run pipeline -- output/<slug>/script.json`
5. Generate TikTok caption + hashtags

### Add a new TTS provider
1. Create `src/tts/<name>-client.ts` implementing `TtsClient` interface
2. Add provider name to `TtsProvider` type in `src/config.ts`
3. Add env var parsing in `loadConfig()`
4. Add case to factory in `src/tts/tts-client.ts`
5. Create `src/tts/<name>-client.test.ts`

### Add a new scene template
1. Add Zod schema to `src/render/script-schema.ts` (in TemplateData union)
2. Add render function in `src/render/html-composer.ts`
3. Add CSS styles in all 3 theme files under `src/render/templates/`
4. Add template→SFX category mapping in `src/assets/sfx-selector.ts`
5. Update tests + fixtures

### Add a new visual theme
1. Create `src/render/templates/styles.<theme-name>.css`
2. Add theme name to `VideoTheme` type in `src/config.ts`
3. Update theme CSS copy logic in `pipeline.ts` and `rerender.ts`

---

## External Dependencies (System)

| Tool | Required | Purpose |
|:---|:---|:---|
| **Node.js 22+** | ✅ | Runtime |
| **FFmpeg** | ✅ | Audio concat, SFX mixing, duration probing |
| **FFprobe** | ✅ | Audio duration detection (bundled with FFmpeg) |
| **npx** | ✅ | Runs HyperFrames renderer (bundled with Node.js) |

---

## Output Structure

Each video run produces:

```
output/<slug>/
├── script.json          # Input script (validated)
├── script.txt           # Plain text voiceText (CapCut backup)
├── voice/
│   ├── scene-<id>.mp3   # Per-scene TTS audio
│   └── scene-<id>.srt   # Per-scene subtitles (if provider supports)
├── voice.mp3            # Concatenated voice (all scenes)
├── voice-sfx.mp3        # Voice + SFX mixed
├── subtitles.srt        # Merged timeline-accurate subtitles
├── media/               # Scraped article images/videos
│   ├── media-1.jpg
│   └── media-manifest.json
├── composition/         # HyperFrames render input
│   ├── index.html
│   ├── styles.css
│   ├── meta.json
│   └── hyperframes.json
├── bg.jpg               # og:image background
├── avatar.png           # Channel avatar
├── caption.txt          # TikTok/Shorts caption + hashtags
└── video.mp4            # ✅ Final output (1080×1920)
```
