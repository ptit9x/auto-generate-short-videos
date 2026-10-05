---
name: youtube-growth-loop
description: Weekly YouTube performance analysis for the channel "Lập trình là cuộc sống" — pull stats, compare against history, extract lessons, and update loop memory that shapes future video scripts.
---

# YouTube Growth Loop

Closed feedback loop (Larry Loop pattern) for the channel **Lập trình là cuộc sống**:
daily renders (cron job `13e2c971`) → upload → weekly performance analysis →
lessons written to `loop-memory.md` → the daily job reads those lessons before
writing the next script.

## Files

- Repo: `/home/vmo/ai-tools/auto-video-gen`
- Stats history: `<repo>/yt-stats-history.jsonl` (one line per video per snapshot)
- Loop memory (THE deliverable): `<repo>/loop-memory.md`
- Registry: `<repo>/video-registry.json` (uploaded videos + yt ids)

## Weekly analysis procedure

1. **Snapshot current stats**:
   ```bash
   cd /home/vmo/ai-tools/auto-video-gen && python3 scripts/yt-stats.py
   ```
   - Exit 2 (`NO_AUTH`) → say so in the report; skip stats, still review pending
     uploads below. Never fake numbers.
   - Exit 3 (`API_ERROR`) → retry once; if it still fails, report the error.
2. **Compare vs previous snapshots** in `yt-stats-history.jsonl`:
   views per video over time, 7-day deltas for recent uploads, median across
   the channel. Use python3 (not mental math) to compute deltas.
3. **Extract lessons** — for each of the best and worst 2 videos of the week,
   identify from `output/<slug>*/script.json` (title, scene templates used,
   voice length) what likely drove or killed performance:
   - Title pattern (curiosity gap? number? "AI" keyword? Vietnamese phrasing?)
   - Topic (framework release vs opinion piece vs news)
   - Structure (which scene templates, video length)
   - Thumbnail/title from the upload metadata
4. **Update `<repo>/loop-memory.md`** — append a dated section:
   ```markdown
   ## 2026-09-24 — Week N
   - METRICS: median X views (prev Y), total Z, best <slug> (V views), worst <slug> (W views)
   - WORKED: <concrete pattern with numbers>
   - FAILED: <concrete pattern with numbers>
   - RULE: <one actionable rule for future scripts>
   ```
   Keep the file under ~200 lines: when it grows past that, merge older
   sections into a compact "ARCHIVE" summary at the bottom (keep the RULEs).
5. **Report to Telegram** (this job's delivery): summary table, deltas, the new
   RULEs, and any videos still not uploaded (`python3 scripts/video-registry.py status`).

## Rules for the analysis agent

- NEVER invent stats. If a number is not in `yt-stats-history.jsonl` or the API
  response, it does not exist.
- Judge videos only after ~48h live (they render daily but views need time).
- Small sample warning is mandatory while n < 10 uploads: prefix conclusions
  with "(small sample)".
- Prefer rules that change script WRITING (title formulas, topic picks, length)
  over vague advice ("make better thumbnails" is useless; "titles with a number
  + 'chính thức' outperformed opinion titles 3/4 times" is a rule).
