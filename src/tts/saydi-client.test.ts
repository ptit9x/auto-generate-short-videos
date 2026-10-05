import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SaydiClient } from "./saydi-client.js";

const opts = {
  apiKey: "sv_live_test",
  voice: "vi-hn-minh-quan",
  model: "tts-1-hd",
  endpoint: "https://voice.saydi.ai/api/v1",
  speed: 1,
};

let tmpDir: string;

beforeEach(() => {
  nock.cleanAll();
  tmpDir = mkdtempSync(join(tmpdir(), "saydi-test-"));
});

afterEach(() => {
  nock.cleanAll();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SaydiClient", () => {
  it("posts to /audio/speech and writes mp3 response to disk", async () => {
    nock("https://voice.saydi.ai")
      .post(
        "/api/v1/audio/speech",
        (b: any) =>
          b.input === "Xin chào" &&
          b.voice === opts.voice &&
          b.model === opts.model &&
          b.response_format === "mp3"
      )
      .matchHeader("authorization", `Bearer ${opts.apiKey}`)
      .reply(200, Buffer.from("MP3DATA"), { "content-type": "audio/mpeg" });

    const client = new SaydiClient(opts);
    const out = join(tmpDir, "out.mp3");
    await client.generate("Xin chào", out, join(tmpDir, "out.srt"));
    expect(readFileSync(out).toString()).toBe("MP3DATA");
  });

  it("retries on 429 (rate limit) with backoff", async () => {
    nock("https://voice.saydi.ai")
      .post("/api/v1/audio/speech").reply(429, { detail: { message: "rate limit" } })
      .post("/api/v1/audio/speech").reply(200, Buffer.from("OK"), { "content-type": "audio/mpeg" });

    const client = new SaydiClient(opts);
    const out = join(tmpDir, "out.mp3");
    await client.generate("hi", out);
    expect(readFileSync(out).toString()).toBe("OK");
  });

  it("throws readable error on 401 (bad key) without retrying", async () => {
    nock("https://voice.saydi.ai")
      .post("/api/v1/audio/speech").reply(401, { detail: "Invalid API key" });

    const client = new SaydiClient(opts);
    const out = join(tmpDir, "out.mp3");
    await expect(client.generate("hi", out)).rejects.toThrow(/Saydi TTS failed \(status 401\).*Invalid API key/);
    expect(nock.isDone()).toBe(true); // exactly one request — no retry
  });
});
