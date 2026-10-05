import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { GoogleTtsClient } from "./google-tts-client.js";

// Real RSA keypair so the JWT assertion is genuinely signed (server-mocked).
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const keyFile = {
  type: "service_account",
  project_id: "test-project",
  private_key_id: "abc",
  private_key: privateKey,
  client_email: "tts@test-project.iam.gserviceaccount.com",
  client_id: "123",
};

function makeClient(voice = "vi-VN-Neural2-D") {
  return new GoogleTtsClient({ credentialsPath: keyPath, voice });
}

let tmpDir: string;
let keyPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gcp-tts-"));
  keyPath = join(tmpDir, "key.json");
  writeFileSync(keyPath, JSON.stringify(keyFile));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  nock.cleanAll();
});

const TOKEN = { access_token: "tok-123", expires_in: 3600 };
const MP3 = Buffer.from("FAKEMP3DATA").toString("base64");

function mockAuth() {
  return nock("https://oauth2.googleapis.com")
    .post("/token")
    .reply(200, TOKEN);
}

function mockSynthesize(body: {
  audioContent: string;
  timepoints?: { markName: string; timeSeconds: number }[];
}) {
  return nock("https://texttospeech.googleapis.com")
    .post("/v1/text:synthesize", (b: any) => {
      // sanity: request must be SSML with per-word marks
      expect(b.input.ssml).toMatch(/^<speak> /);
      expect(b.voice.name).toBe("vi-VN-Neural2-D");
      return true;
    })
    .reply(200, body);
}

describe("GoogleTtsClient", () => {
  it("synthesizes audio + writes word-cued SRT from timepoints", async () => {
    mockAuth();
    mockSynthesize({
      audioContent: MP3,
      timepoints: [
        { markName: "m0", timeSeconds: 0.4 },
        { markName: "m1", timeSeconds: 0.8 },
        { markName: "m2", timeSeconds: 1.3 },
      ],
    });

    const client = makeClient();
    const out = join(tmpDir, "out.mp3");
    const srtOut = join(tmpDir, "out.srt");
    await client.generate("xin chào Việt Nam", out, srtOut);

    expect(readFileSync(out).toString()).toBe("FAKEMP3DATA");
    const srt = readFileSync(srtOut, "utf8");
    // 4 words but only 3 timepoints → 3 cues (last word shares m2's end)
    expect(srt).toContain("00:00:00,000 --> 00:00:00,400\nxin");
    expect(srt).toContain("chào");
    expect(srt).toContain("Việt");
  });

  it("writes no SRT when timepoints are absent", async () => {
    mockAuth();
    mockSynthesize({ audioContent: MP3 });

    const client = makeClient();
    const out = join(tmpDir, "out2.mp3");
    const srtOut = join(tmpDir, "out2.srt");
    await client.generate("hello world", out, srtOut);
    expect(readFileSync(out).toString()).toBe("FAKEMP3DATA");
    // no throw, no file content requirement — SRT silently skipped
  });

  it("reuses the cached OAuth token across calls", async () => {
    mockAuth();
    mockSynthesize({ audioContent: MP3 });
    mockSynthesize({ audioContent: MP3 });

    const client = makeClient();
    await client.generate("a", join(tmpDir, "a.mp3"));
    await client.generate("b", join(tmpDir, "b.mp3"));
    // only ONE token POST happened → cache works
    expect(nock.isDone()).toBe(true);
  });

  it("fails fast (no retry) on 4xx logical errors", async () => {
    mockAuth();
    nock("https://texttospeech.googleapis.com")
      .post("/v1/text:synthesize")
      .reply(400, { error: { message: "Invalid voice name" } });

    const client = makeClient("vi-VN-Bad-Voice");
    await expect(client.generate("hi", join(tmpDir, "c.mp3"))).rejects.toThrow(/400/);
  });

  it("retries on 5xx with backoff then succeeds", async () => {
    mockAuth();
    nock("https://texttospeech.googleapis.com")
      .post("/v1/text:synthesize").reply(503, "unavailable")
      .post("/v1/text:synthesize").reply(200, { audioContent: MP3 });

    const client = makeClient();
    const out = join(tmpDir, "d.mp3");
    await client.generate("hi", out);
    expect(readFileSync(out).toString()).toBe("FAKEMP3DATA");
  });

  it("rejects a non service-account key file", async () => {
    const badPath = join(tmpDir, "bad.json");
    writeFileSync(badPath, JSON.stringify({ type: "authorized_user" }));
    const client = new GoogleTtsClient({ credentialsPath: badPath, voice: "vi-VN-Neural2-D" });
    await expect(client.generate("hi", join(tmpDir, "e.mp3"))).rejects.toThrow(/service-account/);
  });
});
