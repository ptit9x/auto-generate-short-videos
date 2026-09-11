<a id="top"></a>

<div align="center">

# 🎬 Auto Generate Short Videos

### 🚀 Biến URL bài báo & Repo GitHub thành Video ngắn 9:16 — phong cách Developer

**1 câu lệnh với AI Coding · Giọng đọc Edge TTS miễn phí · Theme dev-terminal · Sẵn sàng đăng TikTok, Reels, Shorts**

[![License](https://img.shields.io/github/license/ptit9x/auto-generate-short-videos?style=for-the-badge&color=green)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5%2B-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[**🇬🇧 English Docs**](README.en.md) · [**📖 Tài liệu chi tiết (Full Docs)**](README.full.md) · [**🚀 Cài đặt nhanh**](#-bắt-đầu-nhanh-3-bước)

</div>

---

## ✨ Điểm nổi bật

- ⚡ **Tự động hóa toàn diện**: Từ URL bài báo hoặc file `.txt`/`.md` → Kịch bản → Giọng đọc (TTS) → HTML Motion Graphics → Ghép âm thanh & SFX → Render MP4 1080x1920.
- 🎙️ **Voice miễn phí 100% (Edge TTS)**: Giọng đọc tiếng Việt Microsoft Edge, không tốn tiền, không cần API key. Hỗ trợ thêm LucyLab, Vbee, ElevenLabs nếu muốn.
- 🖥️ **Theme dev-terminal (mới)**: Phong cách developer — nền GitHub dark `#0d1117`, font JetBrains Mono, màu syntax-highlight, card kiểu editor panel, hook có prompt `$ `, tên kênh outro bọc `< />`. Kèm 2 theme cũ: `dark-neon`, `light-pro`.
- 🔴 **Branding YouTube-style**: Avatar nút play đỏ, nút Subscribe, tên kênh tùy chỉnh — đổi 1 dòng trong `.env.local`.
- 🤖 **Thiết kế cho AI Coding Agents**: Skill `/create-news-video` sẵn cho **Claude Code** (`.claude/skills`) và **Antigravity IDE** (`.agents/skills`).
- 📐 **6 template dựng sẵn**: `breaking-news`, `stat-callout`, `split-screen`, `quote-card`, `listicle`, `big-number`.

---

## 🚀 Bắt đầu nhanh (3 bước)

### 1. Yêu cầu & Cài đặt

- **Node.js 22+** và **FFmpeg** trên máy.

```bash
git clone https://github.com/ptit9x/auto-generate-short-videos.git
cd auto-generate-short-videos
npm install
```

> **Cài FFmpeg nếu máy chưa có:**
> - **Windows:** `winget install Gyan.FFmpeg`
> - **macOS:** `brew install ffmpeg`
> - **Linux:** `sudo apt install ffmpeg` (hoặc dùng bản static bỏ vào `~/.local/bin`)

### 2. Thiết lập cấu hình

```bash
cp .env.example .env.local
```

Tuỳ chọn trong `.env.local`:

```bash
TTS_PROVIDER=edge-tts          # mặc định, free, không cần key
VIDEO_THEME=dev-terminal       # dev-terminal | dark-neon | light-pro
TIKTOK_DISPLAY_NAME=Tên Kênh   # tên hiển thị trên card Subscribe
TIKTOK_FOLLOWERS=...           # (đã bỏ khỏi card — chỉ dùng nếu bật lại)
```

### 3. Tạo video đầu tiên!

#### 🤖 Cách 1: Tự động hoàn toàn bằng AI Agent (khuyên dùng)

Với **Claude Code**, mở terminal tại thư mục dự án:

```bash
claude
# Trong màn hình tương tác, gõ:
/create-news-video https://vnexpress.net/bai-viet-cua-ban...
```

Với **Antigravity IDE**, mở project rồi gõ lệnh tương tự trong khung chat.

> 💡 AI sẽ tự: đọc bài báo → viết kịch bản tiếng Việt chuẩn ngữ âm → chọn template → gọi pipeline (Edge TTS + HyperFrames + SFX) → xuất `.mp4` kèm `caption.txt`.

#### 🛠️ Cách 2: Render trực tiếp từ file kịch bản

```bash
npm run pipeline -- output/<slug>/script.json

# Chỉ render lại hình (giữ voice cũ):
npm run rerender -- output/<slug>

# Chạy test:
npm test
```

---

## 🎨 Themes

| Theme | Mô tả |
| :--- | :--- |
| `dev-terminal` *(mặc định mới)* | GitHub dark + JetBrains Mono + syntax colors, card editor panel, hook `$ `, outro `< Kênh />` |
| `dark-neon` | Dark navy + cyan/purple gradient, glass card (theme gốc) |
| `light-pro` | Sáng, professional |

Đổi theme: `VIDEO_THEME=<tên>` trong `.env.local`.

---

## 🎙️ Lựa chọn giọng đọc (TTS)

| Nhà cung cấp | Cấu hình | Chi phí | Đặc điểm |
| :--- | :--- | :--- | :--- |
| **Edge TTS** *(Mặc định)* | `TTS_PROVIDER=edge-tts` | **0đ** | Không cần API key, giọng Việt tự nhiên (`vi-VN-HoaiMyNeural`) |
| **LucyLab** | `TTS_PROVIDER=lucylab` | ~25k/1M ký tự | Voice cloning tiếng Việt, kèm SRT |
| **Vbee** | `TTS_PROVIDER=vbee` | Trả phí | Giọng phát thanh viên tin tức |
| **ElevenLabs** | `TTS_PROVIDER=elevenlabs` | Trả phí | Đa ngôn ngữ, chất lượng cao |

---

## 📂 Cấu trúc thư mục dự án

```text
auto-generate-short-videos/
├── .claude/skills/        # Claude Code skill /create-news-video
├── .agents/skills/        # Antigravity IDE skill
├── src/
│   ├── config.ts          # Đọc & validate env (TTS, theme, branding)
│   ├── pipeline.ts        # Pipeline chính: TTS -> HyperFrames -> FFmpeg
│   ├── render/            # HTML/CSS/GSAP templates + 3 themes
│   ├── tts/               # Edge TTS, LucyLab, Vbee, ElevenLabs clients
│   └── assets/            # SFX selector, image fetcher, audio tools
├── tests/                 # Unit tests (Vitest)
├── output/                # Video thành phẩm (gitignored)
└── docs/                  # Specs
```

---

## 📖 Tài liệu chuyên sâu

Xem [**README.full.md**](README.full.md): cấu trúc `script.json`, tùy biến theme CSS, bảng chi phí, troubleshooting, FAQ. Tiếng Anh: [**README.en.md**](README.en.md).

---

## 📜 License & Lời cảm ơn

- Giấy phép [MIT](LICENSE).
- Fork và tùy biến từ các dự án mã nguồn mở cộng đồng.
- Bản fork này duy trì bởi [ptit9x](https://github.com/ptit9x).
