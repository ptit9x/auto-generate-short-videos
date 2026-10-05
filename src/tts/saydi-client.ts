import axios, { AxiosError } from "axios";
import { writeFile } from "node:fs/promises";
import type { TtsClient } from "./tts-client.js";

export interface SaydiOpts {
  apiKey: string;
  voice: string;        // e.g. "vi-hn-minh-quan"
  model: string;        // e.g. "tts-1-hd"
  endpoint: string;     // e.g. "https://voice.saydi.ai/api/v1"
  speed: number;        // 0.25–4.0, 1.0 = normal
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Saydi TTS client (https://voice.saydi.ai) — OpenAI-compatible speech API.
 *
 * POST {endpoint}/audio/speech with { model, voice, input, response_format, speed }
 * → returns mp3 binary directly. No polling needed.
 *
 * Note: the API does NOT return word timestamps (no /audio/transcriptions either),
 * so `srtOutPath` is ignored silently — subtitles.srt will be skipped by the pipeline.
 */
export class SaydiClient implements TtsClient {
  constructor(private cfg: SaydiOpts) {}

  async generate(text: string, audioOutPath: string, _srtOutPath?: string): Promise<void> {
    await this.synthesizeWithRetry(text, audioOutPath);
    // Saydi has no SRT — silently skip srtOutPath.
  }

  private async synthesizeWithRetry(text: string, outPath: string): Promise<void> {
    const delays = [1000, 2000, 4000];
    let lastErr: unknown;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const url = `${this.cfg.endpoint}/audio/speech`;
        const resp = await axios.post<ArrayBuffer>(
          url,
          {
            model: this.cfg.model,
            voice: this.cfg.voice,
            input: text,
            response_format: "mp3",
            speed: this.cfg.speed,
          },
          {
            headers: {
              Authorization: `Bearer ${this.cfg.apiKey}`,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            responseType: "arraybuffer",
            timeout: 60000,
          },
        );
        await writeFile(outPath, Buffer.from(resp.data));
        return;
      } catch (e) {
        lastErr = e;
        const err = e as AxiosError;
        const status = err.response?.status;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt === delays.length) {
          let detail = err.message;
          if (err.response?.data) {
            try {
              const body = err.response.data instanceof ArrayBuffer
                ? Buffer.from(err.response.data).toString("utf8")
                : String(err.response.data);
              const parsed = JSON.parse(body);
              detail = parsed?.detail?.message ?? parsed?.detail ?? parsed?.error?.message ?? detail;
            } catch { /* ignore parse errors */ }
          }
          throw new Error(`Saydi TTS failed (status ${status ?? "?"}): ${detail}`);
        }
        await sleep(delays[attempt]);
      }
    }
    throw lastErr;
  }
}
