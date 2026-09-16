#!/usr/bin/env python3
"""Video registry: dedupe generated videos by source URL + track YouTube uploads.

Data lives in ~/ai-tools/auto-video-gen/video-registry.json (gitignored).
Shape:
{
  "videos": {
    "<normalized source URL>": {
      "url": "<original URL>",
      "slug": "<output dir name>",
      "dir": "<absolute output dir>",
      "title": "<metadata.title from script.json>",
      "generated_at": "<ISO timestamp>",
      "uploaded": false,
      "youtube_id": null,
      "uploaded_at": null,
      "privacy": null
    }
  }
}

Commands:
  status        Print table of all known videos
  has <url>     Exit 0 if URL already generated (echo entry), exit 1 if new
  add <dir>     Register/refresh an output dir (reads script.json)
  mark-uploaded <dir> <youtube_id> [privacy]  Mark the dir's URL as uploaded
  json          Print JSON dump (for piping)
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

REPO = os.path.expanduser("~/ai-tools/auto-video-gen")
REGISTRY_PATH = os.path.join(REPO, "video-registry.json")


def normalize(url: str) -> str:
    url = url.strip().lower()
    url = re.sub(r"^https?://(www\.)?", "", url)
    url = url.split("?", 1)[0].split("#", 1)[0]
    return url.rstrip("/")


def load() -> dict:
    if os.path.exists(REGISTRY_PATH):
        try:
            return json.load(open(REGISTRY_PATH, encoding="utf-8"))
        except ValueError:
            pass
    return {"videos": {}}


def save(reg: dict) -> None:
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=2)
        f.write("\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def entry_from_dir(dirpath: str) -> dict:
    dirpath = os.path.abspath(dirpath)
    script = json.load(open(os.path.join(dirpath, "script.json"), encoding="utf-8"))
    meta = script.get("metadata", {})
    src = meta.get("source", {})
    url = src.get("url") or f"local:{os.path.basename(dirpath)}"
    return {
        "url": url,
        "slug": os.path.basename(dirpath),
        "dir": dirpath,
        "title": meta.get("title", ""),
        "generated_at": now_iso(),
    }


def find_by_dir(reg: dict, dirpath: str):
    dirpath = os.path.abspath(dirpath)
    for key, e in reg["videos"].items():
        if e.get("dir") == dirpath or e.get("slug") == os.path.basename(dirpath):
            return key, e
    return None, None


def cmd_status(reg: dict) -> int:
    vids = reg["videos"]
    if not vids:
        print("Registry empty. Use: video-registry.py add output/<dir>")
        return 0
    w_slug = max(len(v["slug"]) for v in vids.values())
    print(f"{'slug':<{w_slug}}  {'up':<3}  {'yt_id':<12}  title")
    print("-" * (w_slug + 60))
    for e in sorted(vids.values(), key=lambda v: v["generated_at"]):
        up = "✓" if e.get("uploaded") else "·"
        yt = e.get("youtube_id") or "-"
        print(f"{e['slug']:<{w_slug}}  {up:<3}  {yt:<12}  {e['title'][:60]}")
    n_up = sum(1 for v in vids.values() if v.get("uploaded"))
    print(f"\n{len(vids)} videos · {n_up} uploaded · registry: {REGISTRY_PATH}")
    return 0


def cmd_has(reg: dict, url: str) -> int:
    key = normalize(url)
    e = reg["videos"].get(key)
    if e:
        print(json.dumps(e, ensure_ascii=False))
        return 0
    return 1


def cmd_add(reg: dict, dirpath: str) -> int:
    try:
        e = entry_from_dir(dirpath)
    except FileNotFoundError as ex:
        print(f"ERROR: {ex}", file=sys.stderr)
        return 2
    key = normalize(e["url"])
    old = reg["videos"].get(key)
    if old:
        # keep upload state on re-add (re-render of same article)
        e["uploaded"] = old.get("uploaded", False)
        e["youtube_id"] = old.get("youtube_id")
        e["uploaded_at"] = old.get("uploaded_at")
        e["privacy"] = old.get("privacy")
    else:
        e["uploaded"] = False
        e["youtube_id"] = None
        e["uploaded_at"] = None
        e["privacy"] = None
    reg["videos"][key] = e
    save(reg)
    print(f"registered {e['slug']} -> {key}")
    return 0


def cmd_mark(reg: dict, dirpath: str, yt_id: str, privacy: str | None) -> int:
    key, e = find_by_dir(reg, dirpath)
    if not e:
        # auto-add if script.json exists
        try:
            rc = cmd_add(reg, dirpath)
            if rc:
                return rc
            key, e = find_by_dir(reg, dirpath)
        except Exception:
            pass
    if not e:
        print(f"ERROR: no script.json in {dirpath} and not in registry", file=sys.stderr)
        return 2
    e["uploaded"] = True
    e["youtube_id"] = yt_id
    e["uploaded_at"] = now_iso()
    if privacy:
        e["privacy"] = privacy
    reg["videos"][key] = e
    save(reg)
    # also drop a marker next to the video for humans
    marker = os.path.join(e["dir"], "UPLOADED.json")
    with open(marker, "w", encoding="utf-8") as f:
        json.dump(
            {
                "youtube_id": yt_id,
                "url": f"https://www.youtube.com/watch?v={yt_id}",
                "uploaded_at": e["uploaded_at"],
                "privacy": privacy or e.get("privacy"),
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
        f.write("\n")
    print(f"marked uploaded: {e['slug']} -> https://www.youtube.com/watch?v={yt_id}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    reg = load()
    cmd = argv[1]
    if cmd == "status":
        return cmd_status(reg)
    if cmd == "json":
        print(json.dumps(reg, ensure_ascii=False, indent=2))
        return 0
    if cmd == "has":
        if len(argv) < 3:
            print("usage: has <url>", file=sys.stderr)
            return 2
        return cmd_has(reg, argv[2])
    if cmd == "add":
        if len(argv) < 3:
            print("usage: add <dir>", file=sys.stderr)
            return 2
        return cmd_add(reg, argv[2])
    if cmd == "mark-uploaded":
        if len(argv) < 4:
            print("usage: mark-uploaded <dir> <youtube_id> [privacy]", file=sys.stderr)
            return 2
        return cmd_mark(reg, argv[2], argv[3], argv[4] if len(argv) > 4 else None)
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
