import axios, { AxiosError } from "axios";
import { writeFile } from "node:fs/promises";
import type { TtsClient } from "./tts-client.js";

export interface RevidOpts {
  /** One or more API keys — requests rotate round-robin across them. */
  apiKeys: string[];
  /** Numeric voice id, e.g. 9010. */
  voiceId: number;
  /** API base, default https://revidapi.com/v1. */
  endpoint: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Shared round-robin cursor: rotates across ALL client instances in the
 * process so concurrent scene renders spread load over every key.
 */
let rrCursor = 0;
export function resetRoundRobinForTests(): void {
  rrCursor = 0;
}

interface CreateResponse {
  success?: boolean;
  job_id?: string;
  task_id?: string;
}
interface StatusResponse {
  status: string;
  message?: string;
  result?: { audio_url?: string } | null;
}

/**
 * Revid TTS client (https://revidapi.com/v1).
 *
 * Async job API:
 *   POST /text-to-speech      { voice_id, text }  → { job_id }
 *   GET  /text-to-speech/:id                      → { status, result.audio_url }
 *   GET  <audio_url> (no auth, expires ~20 min)   → mp3 bytes
 *
 * Round-robin key rotation: each generate() call takes the next key; on a
 * key-specific failure (401/403/429/5xx) the call retries with the following
 * key(s) before giving up. The API returns no word timings, so `srtOutPath`
 * is ignored — the pipeline skips subtitles.srt for this provider.
 */
export class RevidClient implements TtsClient {
  constructor(private cfg: RevidOpts) {
    if (cfg.apiKeys.length === 0) throw new Error("RevidClient requires at least one API key");
  }

  private nextKey(offset = 0): string {
    return this.cfg.apiKeys[(rrCursor + offset) % this.cfg.apiKeys.length]!;
  }

  async generate(text: string, audioOutPath: string, _srtOutPath?: string): Promise<void> {
    const n = this.cfg.apiKeys.length;
    // Advance the shared cursor ONCE per generate() call; retries within this
    // call walk forward from the snapshot so each key gets exactly one shot.
    const start = rrCursor;
    rrCursor = (rrCursor + 1) % n;
    let lastErr: unknown;

    for (let attempt = 0; attempt < n; attempt++) {
      const key = this.cfg.apiKeys[(start + attempt) % n]!;
      try {
        const audio = await this.synthesize(key, text);
        await writeFile(audioOutPath, audio);
        return;
      } catch (e) {
        lastErr = e;
        const err = e as AxiosError;
        const status = err.response?.status;
        const retryable = status === undefined || status === 401 || status === 403 || status === 429 || status >= 500;
        if (!retryable) throw e;
        if (n > 1) {
          console.warn(`[revid] key #${(start + attempt) % n} failed (${status ?? "network"}) — rotating to next key`);
        }
      }
    }
    throw new Error(`Revid TTS failed with all ${n} key(s): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  private async synthesize(key: string, text: string): Promise<Buffer> {
    // 1) create job
    const create = await axios.post<CreateResponse>(
      `${this.cfg.endpoint}/text-to-speech`,
      { voice_id: this.cfg.voiceId, text },
      { headers: { "X-API-Key": key, "Content-Type": "application/json" }, timeout: 30000 },
    );
    const jobId = create.data?.job_id ?? create.data?.task_id;
    if (!jobId) throw new Error("Revid TTS: no job_id in create response");

    // 2) poll until completed
    const deadline = Date.now() + this.cfg.pollTimeoutMs;
    let audioUrl: string | undefined;
    let lastStatus = "pending";
    while (Date.now() < deadline) {
      await sleep(this.cfg.pollIntervalMs);
      const st = await axios.get<StatusResponse>(`${this.cfg.endpoint}/text-to-speech/${jobId}`, {
        headers: { "X-API-Key": key },
        timeout: 30000,
      });
      lastStatus = st.data?.status ?? "unknown";
      if (lastStatus === "completed") {
        audioUrl = st.data?.result?.audio_url;
        break;
      }
      if (lastStatus === "failed" || lastStatus === "error") {
        throw new Error(`Revid TTS job ${jobId} failed: ${st.data?.message ?? "no detail"}`);
      }
    }
    if (!audioUrl) throw new Error(`Revid TTS job ${jobId} timed out (status=${lastStatus})`);

    // 3) download audio (URL is pre-signed, no auth header)
    const dl = await axios.get<ArrayBuffer>(audioUrl, { responseType: "arraybuffer", timeout: 60000 });
    return Buffer.from(dl.data);
  }
}
