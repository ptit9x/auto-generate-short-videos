#!/usr/bin/env python3
"""Split a full-length voice.wav into per-scene MP3s by aligning Whisper
transcription against each scene's voiceText (from script.json), then scale
per-scene SRT timing to the new durations.

Writes:
  voice/scene-<id>.wav  (aligned cut, kept for reference)
  voice/scene-<id>.mp3  (replaces old TTS audio — pipeline reuses it)
  voice/scene-<id>.srt  (old cues stretched to new scene duration)
Backup: voice/scene-<id>.mp3.old-lucylab

Usage: align_split.py <output_dir>
"""
import difflib
import json
import os
import re
import subprocess
import sys

FFMPEG = os.path.expanduser("~/.local/bin/ffmpeg")
FFPROBE = os.path.expanduser("~/.local/bin/ffprobe")

WORD_RE = re.compile(
    r"[0-9a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩị"
    r"òóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+",
    re.IGNORECASE,
)


def norm(text):
    return WORD_RE.findall(text.lower())


def srt_time(sec):
    ms = max(0, round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def parse_srt(text):
    cues = []
    for block in text.strip().split("\n\n"):
        lines = [l for l in block.splitlines() if l.strip()]
        if len(lines) < 2:
            continue
        tm = re.search(
            r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)",
            lines[1],
        )
        if not tm:
            continue
        g = [int(x) for x in tm.groups()]
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        cues.append({"start": start, "end": end, "text": " ".join(lines[2:])})
    return cues


def fmt_srt(cues):
    blocks = []
    for i, c in enumerate(cues, 1):
        blocks.append(
            f"{i}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}"
        )
    return "\n\n".join(blocks) + "\n"


def duration(path):
    out = subprocess.check_output(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]
    )
    return float(out.strip())


def find_anchor_starts(hyp_norm, cursor, anchor, max_starts=8):
    """Candidate start indices where `anchor` (list of tokens) roughly matches."""
    starts = []
    idx = cursor
    while idx < len(hyp_norm) and len(starts) < max_starts:
        # fuzzy first-token match (whisper may spell Vietnamese words slightly off)
        if difflib.SequenceMatcher(None, anchor[0], hyp_norm[idx][0]).ratio() >= 0.7:
            window = [hyp_norm[j][0] for j in range(idx, min(idx + len(anchor), len(hyp_norm)))]
            if difflib.SequenceMatcher(None, anchor, window).ratio() >= 0.5:
                starts.append(idx)
        idx += 1
    return starts


