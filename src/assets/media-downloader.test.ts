import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nock from "nock";
import { downloadMedia, loadManifest } from "./media-downloader.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "media-dl-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  nock.cleanAll();
});

// Tiny but >2048B "jpeg"
const fakeJpeg = Buffer.alloc(3000, 0xff);
const fakePng = Buffer.alloc(2500, 0x00);
const fakeMp4 = Buffer.alloc(4000, 0x01);

describe("downloadMedia", () => {
  it("downloads images + videos with deterministic names and writes a manifest", async () => {
    nock("https://cdn.example.com")
      .get("/photos/a.jpg").reply(200, fakeJpeg, { "content-type": "image/jpeg" })
      .get("/videos/b.mp4").reply(200, fakeMp4, { "content-type": "video/mp4" });

    const { entries, failures } = await downloadMedia(
      [
        { kind: "image", url: "https://cdn.example.com/photos/a.jpg" },
        { kind: "video", url: "https://cdn.example.com/videos/b.mp4" },
      ],
      dir,
    );

    expect(failures).toHaveLength(0);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ placeholder: "$media.1", relPath: "media/media-1.jpg", kind: "image", bytes: 3000 });
    expect(entries[1]).toMatchObject({ placeholder: "$media.2", relPath: "media/media-2.mp4", kind: "video" });
    expect(existsSync(join(dir, "media", "media-1.jpg"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(dir, "media-manifest.json"), "utf8"));
    expect(manifest).toHaveLength(2);
    expect(manifest[0].sourceUrl).toBe("https://cdn.example.com/photos/a.jpg");
  });

  it("derives extension from URL when content-type is generic (video octet-stream)", async () => {
    nock("https://cdn.example.com")
      .get("/videos/clip.mp4").reply(200, fakeMp4, { "content-type": "application/octet-stream" });

    const { entries, failures } = await downloadMedia([{ kind: "video", url: "https://cdn.example.com/videos/clip.mp4" }], dir);
    expect(failures).toHaveLength(0);
    expect(entries[0].relPath).toBe("media/media-1.mp4");
  });

  it("skips non-matching content-types and failed downloads without throwing", async () => {
    nock("https://cdn.example.com")
      .get("/photos/html.jpg").reply(200, "<html/>", { "content-type": "text/html" })
      .get("/photos/404.jpg").reply(404);

    const { entries, failures } = await downloadMedia(
      [
        { kind: "image", url: "https://cdn.example.com/photos/html.jpg" },
        { kind: "image", url: "https://cdn.example.com/photos/404.jpg" },
      ],
      dir,
    );

    expect(entries).toHaveLength(0);
    expect(failures).toHaveLength(2);
    expect(failures[0].reason).toContain("non-image");
    expect(failures[1].reason).toBe("http 404");
  });

  it("is idempotent — reuses existing files instead of re-downloading", async () => {
    mkdirSync(join(dir, "media"), { recursive: true });
    writeFileSync(join(dir, "media", "media-1.jpg"), fakeJpeg);

    // No nock route → any HTTP attempt would throw / record a failure
    const { entries, failures } = await downloadMedia(
      [{ kind: "image", url: "https://cdn.example.com/photos/a.jpg" }],
      dir,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].relPath).toBe("media/media-1.jpg");
    expect(failures).toHaveLength(0);
  });

  it("respects maxFiles", async () => {
    nock("https://cdn.example.com")
      .persist()
      .get(/\/img-\d\.jpg/)
      .reply(200, fakeJpeg, { "content-type": "image/jpeg" });

    const items = [1, 2, 3].map((n) => ({ kind: "image" as const, url: `https://cdn.example.com/img-${n}.jpg` }));
    const { entries } = await downloadMedia(items, dir, { maxFiles: 2 });
    expect(entries).toHaveLength(2);
  });
});

describe("loadManifest", () => {
  it("returns [] when no manifest exists, else parses entries", async () => {
    expect(await loadManifest(dir)).toEqual([]);
    writeFileSync(join(dir, "media-manifest.json"), JSON.stringify([{ placeholder: "$media.1", relPath: "media/media-1.jpg", sourceUrl: "u", kind: "image", bytes: 1 }]));
    const m = await loadManifest(dir);
    expect(m[0].placeholder).toBe("$media.1");
  });
});
