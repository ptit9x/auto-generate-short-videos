#!/usr/bin/env python3
"""
yt-stats.py — YouTube performance logger for the growth loop.

Pulls statistics (views/likes/comments) for every video marked uploaded in
video-registry.json and appends a snapshot line to yt-stats-history.jsonl.
Exit codes: 0 = ok, 2 = missing auth files, 3 = API error.

Usage:
  python3 scripts/yt-stats.py            # fetch + append snapshot
  python3 scripts/yt-stats.py --summary  # print history summary only (no API)

Auth: same token cache as scripts/upload-youtube.ts
  ~/.config/auto-video-gen/client_secret.json  (Desktop app)
  ~/.config/auto-video-gen/token.json          (auto-refreshed here)
"""
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from statistics import median

HOME = os.path.expanduser("~")
CFG = os.path.join(HOME, ".config", "auto-video-gen")
SECRET_PATH = os.path.join(CFG, "client_secret.json")
TOKEN_PATH = os.path.join(CFG, "token.json")
REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "..", "video-registry.json")
HISTORY_PATH = os.path.join(os.path.dirname(__file__), "..", "yt-stats-history.jsonl")


def http_json(url, payload=None, headers=None):
    data = urllib.parse.urlencode(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def load_uploaded():
    if not os.path.exists(REGISTRY_PATH):
        return []
    reg = json.load(open(REGISTRY_PATH))
    out = []
    for url, e in reg.get("videos", {}).items():
        yt_id = (e.get("youtube_id")
                 or (e.get("youtube") or {}).get("id"))
        if yt_id:
            out.append({"yt_id": yt_id, "slug": e.get("slug", "?"),
                        "title": e.get("title", "?"), "url": url})
    return out


def get_access_token():
    if not os.path.exists(TOKEN_PATH):
        print(f"NO_AUTH: missing {TOKEN_PATH} — run one upload first to create it.",
              file=sys.stderr)
        sys.exit(2)
    cache = json.load(open(TOKEN_PATH))
    now = datetime.now(timezone.utc).timestamp() * 1000
    if cache.get("access_token") and now < cache.get("expires_at", 0) - 60000:
        return cache["access_token"]
    if not cache.get("refresh_token"):
        print("NO_AUTH: token cache has no refresh_token — re-run upload auth.",
              file=sys.stderr)
        sys.exit(2)
    secret = json.load(open(SECRET_PATH))["installed"]
    tok = http_json(secret["token_uri"], payload={
        "client_id": secret["client_id"],
        "client_secret": secret["client_secret"],
        "refresh_token": cache["refresh_token"],
        "grant_type": "refresh_token",
    })
    cache["access_token"] = tok["access_token"]
    cache["expires_at"] = now + tok.get("expires_in", 3600) * 1000
    json.dump(cache, open(TOKEN_PATH, "w"), indent=2)
    return cache["access_token"]


def fetch_stats(ids):
    token = get_access_token()
    stats = {}
    for i in range(0, len(ids), 50):
        batch = ids[i:i + 50]
        url = ("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id="
               + ",".join(batch))
        data = http_json(url, headers={"Authorization": f"Bearer {token}"})
        for v in data.get("items", []):
            s = v.get("statistics", {})
            stats[v["id"]] = {
                "title": v["snippet"]["title"],
                "publishedAt": v["snippet"]["publishedAt"],
                "views": int(s.get("viewCount", 0)),
                "likes": int(s.get("likeCount", 0)),
                "comments": int(s.get("commentCount", 0)),
            }
    return stats


def append_history(uploaded, stats):
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(HISTORY_PATH, "a") as f:
        for u in uploaded:
            s = stats.get(u["yt_id"])
            if not s:
                continue
            f.write(json.dumps({
                "ts": ts, "yt_id": u["yt_id"], "slug": u["slug"],
                "title": s["title"], "publishedAt": s["publishedAt"],
                "views": s["views"], "likes": s["likes"],
                "comments": s["comments"],
            }, ensure_ascii=False) + "\n")


def summary():
    if not os.path.exists(HISTORY_PATH):
        print("No history yet.")
        return
    latest = {}
    for line in open(HISTORY_PATH):
        try:
            e = json.loads(line)
            latest[e["yt_id"]] = e  # last snapshot wins
        except json.JSONDecodeError:
            continue
    rows = sorted(latest.values(), key=lambda e: -e["views"])
    if not rows:
        print("No history yet.")
        return
    views = [r["views"] for r in rows]
    print(f"{'SLUG':<44}{'VIEWS':>9}{'LIKES':>7}{'COMM':>6}")
    for r in rows:
        print(f"{r['slug'][:43]:<44}{r['views']:>9}{r['likes']:>7}{r['comments']:>6}")
    print(f"\nmedian={int(median(views))}  total={sum(views)}  n={len(rows)}")
    print(json.dumps({"median": int(median(views)), "total": sum(views),
                      "n": len(rows),
                      "best": rows[0]["slug"], "best_views": rows[0]["views"],
                      "worst": rows[-1]["slug"], "worst_views": rows[-1]["views"]},
                     ensure_ascii=False))


if __name__ == "__main__":
    if "--summary" in sys.argv:
        summary()
        sys.exit(0)
    uploaded = load_uploaded()
    if not uploaded:
        print("No uploaded videos in registry yet — nothing to fetch.")
        sys.exit(0)
    try:
        stats = fetch_stats([u["yt_id"] for u in uploaded])
    except urllib.error.HTTPError as e:
        print(f"API_ERROR: {e.code} {e.read().decode()[:300]}", file=sys.stderr)
        sys.exit(3)
    append_history(uploaded, stats)
    print(f"Snapshot appended: {len(stats)}/{len(uploaded)} videos -> {HISTORY_PATH}\n")
    summary()