def main():
    outdir = sys.argv[1]
    script = json.load(open(os.path.join(outdir, "script.json")))
    wav = os.path.join(outdir, "voice.wav")
    assert os.path.exists(wav), f"missing {wav}"

    from faster_whisper import WhisperModel

    model = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=os.cpu_count())
    # Decode via ffmpeg → float32 mono 16k numpy (bypasses the broken `av` dep)
    import numpy as np

    raw = subprocess.check_output(
        [FFMPEG, "-v", "error", "-i", wav, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
    )
    audio = np.frombuffer(raw, dtype=np.float32)
    segments, info = model.transcribe(audio, language="vi", word_timestamps=True, vad_filter=True)
    hyp_words = []
    for seg in segments:
        for w in seg.words or []:
            t = re.sub(r"\s+", " ", w.word).strip()
            if t:
                hyp_words.append({"word": t, "start": float(w.start), "end": float(w.end)})
    print(f"[transcribe] {len(hyp_words)} words, lang={info.language} p={info.language_probability:.2f}")

    hyp_norm = []
    for i, w in enumerate(hyp_words):
        for tok in norm(w["word"]):
            hyp_norm.append((tok, i))
    print(f"[match-seq] {len(hyp_norm)} normalized tokens")

    cursor = 0
    aligned = []
    for scene in script["scenes"]:
        sid = scene["id"]
        ref = norm(scene.get("voiceText") or "")
        if not ref:
            print(f"[scene {sid}] empty voiceText — skipped")
            continue
        n = len(ref)
        lo = max(1, int(n * 0.6))
        hi = int(n * 1.5) + 2

        starts = find_anchor_starts(hyp_norm, cursor, ref[:3])
        if not starts:
            starts = find_anchor_starts(hyp_norm, max(0, cursor - n), ref[-3:])
            starts = [max(0, s - n + 3) for s in starts]
        if not starts:
            # Last-resort: if this is the final non-empty scene, give it the
            # whole remaining audio tail (common case: whisper garbles outro).
            remaining_scenes = [s for s in script["scenes"][script["scenes"].index(scene):] if norm(s.get("voiceText") or "")]
            if len(remaining_scenes) == 1 and cursor < len(hyp_norm):
                words_idx = sorted(set(j for _, j in hyp_norm[cursor:]))
                start_t = hyp_words[words_idx[0]]["start"]
                end_t = hyp_words[words_idx[-1]]["end"]
                aligned.append({"id": sid, "start": start_t, "end": end_t, "score": 0.0,
                                "tok_lo": cursor, "tok_hi": len(hyp_norm)})
                print(f"[scene {sid}] TAIL FALLBACK span={start_t:.2f}-{end_t:.2f}s (score n/a)")
                cursor = len(hyp_norm)
                continue
            print(f"[scene {sid}] NO ANCHOR — aborting this dir")
            return 1

        best, best_score = None, -1.0
        for st in starts:
            for win in range(lo, min(hi, len(hyp_norm) - st) + 1):
                window = [t for t, _ in hyp_norm[st : st + win]]
                score = difflib.SequenceMatcher(None, ref, window).ratio()
                if score > best_score:
                    best_score, best = score, (st, st + win)
        st, en = best
        words_idx = sorted(set(hyp_norm[j][1] for j in range(st, en)))
        start_t = hyp_words[words_idx[0]]["start"]
        end_t = hyp_words[words_idx[-1]]["end"]
        # token-index window into hyp_norm for cue-level SRT alignment
        aligned.append({
            "id": sid,
            "start": start_t,
            "end": end_t,
            "score": best_score,
            "tok_lo": st,
            "tok_hi": en,
        })
        print(f"[scene {sid}] score={best_score:.3f} span={start_t:.2f}-{end_t:.2f}s ({end_t - start_t:.2f}s, ref {n} tok)")
        cursor = en

    for i in range(1, len(aligned)):
        a, b = aligned[i - 1], aligned[i]
        if b["start"] < a["end"] - 0.05:
            print(f"[WARN] overlap {a['id']} -> {b['id']}: {a['end']:.2f} > {b['start']:.2f}")
    scores = [a["score"] for a in aligned]
    print(f"[check] scenes={len(aligned)}/{len(script['scenes'])} min_score={min(scores):.3f} mean={sum(scores)/len(scores):.3f}")
    if min(scores) < 0.55:
        print("[WARN] weak alignment — inspect before rendering")

    # Cut boundaries: scene i spans [first word start, next scene's first word
    # start) capped at +0.8s trailing pause; last scene runs to end of audio.
    wav_dur = duration(wav)
    for i, sc in enumerate(aligned):
        if i + 1 < len(aligned):
            sc["cut_end"] = min(aligned[i + 1]["start"], sc["end"] + 0.8)
        else:
            sc["cut_end"] = wav_dur
        sc["cut_start"] = sc["start"]
        if sc["cut_end"] <= sc["cut_start"]:
            sc["cut_end"] = sc["cut_start"] + 0.2
    for i in range(1, len(aligned)):
        if aligned[i]["cut_start"] < aligned[i - 1]["cut_end"] - 0.05:
            print(f"[WARN] cut overlap {aligned[i-1]['id']} -> {aligned[i]['id']}")

    for sc in aligned:
        sid = sc["id"]
        wpath = os.path.join(outdir, "voice", f"scene-{sid}.wav")
        mpath = os.path.join(outdir, "voice", f"scene-{sid}.mp3")
        if os.path.exists(mpath) and not os.path.exists(mpath + ".old-lucylab"):
            os.rename(mpath, mpath + ".old-lucylab")
        dur = sc["cut_end"] - sc["cut_start"]
        subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", wav, "-ss", f"{sc['cut_start']:.3f}", "-t", f"{dur:.3f}", wpath],
            check=True,
        )
        subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", wpath, "-ar", "44100", "-ac", "2", "-b:a", "192k", mpath],
            check=True,
        )

    for sc in aligned:
        sid = sc["id"]
        srt_path = os.path.join(outdir, "voice", f"scene-{sid}.srt")
        old_mp3 = os.path.join(outdir, "voice", f"scene-{sid}.mp3.old-lucylab")
        new_mp3 = os.path.join(outdir, "voice", f"scene-{sid}.mp3")
        if not os.path.exists(srt_path) or not os.path.exists(old_mp3):
            continue
        old_dur = duration(old_mp3)
        new_dur = duration(new_mp3)
        if old_dur <= 0:
            continue
        cues = parse_srt(open(srt_path).read())
        if sc.get("tok_lo") is not None:
            # Word-accurate: map each cue onto whisper tokens of this scene.
            # Cue text tokens are matched (fuzzy) against the scene's token
            # window; cue time = [first matched token start, last matched end],
            # minus scene cut offset. Fallback to linear stretch per cue.
            scene_toks = [t for t, _ in hyp_norm[sc["tok_lo"]: sc["tok_hi"]]]
            tok_time = [
                (hyp_words[wi]["start"] - sc["cut_start"], hyp_words[wi]["end"] - sc["cut_start"])
                for _, wi in hyp_norm[sc["tok_lo"]: sc["tok_hi"]]
            ]
            new_cues = []
            for c in cues:
                ctoks = norm(c["text"])
                if not ctoks:
                    continue
                sm = difflib.SequenceMatcher(None, scene_toks, ctoks)
                m = sm.find_longest_match(0, len(scene_toks), 0, len(ctoks))
                if m.size >= max(1, int(len(ctoks) * 0.5)):
                    lo = m.a
                    hi = m.a + m.size - 1
                    ns, ne = tok_time[lo][0], tok_time[hi][1]
                    # stretch remaining unmatched tail tokens across cue span
                    if hi - lo + 1 < len(ctoks):
                        span = ne - ns
                        extra = len(ctoks) - (hi - lo + 1)
                        ne = ne + span * extra / max(1, hi - lo + 1)
                else:
                    r = c["end"] / old_dur if old_dur else 1.0
                    ns = (c["start"] / old_dur) * new_dur
                    ne = (c["end"] / old_dur) * new_dur
                new_cues.append({"start": min(ns, ne), "end": ne, "text": c["text"]})
        else:
            new_cues = [
                {
                    "start": c["start"] * new_dur / old_dur,
                    "end": c["end"] * new_dur / old_dur,
                    "text": c["text"],
                }
                for c in cues
            ]
        # enforce monotonic cues
        for i in range(1, len(new_cues)):
            if new_cues[i]["start"] < new_cues[i - 1]["end"]:
                new_cues[i]["start"] = new_cues[i - 1]["end"]
        open(srt_path, "w").write(fmt_srt(new_cues))
        print(f"[srt {sid}] {old_dur:.2f}s -> {new_dur:.2f}s ({len(cues)} cues, word-accurate)" if sc.get("tok_lo") is not None else f"[srt {sid}] {old_dur:.2f}s -> {new_dur:.2f}s ({len(cues)} cues stretched)")

    print("[done]", outdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
