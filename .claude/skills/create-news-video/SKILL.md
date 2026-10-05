---
name: create-news-video
description: Tạo video tin tức ngắn 9:16 (~60s) từ URL bài báo hoặc file .txt tiếng Việt. Trigger khi user yêu cầu tạo video tin tức, làm short news, làm bản tin video, render tin thành video, làm TikTok tin tức. Output: video.mp4 + voice.mp3 + script.txt cho CapCut.
---

# Create News Video Skill

Generate a Vietnamese 9:16 motion-graphic news video from a URL or .txt file.

## Input

Single argument: a news article URL (starts with `http://` or `https://`) OR a path to a `.txt` file.

## Workflow (MUST follow these steps in order)

### Step 1: Detect input type

- Starts with `http://` or `https://` → URL mode
- Otherwise → file mode

### Step 2: Fetch content

**URL mode:**
- Fetch the article URL content (use browser/web fetch as available in your agent).
- Extract:
  - `title` (string): tiêu đề bài báo
  - `content` (string): nội dung chính, ~500-1500 từ
  - `ogImage` (string|null): URL ảnh og:image (meta og:image hoặc ảnh đầu bài)
  - `domain` (string): domain của URL (vd "vnexpress.net")
- If fetching fails (paywall, JS-rendered, 4xx) → tell user to save content to a .txt file and pass that instead. Stop.

**File mode:**
- Read the .txt file contents.
- Title = first non-empty line (strip whitespace, max 80 chars)
- Content = remaining lines joined
- ogImage = `null`
- domain = `"local"`

### Step 3: Create slug + output directory

- slug = lowercase ASCII (strip Vietnamese diacritics, đ→d), replace non-alphanumeric with `-`, trim dashes, max 40 chars
- timestamp = current local time as `YYYYMMDD-HHmm`
- outputDir = `output/<slug>-<timestamp>/`
- Create the directory: `mkdir -p <outputDir>`

### Step 4: Generate script.json

Following the Zod schema in `src/render/script-schema.ts`. Key rules:

**Script content (Vietnamese):**
- Total voiceText: ~150–200 words → ~55–65s spoken at speed 1.0
- Number of scenes: **5–8** (1 hook + 3–6 body + 1 outro)
- Each scene voiceText is 1-3 short sentences, văn nói (spoken style, not formal)
- No emoji, no markdown in voiceText

### ⚠️ CRITICAL: Vietnamese TTS Phonetic Rules

The `voiceText` field is read aloud by Edge TTS (default, free) or other configured TTS providers. **Numbers and symbols are read literally** — if you write "5.5", TTS may say "năm rưỡi" (five and a half — WRONG for version numbers). **Always spell out numbers in Vietnamese phonetic form** in `voiceText`. The `templateData` fields (visual text on screen) can keep the original "5.5" / "82.7%" formatting.

**Mandatory rules for `voiceText`:**

| Number form | WRONG (TTS misreads) | RIGHT (spell out in Vietnamese) |
|---|---|---|
| Decimal version | `GPT 5.5` → "năm rưỡi" ❌ | `GPT năm chấm năm` ✅ |
| Decimal stat | `82.7%` | `tám mươi hai phẩy bảy phần trăm` |
| Version | `iPhone 17` | `iPhone mười bảy` (or `iPhone 17` works for whole numbers) |
| Version with point | `iOS 18.2` | `iOS mười tám chấm hai` |
| Tech spec | `200MP` | `hai trăm megapixel` |
| Battery | `5000mAh` | `năm nghìn miliampe giờ` |
| Tokens | `1M tokens` / `1000000 tokens` | `một triệu token` |
| Price VND | `21 triệu đồng` | `hai mươi mốt triệu đồng` |
| Price USD | `$5` | `năm đô la` (or `năm đô`) |
| Multiplier | `2x` | `gấp đôi` (more natural than "hai lần") |
| Year | `2026` | `hai nghìn không trăm hai mươi sáu` (or just `năm 2026` reads OK) |
| Percentage with decimal | `30%` | `ba mươi phần trăm` |
| Time | `60 giây` | `sáu mươi giây` |
| Frequency | `5G` | `năm gờ` (be careful — TTS often says "năm-gờ") |
| Channel name | `Lập trình là cuộc sống` | spell phonetically if TTS misreads |

**Notation choices:**
- For decimal point use `chấm` (more spoken/natural) or `phẩy` (formal). Both work; pick consistent.
- For comma separator, use `phẩy` (e.g. "1,000" → "một nghìn")
- For ratio "3:1" → say `ba trên một` or `ba so với một`

**English brand names — keep as-is**, TTS handles them OK:
- `Apple`, `Google`, `OpenAI`, `Microsoft`, `TikTok`, `YouTube` ✅

