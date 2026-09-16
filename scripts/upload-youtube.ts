#!/usr/bin/env tsx
/**
 * Upload a rendered video to YouTube as a Short, with subtitles + thumbnail.
 *
 * Usage:
 *   npm run upload -- output/<dir> [--title "..."] [--desc "..."] [--tags "a,b,c"]
 *                   [--privacy public|unlisted|private] [--no-srt] [--thumb file.png]
 *
 * First-run OAuth: place client_secret.json (Google Cloud Console → "Desktop app")
 * at ~/.config/auto-video-gen/client_secret.json. A browser consent URL is printed;
 * after consenting, Google redirects to localhost:<port> which this script listens
 * on briefly. Token is cached at ~/.config/auto-video-gen/token.json and refreshed
 * automatically on later runs.
 *
 * Metadata fallback: when --title/--desc/--tags are omitted, the script reads
 * youtube-ab-testing.md in the output dir (first title of group 1, description A,
 * tag line) and falls back to script.json metadata.
 *
 * Env overrides: YOUTUBE_CLIENT_SECRET, YOUTUBE_TOKEN_FILE.
 */
import axios from "axios";
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function openUrl(url: string) {
  try {
    execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: "ignore" });
  } catch {
    /* headless — user copies the URL manually */
  }
}

const CFG_DIR = path.join(process.env.HOME ?? ".", ".config", "auto-video-gen");
const SECRET_PATH =
  process.env.YOUTUBE_CLIENT_SECRET ?? path.join(CFG_DIR, "client_secret.json");
const TOKEN_PATH =
  process.env.YOUTUBE_TOKEN_FILE ?? path.join(CFG_DIR, "token.json");

interface OauthSecret {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
    auth_uri: string;
    token_uri: string;
  };
}

interface TokenCache {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

function loadSecret(): OauthSecret {
  if (!fs.existsSync(SECRET_PATH)) {
    console.error(
      `ERROR: missing ${SECRET_PATH}\n` +
        `Create a Google Cloud project → enable "YouTube Data API v3" → ` +
        `OAuth consent screen (External, add yourself as Test user) → ` +
        `Credentials → Create OAuth client ID → type "Desktop app" → ` +
        `download JSON to that path.`
    );
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(SECRET_PATH, "utf-8"));
  if (!raw.installed) {
    console.error("ERROR: client_secret.json must be of type 'Desktop app'.");
    process.exit(2);
  }
  return raw as OauthSecret;
}

async function refreshToken(secret: OauthSecret, cache: TokenCache): Promise<string> {
  if (cache.access_token && Date.now() < cache.expires_at - 60_000) {
    return cache.access_token;
  }
  if (!cache.refresh_token) throw new Error("token expired and no refresh_token; re-auth");
  const { data } = await axios.post(secret.installed.token_uri, null, {
    params: {
      client_id: secret.installed.client_id,
      client_secret: secret.installed.client_secret,
      refresh_token: cache.refresh_token,
      grant_type: "refresh_token",
    },
  });
  cache.access_token = data.access_token;
  cache.expires_at = Date.now() + data.expires_in * 1000;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(cache, null, 2));
  return cache.access_token as string;
}

function listenForCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h3>Đã nhận mã — có thể đóng tab này.</h3>");
      if (code) resolve(code);
      else reject(new Error(err ?? "no code in redirect"));
      srv.close();
    });
    srv.on("error", reject);
    srv.listen(port);
    setTimeout(() => {
      srv.close();
      reject(new Error("timed out waiting for OAuth redirect (10 min)"));
    }, 600_000).unref();
  });
}

async function firstAuth(secret: OauthSecret): Promise<TokenCache> {
  const port = Number(process.env.GOOGLE_OAUTH_PORT ?? 8471);
  const redirect = `http://localhost:${port}`;
  const authUrl =
    `${secret.installed.auth_uri}?response_type=code` +
    `&client_id=${encodeURIComponent(secret.installed.client_id)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&access_type=offline&prompt=consent` +
    `&scope=${encodeURIComponent(
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl"
    )}`;
  console.log("\n=== FIRST-RUN AUTH ===");
  console.log("Mở URL này trong trình duyệt, đăng nhập tài khoản YouTube của bạn:\n");
  console.log(authUrl + "\n");
  openUrl(authUrl);
  const code = await listenForCode(port);
  const { data } = await axios.post(secret.installed.token_uri, null, {
    params: {
      code,
      client_id: secret.installed.client_id,
      client_secret: secret.installed.client_secret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    },
  });
  const cache: TokenCache = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  fs.mkdirSync(CFG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(cache, null, 2));
  console.log("Token saved:", TOKEN_PATH);
  return cache;
}

