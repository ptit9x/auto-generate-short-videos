import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMergedSrt, parseSrt, toSrt, groupCues } from "./srt-merge.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "srt-merge-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseSrt / toSrt", () => {
  it("round-trips cues", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,500\nXin chào\n\n2\n00:00:03,000 --> 00:00:04,000\nthế giới\n";
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 2.5, text: "Xin chào" });
    expect(toSrt(cues)).toBe(srt);
  });

  it("tolerates block-index lines and CRLF", () => {
    const srt = "1\r\n00:00:00,500 --> 00:00:01,000\r\nhi\r\n";
    expect(parseSrt(srt)[0].start).toBe(0.5);
  });
});

describe("buildMergedSrt", () => {
  it("offsets scene cues by cumulative start times including the gap", async () => {
    mkdirSync(join(dir, "voice"), { recursive: true });
    // Scene A: 2.0s voice, one cue 0.3→1.2
    writeFileSync(join(dir, "voice", "scene-a.srt"), "1\n00:00:00,300 --> 00:00:01,200\nA nói\n");
    // Scene B: 3.0s voice, one cue 0.1→2.9
    writeFileSync(join(dir, "voice", "scene-b.srt"), "1\n00:00:00,100 --> 00:00:02,900\nB nói\n");

    const merged = await buildMergedSrt(
      [
        { id: "a", durationSec: 2.0 },
        { id: "b", durationSec: 3.0 },
      ],
      join(dir, "voice"),
      0.3, // gap
    );

    expect(merged).not.toBeNull();
    const cues = parseSrt(merged!);
    // Scene A starts at 0 → cue 0.3→1.2 unchanged
    expect(cues[0]).toEqual({ start: 0.3, end: 1.2, text: "A nói" });
    // Scene B starts at 2.0 + 0.3 = 2.3 → cue 2.4→5.2
    expect(cues[1].start).toBeCloseTo(2.4, 3);
    expect(cues[1].end).toBeCloseTo(5.2, 3);
  });

  it("clamps cue end to the scene's voice duration", async () => {
    mkdirSync(join(dir, "voice"), { recursive: true });
    // Cue claims to run to 9s but the scene voice is only 4s
    writeFileSync(join(dir, "voice", "scene-x.srt"), "1\n00:00:00,000 --> 00:00:09,000\ntext dài\n");

    const merged = await buildMergedSrt([{ id: "x", durationSec: 4 }], join(dir, "voice"), 0.3);
    expect(parseSrt(merged!)[0].end).toBe(4);
  });

  it("skips scenes without SRT files and returns null if none have SRT", async () => {
    mkdirSync(join(dir, "voice"), { recursive: true });
    writeFileSync(join(dir, "voice", "scene-a.srt"), "1\n00:00:00,000 --> 00:00:01,000\nchỉ A\n");

    const merged = await buildMergedSrt(
      [
        { id: "a", durationSec: 1 },
        { id: "nosrt", durationSec: 2 },
      ],
      join(dir, "voice"),
      0.3,
    );
    // Scene a cue present; nosrt contributes nothing but shifts nothing after it
    expect(parseSrt(merged!)).toHaveLength(1);

    const none = await buildMergedSrt([{ id: "nosrt", durationSec: 2 }], join(dir, "voice"), 0.3);
    expect(none).toBeNull();
  });
});

describe("groupCues", () => {
  const cue = (start: number, end: number, text: string) => ({ start, end, text });

  it("merges word cues into phrases within 2–4s", () => {
    // 16 words × ~0.4s = 6.4s total → must split into ≥2 grouped cues
    const words = ["Bạn", "trả", "gói", "Ultra", "mà", "vẫn", "dính", "watermark",
      "Reddit", "bùng", "nổ", "vì", "chuyện", "này", "quá", "tức"];
    const cues = words.map((w, i) => cue(i * 0.4, i * 0.4 + 0.35, w));
    const grouped = groupCues(cues);
    expect(grouped.length).toBeLessThan(words.length);
    expect(grouped.length).toBeGreaterThan(1);
    for (const g of grouped) {
      expect(g.end - g.start).toBeLessThanOrEqual(4.0 + 0.45); // maxDur + one word
    }
    // No words lost
    const joined = grouped.map((g) => g.text).join(" ");
    expect(joined).toBe(words.join(" "));
  });

  it("keeps a short phrase as a single cue", () => {
    const words = ["Câu", "ngắn", "chỉ", "vài", "từ"];
    const cues = words.map((w, i) => cue(i * 0.4, i * 0.4 + 0.35, w));
    const grouped = groupCues(cues);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].text).toBe(words.join(" "));
  });

  it("breaks at sentence punctuation", () => {
    const cues = [
      cue(0, 0.4, "Câu"),
      cue(0.4, 0.8, "một."),
      cue(0.8, 1.2, "Câu"),
      cue(1.2, 1.6, "hai."),
    ];
    const grouped = groupCues(cues);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].text).toBe("Câu một.");
    expect(grouped[1].text).toBe("Câu hai.");
  });

  it("breaks on a long pause between words", () => {
    const cues = [
      cue(0, 0.5, "trước"),
      cue(1.2, 1.7, "sau"), // 0.7s gap
    ];
    const grouped = groupCues(cues);
    expect(grouped).toHaveLength(2);
  });

  it("caps words per cue", () => {
    // 20 fast words, no punctuation, no gaps → must still split by maxWords/maxDur
    const cues = Array.from({ length: 20 }, (_, i) => cue(i * 0.1, i * 0.1 + 0.09, `w${i}`));
    const grouped = groupCues(cues);
    expect(grouped.length).toBeGreaterThan(1);
    for (const g of grouped) {
      expect(g.text.split(" ").length).toBeLessThanOrEqual(9);
    }
  });

  it("returns empty for empty input", () => {
    expect(groupCues([])).toEqual([]);
  });
});
