import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RevidClient, resetRoundRobinForTests } from "./revid-client.js";

const mp3 = Buffer.from("ID3fake-mp3-bytes");

function opts(keys: string[]) {
  return {
    apiKeys: keys,
    voiceId: 9010,
    endpoint: "https://revidapi.com/v1",
    pollIntervalMs: 1,
    pollTimeoutMs: 5000,
  };
}

let tmpDir: string;

beforeEach(() => {
  nock.cleanAll();
  resetRoundRobinForTests();
  tmpDir = mkdtempSync(join(tmpdir(), "revid-test-"));
});

afterEach(() => {
  nock.cleanAll();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("RevidClient", () => {
  it("creates a job, polls to completed and writes the downloaded mp3", async () => {
    nock("https://revidapi.com")
      .post("/v1/text-to-speech", { voice_id: 9010, text: "Xin chào" })
      .matchHeader("x-api-key", "sk_a")
      .reply(200, { success: true, job_id: "job-1" });
    nock("https://revidapi.com")
      .get("/v1/text-to-speech/job-1")
      .matchHeader("x-api-key", "sk_a")
      .reply(200, { status: "completed", result: { audio_url: "https://tts.revidapi.com/audio/a.mp3" } });
    nock("https://tts.revidapi.com")
      .get("/audio/a.mp3")
      .reply(200, mp3);

    const out = join(tmpDir, "scene-hook.mp3");
    await new RevidClient(opts(["sk_a"])).generate("Xin chào", out);
    expect(readFileSync(out).equals(mp3)).toBe(true);
    expect(nock.isDone()).toBe(true);
  });

  it("polls through pending before completing", async () => {
    nock("https://revidapi.com").post("/v1/text-to-speech").reply(200, { job_id: "job-2" });
    const status = nock("https://revidapi.com");
    status.get("/v1/text-to-speech/job-2").reply(200, { status: "pending" });
    status.get("/v1/text-to-speech/job-2").reply(200, { status: "processing" });
    status.get("/v1/text-to-speech/job-2").reply(200, { status: "completed", result: { audio_url: "https://tts.revidapi.com/audio/b.mp3" } });
    nock("https://tts.revidapi.com").get("/audio/b.mp3").reply(200, mp3);

    const out = join(tmpDir, "scene-outro.mp3");
    await new RevidClient(opts(["sk_a"])).generate("Tạm biệt", out);
    expect(readFileSync(out).equals(mp3)).toBe(true);
  });

  it("throws when the job fails", async () => {
    nock("https://revidapi.com").post("/v1/text-to-speech").reply(200, { job_id: "job-3" });
    nock("https://revidapi.com").get("/v1/text-to-speech/job-3").reply(200, { status: "failed", message: "bad text" });

    await expect(new RevidClient(opts(["sk_a"])).generate("lỗi", join(tmpDir, "x.mp3"))).rejects.toThrow(/failed: bad text/);
  });

  it("rotates to the next key on 429 and succeeds", async () => {
    nock("https://revidapi.com")
      .post("/v1/text-to-speech")
      .matchHeader("x-api-key", "sk_a")
      .reply(429, { error: "rate limited" });
    nock("https://revidapi.com")
      .post("/v1/text-to-speech")
      .matchHeader("x-api-key", "sk_b")
      .reply(200, { job_id: "job-4" });
    nock("https://revidapi.com").get("/v1/text-to-speech/job-4").reply(200, { status: "completed", result: { audio_url: "https://tts.revidapi.com/audio/c.mp3" } });
    nock("https://tts.revidapi.com").get("/audio/c.mp3").reply(200, mp3);

    const out = join(tmpDir, "scene-body.mp3");
    await new RevidClient(opts(["sk_a", "sk_b"])).generate("thử xoay key", out);
    expect(readFileSync(out).equals(mp3)).toBe(true);
    expect(nock.isDone()).toBe(true);
  });

  it("round-robins keys across successive generate() calls", async () => {
    const client = new RevidClient(opts(["sk_a", "sk_b"]));
    for (const [key, job] of [["sk_a", "j1"], ["sk_b", "j2"], ["sk_a", "j3"]] as const) {
      nock("https://revidapi.com")
        .post("/v1/text-to-speech")
        .matchHeader("x-api-key", key)
        .reply(200, { job_id: job });
      nock("https://revidapi.com").get(`/v1/text-to-speech/${job}`).reply(200, { status: "completed", result: { audio_url: `https://tts.revidapi.com/audio/${job}.mp3` } });
      nock("https://tts.revidapi.com").get(`/audio/${job}.mp3`).reply(200, mp3);
      await client.generate("x", join(tmpDir, `${job}.mp3`));
    }
    expect(nock.isDone()).toBe(true);
  });

  it("fails after all keys are exhausted", async () => {
    nock("https://revidapi.com").post("/v1/text-to-speech").matchHeader("x-api-key", "sk_a").reply(500, {});
    nock("https://revidapi.com").post("/v1/text-to-speech").matchHeader("x-api-key", "sk_b").reply(500, {});

    await expect(new RevidClient(opts(["sk_a", "sk_b"])).generate("chết cả rồi", join(tmpDir, "y.mp3"))).rejects.toThrow(
      /all 2 key/,
    );
    expect(nock.isDone()).toBe(true);
  });
});