async function getAccessToken(): Promise<string> {
  const secret = loadSecret();
  let cache: TokenCache | null = fs.existsSync(TOKEN_PATH)
    ? JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"))
    : null;
  if (!cache?.refresh_token) cache = await firstAuth(secret);
  return refreshToken(secret, cache);
}

/** Extract fallback metadata from youtube-ab-testing.md / script.json. */
function defaultMeta(dir: string): { title: string; desc: string; tags: string[] } {
  const abPath = path.join(dir, "youtube-ab-testing.md");
  let title = "";
  let desc = "";
  let tags: string[] = [];
  if (fs.existsSync(abPath)) {
    const md = fs.readFileSync(abPath, "utf-8");
    const m1 = md.match(/^\s*(?:\d+\.\s+)(.+)$/m); // first numbered title
    if (m1) title = m1[1].trim();
    const m2 = md.match(/A\.\s*\(fact-first\)\n([\s\S]*?)(?=\nB\.|$)/);
    if (m2) desc = m2[1].trim();
    const m3 = md.match(/## Tags[^\n]*\n([^\n]+)/);
    if (m3) tags = m3[1].split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (!title) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, "script.json"), "utf-8"));
      title = s.metadata?.title ?? path.basename(dir);
      if (!desc) desc = `${s.metadata?.title ?? ""} — nguồn: ${s.metadata?.source?.domain ?? ""}`;
    } catch {
      title = path.basename(dir);
    }
  }
  return { title, desc, tags };
}

function srtToVtt(srt: string): string {
  return "WEBVTT\n\n" + srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

interface Args {
  dir: string;
  title?: string;
  desc?: string;
  tags?: string;
  privacy: string;
  srt: boolean;
  thumb?: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const out = { privacy: "public", srt: true, force: false } as Args;
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title") out.title = argv[++i];
    else if (a === "--desc") out.desc = argv[++i];
    else if (a === "--tags") out.tags = argv[++i];
    else if (a === "--privacy") out.privacy = argv[++i];
    else if (a === "--no-srt") out.srt = false;
    else if (a === "--thumb") out.thumb = argv[++i];
    else if (a === "--force") out.force = true;
    else pos.push(a);
  }
  out.dir = pos[0] ?? "";
  if (!out.dir) {
    console.error("Usage: npm run upload -- output/<dir> [--title …] [--desc …] [--tags a,b] [--privacy public|unlisted|private] [--no-srt] [--thumb file]");
    process.exit(2);
  }
  return out;
}

async function uploadVideo(args: Args, token: string): Promise<string> {
  const file = path.join(args.dir, "video.mp4");
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const meta = defaultMeta(args.dir);
  const title = args.title ?? meta.title;
  const desc = args.desc ?? meta.desc;
  const tags = (args.tags ?? meta.tags.join(",")).split(",").map((t) => t.trim()).filter(Boolean);
  const privacy = args.privacy;

  console.log(`Title: ${title}`);
  console.log(`Privacy: ${privacy} · tags: ${tags.length} · srt: ${args.srt}`);

  const metadata = {
    snippet: {
      title: title.slice(0, 100),
      description: desc.slice(0, 4900),
      tags: tags.slice(0, 30),
      categoryId: "28", // Science & Technology
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
    },
  };

  // 1) start resumable session
  const init = await axios.post(
    "https://www.googleapis.com/upload/youtube/v3/videos",
    metadata,
    {
      params: { uploadType: "resumable", part: "snippet,status" },
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    }
  );
  const uploadUrl = init.headers.location;

  // 2) upload the file
  const size = fs.statSync(file).size;
  console.log(`Uploading ${file} (${(size / 1e6).toFixed(1)} MB)…`);
  const CHUNK = 16 * 1024 * 1024;
  let offset = 0;
  let videoId = "";
  while (offset < size) {
    const end = Math.min(offset + CHUNK, size) - 1;
    const buf = Buffer.alloc(end - offset + 1);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    const res = await axios.put(uploadUrl, buf, {
      headers: {
        "Content-Length": buf.length,
        "Content-Range": `bytes ${offset}-${end}/${size}`,
        "Content-Type": "video/mp4",
      },
      maxBodyLength: Infinity,
      // intermediate chunks answer 308 (Resume Incomplete) — that's success here
      validateStatus: (s) => (s >= 200 && s < 300) || s === 308,
    });
    if (res.data?.id) videoId = res.data.id;
    offset = end + 1;
    process.stdout.write(`\r${((offset / size) * 100).toFixed(1)}%`);
  }
  console.log();
  if (!videoId) throw new Error("upload finished but no video id returned");
  return videoId;
}