**English acronyms — write phonetically if TTS misreads:**
- `AI` → write `ây ai`
- `API` → write `ây pi ai`
- `GPT` → usually OK; if not, write `gí pi tí`
- `iOS` → write `ai ô ét` if matter

**Symbols to AVOID in voiceText:**
- `→` `&` `%` `$` `#` `+` `=` (TTS may say literal name or skip)
- `!` `?` at end of sentence is OK — they create natural intonation
- Emoji: NEVER (TTS pronounces or skips inconsistently)
- URLs: NEVER (TTS reads dot/slash literally)

**End each `voiceText` sentence with `.` or `?`** for natural pause/intonation.

**Examples — full scene:**

WRONG (will sound bad):
```json
{ "voiceText": "GPT 5.5 đạt 82.7% trên Terminal-Bench, vượt GPT 5.4 (75.1%)." }
```
→ TTS reads: "GPT năm rưỡi đạt tám mươi hai chấm bảy phần trăm trên Terminal-Bench..."

RIGHT (natural):
```json
{ "voiceText": "GPT năm chấm năm đạt tám mươi hai phẩy bảy phần trăm trên Terminal Bench, vượt phiên bản năm chấm bốn ở mức bảy mươi lăm phẩy một." }
```

**Note**: `templateData` (text on screen) CAN use original formatting — the visual is separate from spoken:
```json
{
  "voiceText": "GPT năm chấm năm đạt tám mươi hai phẩy bảy phần trăm.",
  "templateData": {
    "template": "stat-hero",
    "value": "82.7%",                 ← Visual: keep readable formatting
    "label": "Terminal-Bench"
  }
}
```

**Hook (most important — gets first 3 seconds of viewer attention):**
- Must contain a claim, statistic, or curious question
- NEVER generic ("Hôm nay chúng ta sẽ nói về..." is wrong)
- `headline` max 40 chars — short, punchy, attention-grabbing
- Optional `subhead` max 40 chars for supporting detail
- Use `bgSrc: "$source.image"` with `kenBurns` for visual interest

**templateData rules:**
- Vary templates across scenes — don't repeat the same template back-to-back
- For image scenes: `"bgSrc": "$source.image"` (literal — CLI substitutes at pipeline level)
- Vary `kenBurns` across scenes (`zoom-in`, `zoom-out`, `pan-left`, `pan-right`)
- Respect max char limits per template field (see schema in `src/render/script-schema.ts`)

### 🖼️ Article media (auto-scraped photos & videos)

The pipeline auto-scrapes extra photos/videos from the article (JSON-LD, `<img>`, `srcset` widest candidate, `<video>` mp4/webm) into `media/media-N.*` + `media-manifest.json`. Use them via `$media.N` placeholders:

- `"bgSrc": "$media.2"` on stat-hero / feature-list / callout → photo background behind the card (Ken Burns).
- `"media-strip"` template → swipey 2–3 item gallery (photos AND videos):

```json
{
  "id": "body-3", "type": "body",
  "voiceText": "Nhìn trực tiếp cách nó hoạt động qua các hình ảnh minh hoạ.",
  "templateData": {
    "template": "media-strip",
    "title": "Minh hoạ từ báo cáo",
    "items": [
      { "src": "$media.1", "caption": "Sâu máy tính WeWorm" },
      { "src": "$media.2", "caption": "Cách thức tấn công" }
    ]
  }
}
```

- Body scenes WITHOUT explicit `bgSrc` are auto-illustrated with unused article photos — you get visual variety for free.
- TIP: when fetching the article, also save the raw HTML to `<outputDir>/article.html` — the pipeline reads it instead of re-fetching (works even for JS-heavy pages you had to scrape via browser).
- If a `$media.N` download failed, the reference is dropped automatically (scene still renders).

**Outro (always fixed format):**
```json
{
  "id": "outro",
  "type": "outro",
  "voiceText": "Theo dõi Lập trình là cuộc sống để xem công cụ AI mới mỗi ngày.",
  "templateData": {
    "template": "outro",
    "ctaTop": "Theo dõi ngay",
    "channelName": "Lập trình là cuộc sống",
    "source": "<DOMAIN>"
  }
}
```
Replace `<DOMAIN>` with the actual domain string (e.g. `"vnexpress.net"` or `"local"`).

### Step 5: Self-validate before writing

Check:
- Total word count ~150-200
- Every templateData field respects max char limits (see schema)
- 5-8 scenes total
- scenes[0].type === "hook"
- last scene type === "outro"
- All templateData templates valid: hook, comparison, stat-hero, feature-list, callout, media-strip, outro

If invalid, fix yourself silently. Up to 2 self-correction passes. After that, write anyway — the CLI's Zod validation will produce a precise error message that the user can act on.

### Step 6: Write script.json

Write the validated JSON to `<outputDir>/script.json`.

### Step 7: Run the pipeline

Run in foreground, stream output:

