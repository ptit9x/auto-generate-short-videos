import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Merge per-scene SRT files (voice/scene-<id>.srt) into one subtitles.srt whose
 * timestamps match the final video timeline: scene start = cumulative voice
 * durations + SCENE_GAP_SEC gaps (same math as the pipeline voice concat).
 *
 * If a scene has no SRT (e.g. ElevenLabs), its lines are skipped — the merged
 * file simply contains whatever scenes did produce subtitles.
 */

export interface SceneTiming {
  id: string;
  /** Voice duration in seconds (mp3) */
  durationSec: number;
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: "${ts}"`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
}

function formatTimestamp(sec: number): string {
  if (sec < 0) sec = 0;
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const mss = String(ms % 1000).padStart(3, "0");
  return `${String(h).padStart(2, "0")}:${mm}:${ss},${mss}`;
}

export function parseSrt(content: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = content.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    // Find the line containing " --> "
    const idx = lines.findIndex((l) => l.includes("-->"));
    if (idx === -1) continue;
    const [rawStart, rawEnd] = lines[idx].split("-->").map((p) => p.trim());
    const text = lines.slice(idx + 1).join("\n");
    cues.push({ start: parseTimestamp(rawStart), end: parseTimestamp(rawEnd), text });
  }
  return cues;
}

export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}`)
      .join("\n\n") + "\n"
  );
}

/**
 * Group raw word-level cues into readable phrase cues.
 * Edge TTS emits 1–2-word cues; on YouTube these read as letter-by-letter
 * flicker. Merge consecutive cues so each grouped cue:
 * - lasts ≥ minDur (default 2.0s) when more words are available,
 * - never exceeds maxDur (default 4.0s),
 * - breaks at sentence punctuation (. ? ! …) or a gap ≥ gapSec (default 0.35s),
 * - keeps at most maxWords (default 9) per cue.
 * Returns [] when input is empty.
 */
export function groupCues(
  cues: Cue[],
  opts: { minDur?: number; maxDur?: number; gapSec?: number; maxWords?: number } = {},
): Cue[] {
  const minDur = opts.minDur ?? 2.0;
  const maxDur = opts.maxDur ?? 4.0;
  const gapSec = opts.gapSec ?? 0.35;
  const maxWords = opts.maxWords ?? 9;

  const out: Cue[] = [];
  let buf: Cue[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    out.push({
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      text: buf.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim(),
    });
    buf = [];
  };

  const endsSentence = (text: string): boolean => /[.?!…]$/.test(text.trim());

  for (const cue of cues) {
    if (buf.length === 0) {
      buf.push(cue);
      continue;
    }
    const last = buf[buf.length - 1];
    const dur = cue.end - buf[0].start;
    const gap = cue.start - last.end;
    const words = buf.reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0);

    // Hard cuts: too long already, too many words, or a pause between words.
    if (dur > maxDur || words >= maxWords || gap >= gapSec || endsSentence(last.text)) {
      flush();
      buf.push(cue);
      continue;
    }
    buf.push(cue);
    // Soft close: cue is long enough AND this word ends a sentence → stop here.
    if (endsSentence(cue.text) && cue.end - buf[0].start >= minDur * 0.5) {
      flush();
    }
  }
  flush();
  return out;
}

/**
 * Build the merged, timeline-accurate subtitles.srt.
 * `voiceDir` contains scene-<id>.srt files; timings follow pipeline order.
 * Cues are grouped into 2–4s phrases (see groupCues) for readability.
 */
export async function buildMergedSrt(
  scenes: SceneTiming[],
  voiceDir: string,
  gapSec: number,
): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  let cursor = 0;
  const merged: Cue[] = [];

  for (const scene of scenes) {
    const srtPath = join(voiceDir, `scene-${scene.id}.srt`);
    if (existsSync(srtPath)) {
      const cues = parseSrt(await readFile(srtPath, "utf8"));
      for (const cue of cues) {
        merged.push({
          start: cursor + cue.start,
          end: cursor + Math.min(cue.end, scene.durationSec),
          text: cue.text,
        });
      }
    }
    cursor += scene.durationSec + gapSec;
  }

  if (merged.length === 0) return null;
  return toSrt(groupCues(merged));
}
