import axios, { AxiosError } from "axios";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import type { TtsClient } from "./tts-client.js";

export interface GoogleTtsOpts {
  /** Path to a GCP service-account JSON key. */
  credentialsPath: string;
  /** Full voice name, e.g. "vi-VN-Neural2-D". */
  voice: string;
  /** Audio encoding for the API request. */
  audioEncoding?: "MP3" | "LINEAR16";
  /** Speaking rate multiplier (0.25–2.0), default 1.0. */
  speakingRate?: number;
  /** Speaking pitch in semitones (-20–20), default 0. */
  pitch?: number;
}

/** A single word-timing mark emitted via SSML <mark> timepoints. */
interface MarkTimePoint {
  markName: string;
  timeSeconds: number;
}

interface SynthesizeResponse {
  audioContent: string; // base64
  timepoints?: MarkTimePoint[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Google returned a 4xx application error (bad voice, quota, auth) — NOT retryable. */
class GoogleTtsApiError extends Error {}

/**
 * Google Cloud Text-to-Speech client (pure REST via axios, no Google SDK).
 *
 * Auth: service-account JSON → OAuth2 access token via
 * POST https://oauth2.googleapis.com/token (RS256-signed JWT assertion,
 * scope "https://www.googleapis.com/auth/cloud-platform"). Token is cached
 * until ~1 min before expiry.
 *
 * Synthesis: POST https://texttospeech.googleapis.com/v1/text:synthesize
 * with input.ssml that places <mark name="mN"/> after every word, so the
 * response timepoints give per-word END times → per-scene SRT subtitles.
 * Retry policy mirrors the other clients: 4xx logical errors fail fast,
 * network/5xx retry ×3 with 1s/2s/4s backoff.
 */
export class GoogleTtsClient implements TtsClient {
  private cachedToken: { token: string; expiresAtMs: number } | null = null;
  private lastTimepoints: MarkTimePoint[] = [];

  constructor(private cfg: GoogleTtsOpts) {}

  async generate(text: string, audioOutPath: string, srtOutPath?: string): Promise<void> {
    const audioContent = await this.synthesizeWithRetry(text);
    await writeFile(audioOutPath, Buffer.from(audioContent, "base64"));

    if (srtOutPath) {
      const srt = this.buildSrt(text, this.lastTimepoints);
      if (srt) await writeFile(srtOutPath, srt, "utf8");
    }
  }

  private async synthesizeWithRetry(text: string): Promise<string> {
    const delays = [1000, 2000, 4000];
    let lastErr: unknown;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        this.lastTimepoints = [];
        return await this.synthesize(text);
      } catch (e) {
        lastErr = e;
        if (e instanceof GoogleTtsApiError) throw e; // 4xx logical errors: never retry
        if (attempt === delays.length) throw e;
        await sleep(delays[attempt]);
      }
    }
    throw lastErr;
  }

  /** XML-escape and wrap text as SSML with a <mark> after each word. */
  private buildSsml(text: string): string {
    const tokens = text.trim().split(/\s+/);
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const parts: string[] = ["<speak>"];
    tokens.forEach((tok, i) => {
      parts.push(escape(tok));
      parts.push(`<mark name="m${i}"/>`);
    });
    parts.push("</speak>");
    return parts.join(" ");
  }

  private async synthesize(text: string): Promise<string> {
    const token = await this.getAccessToken();
    const ssml = this.buildSsml(text);

    let resp;
    try {
      resp = await axios.post<SynthesizeResponse>(
        "https://texttospeech.googleapis.com/v1/text:synthesize",
        {
          input: { ssml },
          voice: { languageCode: "vi-VN", name: this.cfg.voice },
          audioConfig: {
            audioEncoding: this.cfg.audioEncoding ?? "MP3",
            speakingRate: this.cfg.speakingRate ?? 1.0,
            pitch: this.cfg.pitch ?? 0,
          },
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 60000,
        },
      );
    } catch (e) {
      if (e instanceof AxiosError && e.response) {
        const status = e.response.status;
        const detail = JSON.stringify(e.response.data)?.slice(0, 300);
        if (status < 500) {
          // 4xx = logical error (auth, bad voice, quota) → never retry
          throw new GoogleTtsApiError(`Google TTS synthesize failed (${status}): ${detail}`);
        }
        throw new Error(`Google TTS server error (${status}): ${detail}`); // 5xx → retried
      }
      throw e; // network error / timeout → retried by caller
    }

    if (!resp.data.audioContent) {
      throw new GoogleTtsApiError("Google TTS returned empty audioContent");
    }
    this.lastTimepoints = resp.data.timepoints ?? [];
    return resp.data.audioContent;
  }

  /** Get (and cache) an OAuth2 access token from the service-account key. */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs - 60_000) {
      return this.cachedToken.token;
    }

    let key: { type?: string; client_email?: string; private_key?: string };
    try {
      key = JSON.parse(readFileSync(this.cfg.credentialsPath, "utf8"));
    } catch (e) {
      throw new GoogleTtsApiError(
        `Google TTS: cannot read service-account key at ${this.cfg.credentialsPath} (${String(e)})`
      );
    }
    if (key.type !== "service_account" || !key.client_email || !key.private_key) {
      throw new GoogleTtsApiError(
        `Google TTS: ${this.cfg.credentialsPath} is not a valid service-account key`
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })}`;

    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const assertion = `${unsigned}.${signer.sign(key.private_key, "base64url")}`;

    let tokResp;
    try {
      tokResp = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30000 },
      );
    } catch (e) {
      if (e instanceof AxiosError && e.response) {
        const detail = JSON.stringify(e.response.data)?.slice(0, 300);
        throw new GoogleTtsApiError(`Google OAuth token exchange failed (${e.response.status}): ${detail}`);
      }
      throw e;
    }

    const { access_token, expires_in } = tokResp.data as { access_token?: string; expires_in?: number };
    if (!access_token) throw new GoogleTtsApiError("Google OAuth: no access_token in response");
    this.cachedToken = { token: access_token, expiresAtMs: Date.now() + (expires_in ?? 3600) * 1000 };
    return access_token;
  }

  /**
   * Build a word-cued SRT from mark timepoints.
   * Mark m{i} fires when word i ENDS, so cue i spans the PREVIOUS mark's time
   * (or 0) → m{i}. Cues shorter than 0.12s merge into the previous cue.
   */
  private buildSrt(text: string, timepoints: MarkTimePoint[]): string | null {
    if (timepoints.length === 0) return null;
    const words = text.trim().split(/\s+/);
    const ends = timepoints
      .filter((tp) => /^m\d+$/.test(tp.markName))
      .sort((a, b) => Number(a.markName.slice(1)) - Number(b.markName.slice(1)))
      .map((tp) => tp.timeSeconds);

    const cues: { start: number; end: number; text: string }[] = [];
    let prevEnd = 0;
    for (let i = 0; i < words.length && i < ends.length; i++) {
      const end = ends[i];
      const start = prevEnd;
      if (end - start < 0.12 && cues.length > 0) {
        cues[cues.length - 1].text += " " + words[i];
        cues[cues.length - 1].end = end;
      } else {
        cues.push({ start, end, text: words[i] });
      }
      prevEnd = end;
    }
    if (cues.length === 0) return null;

    const fmt = (t: number): string => {
      const ms = Math.round(t * 1000);
      const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
      const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
      const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
      const f = String(ms % 1000).padStart(3, "0");
      return `${h}:${m}:${s},${f}`;
    };
    return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join("\n");
  }
}
