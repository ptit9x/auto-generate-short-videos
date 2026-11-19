<a id="top"></a>

<div align="center">

# 🎬 Auto Generate Short Videos

### 🚀 Turn any article URL into a 9:16 Short Video — developer style

**One AI command · Free Edge TTS voice · Dev-terminal theme · Ready for TikTok, Reels & Shorts**

[![License](https://img.shields.io/github/license/ptit9x/auto-generate-short-videos?style=for-the-badge&color=green)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5%2B-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

### 🎥 Video Demo

[![Video Demo](https://img.youtube.com/vi/VOzaibAg3sY/maxresdefault.jpg)](https://www.youtube.com/shorts/VOzaibAg3sY)

▶️ *Sample video generated fully automatically with a single command*

</div>

---

## ✨ Highlights

- ⚡ **End-to-end automation**: Article URL or `.txt`/`.md` file → Script → Voice (TTS) → HTML Motion Graphics → Audio & SFX mixing → Render MP4 1080×1920.
- 🎙️ **100% free voice (Edge TTS)**: Vietnamese Microsoft Edge voice — zero cost, no API key required. Also supports LucyLab, Vbee, ElevenLabs, Google TTS, Saydi, and Revid.
- 🖥️ **Dev-terminal theme**: Developer aesthetic — GitHub dark `#0d1117` background, JetBrains Mono font, syntax-highlight colors, editor-panel cards, hook with `$ ` prompt, outro wrapped in `< />`. Plus 2 additional themes: `dark-neon`, `light-pro`.
- 🔴 **YouTube-style branding**: Red play-button avatar, Subscribe button, customizable channel name — change one line in `.env.local`.
- 🤖 **Built for AI Coding Agents**: Skill `/create-news-video` included in `.claude/skills/` — works with **Claude Code**, **Antigravity**, **Cursor**, and other AI agents.
- 📐 **7 built-in templates**: `hook`, `comparison`, `stat-hero`, `feature-list`, `callout`, `media-strip`, `outro`.

---

## 🚀 Quick Start (3 Steps)

### 1. Prerequisites & Install

- **Node.js 22+** and **FFmpeg** on your machine.

```bash
git clone https://github.com/ptit9x/auto-generate-short-videos.git
cd auto-generate-short-videos
npm install
```

> **Install FFmpeg if not already present:**
> - **Windows:** `winget install Gyan.FFmpeg`
> - **macOS:** `brew install ffmpeg`
> - **Linux:** `sudo apt install ffmpeg` (or use a static build in `~/.local/bin`)

### 2. Configure

```bash
cp .env.example .env.local
```

Options in `.env.local`:

```bash
TTS_PROVIDER=edge-tts          # default, free, no API key needed
VIDEO_THEME=dev-terminal       # dev-terminal | dark-neon | light-pro
TIKTOK_DISPLAY_NAME=Channel    # display name on the Subscribe card
```

### 3. Create your first video!

#### 🤖 Option 1: Fully automated with AI Agent (recommended)

With **Claude Code**, open a terminal in the project directory:

```bash
claude
# In the interactive prompt, type:
/create-news-video https://vnexpress.net/your-article-url...
```

With **Antigravity** or **Cursor**, open the project and type a similar command in the chat.

> 💡 The AI will automatically: read the article → write a Vietnamese script with proper phonetics → pick templates → run the pipeline (Edge TTS + HyperFrames + SFX) → output `.mp4` with `caption.txt`.

#### 🛠️ Option 2: Render directly from a script file

```bash
npm run pipeline -- output/<slug>/script.json

# Re-render visuals only (keep existing voice):
npm run rerender -- output/<slug>

# Run tests:
npm test
```

---

## 🎬 Long videos (16:9)

The same pipeline also renders **long-form tutorials** at **1920×1080 (16:9)** — Shorts are untouched and remain the default.

**Turn it on** — add a top-level field to `script.json`:

```jsonc
{
  "version": "1.0",
  "format": "long",          // ← absent or "short" = the original 9:16 Short
  "metadata": { /* … */ },
  "voice": { /* … */ },
  "scenes": [ /* 8–60 scenes, first = hook, last = outro */ ]
}
```

`VIDEO_FORMAT=long` in `.env.local` works as a fallback when a script has no `format` field (the script field wins). Long scripts get relaxed text limits (hook headline ≤ 90 chars, callout ≤ 160, feature-list ≤ 6 bullets × 90 chars, …) and two extra templates:

| Template | Scene type | Purpose |
|:---|:---|:---|
| `chapter` | `chapter` | Full-screen section divider: big chapter number + title + subtitle |
| `code-demo` | `body` | Code as a real VS Code window — filename tab, line numbers, Dark+ colours, `highlightLines` bands; type scales down so a full 30-line file fits one frame |

```jsonc
{ "id": "ch1", "type": "chapter", "voiceText": "Chương một…",
  "templateData": { "template": "chapter", "index": 1, "title": "Vì sao useEffect lại đau?" } },
{ "id": "code-1", "type": "body", "voiceText": "Đây là bốn dòng useQuery…",
  "templateData": { "template": "code-demo", "filename": "Users.jsx",
    "code": ["const { data } = useQuery({", "  queryKey: ['users'],", "});"],
    "highlightLines": [2], "caption": "queryKey là tên cache" } }
```

**Brand tag:** the shell header tag is configurable — Shorts default to `IT NEWS`, long videos to **`CODE TIPS`** (chosen for the "Lập trình là cuộc sống" tutorials). Override with `BRAND_TAG` env or `"brandTag"` in script metadata. The long outro is text-only: hero line once, then a card holding only the Subscribe button.

**Reference example:** [`examples/long-sample.script.json`](examples/long-sample.script.json) — the full TanStack Query tutorial ("Xóa 30 Dòng useEffect Gọi API Bằng 4 Dòng TanStack Query", the long version of the 41-second Short): 18 scenes, 5 chapters, the real counted 30-line manual file shown whole in one `code-demo`, the 4-line `useQuery`, staleTime, `useMutation` + `invalidateQueries`, common mistakes, and the honest caveat that `QueryClientProvider` wraps the app **once** at the root.

## 🎨 Themes

| Theme | Description |
| :--- | :--- |
| `dev-terminal` *(default)* | GitHub dark + JetBrains Mono + syntax colors, editor-panel cards, hook `$ `, outro `< Channel />` |
| `dark-neon` | Dark navy + cyan/purple gradient, glass cards (legacy theme) |
| `light-pro` | Light, clean, professional |

Switch theme: set `VIDEO_THEME=<name>` in `.env.local`.

---

## 🎙️ Voice Providers (TTS)

| Provider | Config | Cost | Notes |
| :--- | :--- | :--- | :--- |
| **Edge TTS** *(Default)* | `TTS_PROVIDER=edge-tts` | **Free** | No API key needed, natural Vietnamese voice (`vi-VN-NamMinhNeural`) |
| **LucyLab** | `TTS_PROVIDER=lucylab` | ~\$1/1M chars | Vietnamese voice cloning with SRT subtitles |
| **Vbee** | `TTS_PROVIDER=vbee` | Paid | Broadcast-quality Vietnamese voice |
| **ElevenLabs** | `TTS_PROVIDER=elevenlabs` | Paid | Multilingual, premium quality |
| **Google TTS** | `TTS_PROVIDER=google-tts` | Paid | GCP service account, SSML support |
| **Saydi** | `TTS_PROVIDER=saydi` | Paid | OpenAI-compatible API |
| **Revid** | `TTS_PROVIDER=revid` | Paid | Round-robin key rotation, async jobs |

---

## 📂 Project Structure

```text
auto-generate-short-videos/
├── .claude/skills/        # AI agent skill (create-news-video)
├── src/
│   ├── config.ts          # Env vars → typed Config (TTS, theme, branding)
│   ├── pipeline.ts        # Main pipeline: TTS → HyperFrames → FFmpeg
│   ├── render/            # HTML/CSS/GSAP templates + 3 themes
│   ├── tts/               # Edge TTS, LucyLab, Vbee, ElevenLabs, etc.
│   └── assets/            # SFX selector, image fetcher, audio tools
├── scripts/               # YouTube uploader, SFX tools, stats
├── tests/                 # Unit tests (Vitest)
├── output/                # Generated videos (gitignored)
└── AGENTS.md              # AI agent context (full project docs)
```

---

## 👤 Author

| | |
| :--- | :--- |
| **Richard Do** | [![GitHub](https://img.shields.io/badge/ptit9x-181717?logo=github&logoColor=white)](https://github.com/ptit9x) |
| **Email** | laptrinhlacuocsong@gmail.com |

---

## 📜 License

[MIT](LICENSE) — free to use, modify, and distribute.
