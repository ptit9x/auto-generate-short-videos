import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractMediaFromHtml } from "./media-extractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "tests", "fixtures", "article.html");
const BASE = "https://news.example.com/story/123";

function extract(): ReturnType<typeof extractMediaFromHtml> {
  return extractMediaFromHtml(readFileSync(FIXTURE, "utf8"), BASE);
}

describe("extractMediaFromHtml", () => {
  it("extracts JSON-LD images (string + {url} object forms)", () => {
    const items = extract();
    const urls = items.map((i) => i.url);
    expect(urls).toContain("https://cdn.example.com/photos/jsonld-hero.jpg");
    expect(urls).toContain("https://cdn.example.com/photos/jsonld-second.png");
  });

  it("extracts regular <img> and data-src lazy images with captions", () => {
    const items = extract();
    const hero = items.find((i) => i.url.endsWith("/photos/hero.jpg"));
    expect(hero?.kind).toBe("image");
    expect(hero?.caption).toContain("Đội ngũ");

    const lazy = items.find((i) => i.url.endsWith("/lazy-loading.jpg"));
    expect(lazy).toBeDefined();
  });

  it("picks the widest srcset candidate", () => {
    const items = extract();
    const urls = items.map((i) => i.url);
    expect(urls).toContain("https://cdn.example.com/photos/large.jpg");
    expect(urls).not.toContain("https://cdn.example.com/photos/small.jpg");
    expect(urls).not.toContain("https://cdn.example.com/photos/medium.jpg");
  });

  it("rejects icons, logos, tiny widths and non-image extensions", () => {
    const urls = extract().map((i) => i.url);
    expect(urls).not.toContain("https://news.example.com/icons/menu.svg");
    expect(urls).not.toContain("https://cdn.example.com/photos/tiny.gif");
    expect(urls).not.toContain("https://cdn.example.com/photos/logo-band.png");
    // .gif isn't in the accepted extension list
    expect(urls.every((u) => !u.endsWith(".gif"))).toBe(true);
  });

  it("extracts mp4 + webm videos from <source> and <video src>", () => {
    const items = extract();
    const videos = items.filter((i) => i.kind === "video").map((i) => i.url);
    expect(videos).toContain("https://cdn.example.com/videos/demo.mp4");
    expect(videos).toContain("https://cdn.example.com/videos/teaser.webm");
  });

  it("de-duplicates repeated URLs and preserves first-seen order", () => {
    const items = extract();
    const urls = items.map((i) => i.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.indexOf("https://cdn.example.com/photos/jsonld-hero.jpg"))
      .toBeLessThan(urls.indexOf("https://cdn.example.com/photos/hero.jpg"));
  });

  it("handles malformed JSON-LD without throwing", () => {
    const html = `<script type="application/ld+json">{broken</script><img src="https://x.com/a.jpg" width="500">`;
    const items = extractMediaFromHtml(html, "https://x.com/");
    expect(items.map((i) => i.url)).toContain("https://x.com/a.jpg");
  });
});