```bash
npm run pipeline -- <outputDir>/script.json
```

If exit code != 0:
- Report the error message clearly
- Tell user the output dir path so they can inspect intermediate files

### Step 8: Generate TikTok caption + hashtags

Only run this step if Step 7 (the pipeline) succeeded — don't caption a video that wasn't actually produced.

Write a short Vietnamese caption + exactly 4 hashtags for the video, based on `script.metadata.title` and the scenes' content (same topic understanding used to write the script — no new research needed).

**Caption rules:**
- 1 short, punchy line (~10–20 words), Vietnamese, văn nói.
- Reuse or riff on the hook's claim/question — the caption is what gets someone to tap play, so it should carry the same curiosity/stat hook, not restate the title flatly.
- Unlike `voiceText`, the caption is written text (not read by TTS) — 1 emoji is OK if it fits naturally, but don't force one in.
- No markdown, no line breaks inside the caption itself.

**Hashtag rules — exactly 4, in this order:**
1. One broad tech/niche tag in Vietnamese (e.g. `#congnghe`, `#thutthuat`)
2. One or two tags specific to the video's actual topic/product/company (e.g. `#openai`, `#ai`, `#pdf`, `#codegraph` — derive from the subject, don't reuse the same generic tag twice)
3. One channel/discovery tag: `#laptrinh` (and `#fyp` or `#xuhuong` if there's room — still capped at 4 total)
- Lowercase, no spaces, no punctuation inside a tag.
- Skip hashtags that don't genuinely fit the topic just to hit the count differently — 4 relevant tags beats 4 generic ones.

Write the result to `<outputDir>/caption.txt` using the Write tool, formatted as:
```
<caption line>

#tag1 #tag2 #tag3 #tag4
```

### Step 9: Report success

If successful, report to user with markdown links:

```markdown
✓ Video:   [video.mp4](output/<slug>-<timestamp>/video.mp4)
✓ Audio:   [voice.mp3](output/<slug>-<timestamp>/voice.mp3) — for CapCut
✓ Subs:    [subtitles.srt](output/<slug>-<timestamp>/subtitles.srt) — timeline-accurate, upload to YouTube/Shorts
✓ Script:  [script.txt](output/<slug>-<timestamp>/script.txt) — for CapCut auto-caption
✓ Caption: [caption.txt](output/<slug>-<timestamp>/caption.txt) — for TikTok upload
Tổng thời lượng: XX.Xs

<caption line>
#tag1 #tag2 #tag3 #tag4
```

## Examples

### Example 1: URL with image (vnexpress)

User: `/create-news-video https://vnexpress.net/iphone-17-200mp`

Generated `script.json`:
```json
{
  "version": "1.0",
  "metadata": {
    "title": "Apple ra mắt iPhone 17 với camera 200MP",
    "source": {
      "url": "https://vnexpress.net/iphone-17-200mp",
      "domain": "vnexpress.net",
      "image": "https://i1-vnexpress.vnecdn.net/iphone17.jpg"
    },
    "channel": "Lập trình là cuộc sống"
  },
  "voice": { "provider": "edge-tts", "voiceId": "vi-VN-NamMinhNeural", "speed": 1.0 },
  "scenes": [
    {
      "id": "hook",
      "type": "hook",
      "voiceText": "Apple vừa ra mắt iPhone mười bảy với camera hai trăm megapixel.",
      "templateData": {
        "template": "hook",
        "headline": "iPhone 17",
        "subhead": "Camera 200MP!",
        "bgSrc": "$source.image",
        "kenBurns": "zoom-in"
      }
    },
    {
      "id": "body-1",
      "type": "body",
      "voiceText": "Máy được trang bị cảm biến hoàn toàn mới, có khả năng zoom quang học gấp mười lần.",
      "templateData": {
        "template": "stat-hero",
        "value": "200MP",
        "label": "Cảm biến mới",
        "context": "Zoom quang học 10x",
        "bgSrc": "$source.image",
        "kenBurns": "zoom-out"
      }
    },
    {
      "id": "body-2",
      "type": "body",
      "voiceText": "Pin được nâng cấp lên năm nghìn miliampe giờ, tăng ba mươi phần trăm so với đời cũ.",
      "templateData": {
        "template": "feature-list",
        "title": "Nâng cấp lớn",
        "bullets": ["Pin 5000mAh", "Tăng 30% so đời cũ", "Sạc nhanh 65W"],
        "icon": "spark"
      }
    },
    {
      "id": "body-3",
      "type": "body",
      "voiceText": "Giá khởi điểm là hai mươi mốt triệu đồng, dự kiến mở bán tại Việt Nam vào tháng sau.",
      "templateData": {
        "template": "callout",
        "statement": "Giá từ 21 triệu đồng, mở bán tháng 5.",
        "tag": "Giá bán"
      }
    },
    {
      "id": "outro",
      "type": "outro",
      "voiceText": "Theo dõi Lập trình là cuộc sống để xem công cụ AI mới mỗi ngày.",
      "templateData": {
        "template": "outro",
        "ctaTop": "Theo dõi ngay",
        "channelName": "Lập trình là cuộc sống",
        "source": "vnexpress.net"
      }
    }
  ]
}
```

### Example 2: .txt file with no image (local)

User: `/create-news-video news/agi-update.txt`

Generated `script.json`:
```json
{
  "version": "1.0",
  "metadata": {
    "title": "OpenAI công bố mô hình mới với khả năng lập luận",
    "source": { "url": "local", "domain": "local", "image": null },
    "channel": "Lập trình là cuộc sống"
  },
  "voice": { "provider": "edge-tts", "voiceId": "vi-VN-NamMinhNeural", "speed": 1.0 },
  "scenes": [
    {
      "id": "hook",
      "type": "hook",
      "voiceText": "OpenAI vừa công bố mô hình mới có khả năng lập luận như con người.",
      "templateData": {
        "template": "hook",
        "headline": "Mô hình mới",
        "subhead": "Lập luận như người!"
      }
    },
    {
      "id": "body-1",
      "type": "body",
      "voiceText": "Mô hình mới đạt chín mươi hai phần trăm trên bài kiểm tra lập luận, vượt xa đối thủ.",
      "templateData": {
        "template": "comparison",
        "left": { "label": "Đối thủ", "value": "71%", "color": "purple" },
        "right": { "label": "OpenAI mới", "value": "92%", "color": "cyan", "winner": true }
      }
    },
    {
      "id": "body-2",
      "type": "body",
      "voiceText": "Điểm đặc biệt là khả năng giải bài toán phức tạp chỉ trong vài giây.",
      "templateData": {
        "template": "callout",
        "statement": "Giải bài toán phức tạp chỉ trong vài giây.",
        "tag": "Đột phá"
      }
    },
    {
      "id": "body-3",
      "type": "body",
      "voiceText": "Mô hình hỗ trợ ba tính năng chính: lập luận chuỗi, tự sửa lỗi, và tích hợp công cụ ngoài.",
      "templateData": {
        "template": "feature-list",
        "title": "Tính năng nổi bật",
        "bullets": ["Lập luận chuỗi", "Tự sửa lỗi", "Tích hợp công cụ ngoài"],
        "icon": "brain"
      }
    },
    {
      "id": "outro",
      "type": "outro",
      "voiceText": "Theo dõi Lập trình là cuộc sống để xem công cụ AI mới mỗi ngày.",
      "templateData": {
        "template": "outro",
        "ctaTop": "Theo dõi ngay",
        "channelName": "Lập trình là cuộc sống",
        "source": "local"
      }
    }
  ]
}
```
Note: when source has no image, scenes omit `bgSrc` fields — the pipeline renders with the theme's default gradient background.

## Sound Effects (SFX)

**You almost never need to set the `sfx` field.** The pipeline auto-selects SFX per scene using a 3-tier system: semantic keywords in voiceText → template default → random fallback (deterministic by scene ID).

### Default SFX by template

| Template | Default SFX | Sound character |
|---|---|---|
| `hook` | `transition/` or `cinematic/` | Dramatic entrance |
| `comparison` | `transition/` or `emphasis/` | Side-by-side reveal |
| `stat-hero` | `emphasis/` or `success/` | Number reveal |
| `feature-list` | `transition/` or `emphasis/` | Bullet appearance |
| `callout` | `alert/` or `drumroll/` | Important info |
| `media-strip` | `transition/` or `reveal/` | Gallery reveal |
| `outro` | `outro/` or `success/` | Ending signature |

### When to override (rare)

```json
{ "sfx": { "name": "drumroll/snare-roll", "volume": 0.5, "startOffsetSec": 0.2 } }
```

- Force a specific sound: `{ "name": "alert/notification", "volume": 0.4 }`
- Disable SFX: `{ "name": "none" }`

Available categories: `transition/`, `emphasis/`, `alert/`, `success/`, `fail/`, `outro/`, `reveal/`, `drumroll/`, `countdown/`, `cinematic/`

## Edge cases

| Situation | Action |
|---|---|
| URL paywall / JS-rendered → WebFetch returns no content | Tell user: "Không đọc được URL (có thể do paywall hoặc JS). Hãy lưu nội dung vào file .txt rồi gọi lại." Stop. |
| URL content < 200 words | Warn "Tin gốc ngắn, video có thể không đủ chất liệu", continue anyway |
| URL content > 2000 words | Summarize to key points, fit ~150-200 words script |
| File mode + file empty/missing | Error message, don't create output dir |
| Pipeline fails | Report error message + output dir path; user can re-try `npm run pipeline -- <path>` after fixing |