async function uploadSubtitle(dir: string, videoId: string, token: string) {
  const srtPath = path.join(dir, "subtitles.srt");
  if (!fs.existsSync(srtPath)) {
    console.log("No subtitles.srt — skipping captions.");
    return;
  }
  const vtt = srtToVtt(fs.readFileSync(srtPath, "utf-8"));
  // captions.insert is a multipart/related request: JSON metadata + media body
  const boundary = "avg" + Date.now();
  const metadata = JSON.stringify({
    snippet: { videoId, language: "vi", name: "Tiếng Việt", isDraft: false },
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: text/vtt; charset=UTF-8\r\n\r\n`
    ),
    Buffer.from(vtt, "utf-8"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  await axios.post(`https://www.googleapis.com/youtube/v3/captions`, body, {
    params: { part: "snippet" },
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": body.length,
    },
    maxBodyLength: Infinity,
  });
  console.log("Captions uploaded (vi).");
}

async function setThumbnail(dir: string, videoId: string, thumb: string, token: string) {
  const file = thumb.startsWith("/") ? thumb : path.join(dir, thumb);
  if (!fs.existsSync(file)) {
    console.log(`Thumbnail ${file} not found — skipping.`);
    return;
  }
  const buf = fs.readFileSync(file);
  await axios.post(
    `https://www.googleapis.com/youtube/v3/thumbnails/set`,
    buf,
    {
      params: { videoId },
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
      maxBodyLength: Infinity,
    }
  );
  console.log("Thumbnail set:", file);
}

/** Registry helpers (dedupe by source URL, track uploads). */
function registry(args: string[]): string {
  const scriptDir = new URL(".", import.meta.url).pathname;
  return execSync(
    `python3 ${path.join(scriptDir, "video-registry.py")} ${args.map((a) => JSON.stringify(a)).join(" ")}`,
    { encoding: "utf-8" }
  );
}

function sourceUrlOf(dir: string): string | null {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, "script.json"), "utf-8"));
    return s?.metadata?.source?.url ?? null;
  } catch {
    return null;
  }
}

/** Throws if this article was already uploaded (unless --force). */
function assertNotUploaded(dir: string, force: boolean) {
  const url = sourceUrlOf(dir);
  if (!url) return;
  let entry: any = null;
  try {
    entry = JSON.parse(registry(["has", url]));
  } catch {
    return; // not in registry yet = new video
  }
  if (entry?.uploaded && entry?.youtube_id) {
    if (force) {
      console.warn(`WARN: --force re-upload of ${entry.youtube_id} (${entry.slug}).`);
      return;
    }
    console.error(
      `REFUSED: bài này đã upload rồi → https://www.youtube.com/watch?v=${entry.youtube_id} (${entry.slug}).\nDùng --force nếu cố tình upload lại.`
    );
    process.exit(3);
  }
}

function markUploaded(dir: string, videoId: string, privacy: string) {
  try {
    registry(["add", dir]); // ensure present
    registry(["mark-uploaded", dir, videoId, privacy]);
  } catch (e: any) {
    console.warn("registry mark failed:", e.message);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertNotUploaded(args.dir, args.force);
  const token = await getAccessToken();
  const videoId = await uploadVideo(args, token);
  console.log("Video ID:", videoId);
  console.log("URL: https://www.youtube.com/watch?v=" + videoId);
  try {
    await uploadSubtitle(args.dir, videoId, token);
  } catch (e: any) {
    console.warn("Caption upload failed (video is live anyway):", e?.response?.data?.error?.message ?? e.message);
  }
  if (args.thumb) {
    try {
      await setThumbnail(args.dir, videoId, args.thumb, token);
    } catch (e: any) {
      console.warn("Thumbnail set failed:", e?.response?.data?.error?.message ?? e.message);
    }
  }
  markUploaded(args.dir, videoId, args.privacy);
}

main().catch((e) => {
  console.error("ERROR:", e?.response?.data?.error ?? e.message ?? e);
  process.exit(1);
});
