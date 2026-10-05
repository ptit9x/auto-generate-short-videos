import "dotenv/config";

export type TtsProvider = "edge-tts" | "lucylab" | "elevenlabs" | "vbee" | "google-tts" | "saydi" | "revid";
export type VideoTheme = "dark-neon" | "light-pro" | "dev-terminal";

export interface TiktokConfig {
  displayName: string;
  handle: string;
  followers: string;
  /** URL to download avatar JPG. If undefined, the bundled `assets/avatar.jpg` is used. */
  avatarUrl?: string;
}

export interface Config {
  ttsProvider: TtsProvider;

  // Edge TTS (Free, no API key required)
  edgeTtsVoice: string;
  edgeTtsRate: string;
  edgeTtsPitch: string;
  edgeTtsVolume: string;

  // LucyLab
  lucylabApiKey?: string;
  lucylabVoiceId?: string;
  lucylabEndpoint: string;
  lucylabPollIntervalMs: number;
  lucylabPollTimeoutMs: number;

  // ElevenLabs
  elevenlabsApiKey?: string;
  elevenlabsVoiceId?: string;
  elevenlabsModelId: string;
  elevenlabsEndpoint: string;

  // Vbee
  vbeeAppId?: string;
  vbeeAccessToken?: string;
  vbeeEndpoint: string;
  vbeeVoiceCode: string;
  vbeeSpeedRate: number;
  vbeePollIntervalMs: number;
  vbeePollTimeoutMs: number;

  // Google Cloud Text-to-Speech
  googleCredentialsPath?: string;
  googleVoice: string;
  googleSpeakingRate: number;
  googlePitch: number;

  // Saydi (https://voice.saydi.ai) — OpenAI-compatible Vietnamese TTS
  saydiApiKey?: string;
  saydiVoice: string;
  saydiModel: string;
  saydiEndpoint: string;
  saydiSpeed: number;

  // Revid (https://revidapi.com) — async-job Vietnamese TTS, round-robin keys
  revidApiKeys: string[];
  revidVoiceId: number;
  revidEndpoint: string;
  revidPollIntervalMs: number;
  revidPollTimeoutMs: number;

  // TikTok follow card (outro)
  tiktok: TiktokConfig;

  ttsConcurrency: number;

  /** Visual template — selects which styles.<theme>.css file gets used. */
  videoTheme: VideoTheme;
}

function intDefault(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`Env var ${name} must be integer, got "${v}"`);
  return n;
}

function floatDefault(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseFloat(v);
  if (isNaN(n)) throw new Error(`Env var ${name} must be a number, got "${v}"`);
  return n;
}

/** Parse REVID_API_KEYS (comma-separated) with single REVID_API_KEY fallback. */
function revidKeysFromEnv(): string[] {
  const list = (process.env.REVID_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (list.length > 0) return list;
  const single = (process.env.REVID_API_KEY ?? "").trim();
  return single ? [single] : [];
}

export function loadConfig(): Config {
  const rawProvider = (process.env.TTS_PROVIDER ?? "edge-tts").trim().toLowerCase();
  const provider = (rawProvider === "edgetts" ? "edge-tts" : rawProvider) as TtsProvider;

  if (
    provider !== "edge-tts" &&
    provider !== "lucylab" &&
    provider !== "elevenlabs" &&
    provider !== "vbee" &&
    provider !== "google-tts" &&
    provider !== "saydi" &&
    provider !== "revid"
  ) {
    throw new Error(
      `TTS_PROVIDER must be "edge-tts", "lucylab", "elevenlabs", "vbee", "google-tts", "saydi" or "revid", got "${rawProvider}"`
    );
  }

  // Validate provider-specific required vars
  if (provider === "lucylab") {
    if (!process.env.VIETNAMESE_API_KEY || process.env.VIETNAMESE_API_KEY.trim() === "") {
      throw new Error(
        `Missing VIETNAMESE_API_KEY (required when TTS_PROVIDER=lucylab). ` +
        `Copy .env.example to .env.local and fill in your LucyLab API key.`
      );
    }
    if (!process.env.VIETNAMESE_VOICEID || process.env.VIETNAMESE_VOICEID.trim() === "") {
      throw new Error(
        `Missing VIETNAMESE_VOICEID (required when TTS_PROVIDER=lucylab). ` +
        `Copy .env.example to .env.local and fill in your LucyLab voice ID.`
      );
    }
  } else if (provider === "elevenlabs") {
    if (!process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY.trim() === "") {
      throw new Error(
        `Missing ELEVENLABS_API_KEY (required when TTS_PROVIDER=elevenlabs). ` +
        `Copy .env.example to .env.local and fill in your ElevenLabs API key.`
      );
    }
    if (!process.env.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID.trim() === "") {
      throw new Error(
        `Missing ELEVENLABS_VOICE_ID (required when TTS_PROVIDER=elevenlabs). ` +
        `Copy .env.example to .env.local and fill in your ElevenLabs voice ID.`
      );
    }
  } else if (provider === "vbee") {
    if (!process.env.VBEE_APP_ID || process.env.VBEE_APP_ID.trim() === "") {
      throw new Error(
        `Missing VBEE_APP_ID (required when TTS_PROVIDER=vbee). ` +
        `Copy .env.example to .env.local and fill in your Vbee app ID.`
      );
    }
    if (!process.env.VBEE_ACCESS_TOKEN || process.env.VBEE_ACCESS_TOKEN.trim() === "") {
      throw new Error(
        `Missing VBEE_ACCESS_TOKEN (required when TTS_PROVIDER=vbee). ` +
        `Copy .env.example to .env.local and fill in your Vbee access token.`
      );
    }
  } else if (provider === "google-tts") {
    if (!process.env.GOOGLE_TTS_CREDENTIALS || process.env.GOOGLE_TTS_CREDENTIALS.trim() === "") {
      throw new Error(
        `Missing GOOGLE_TTS_CREDENTIALS (required when TTS_PROVIDER=google-tts). ` +
        `Set it to the path of a GCP service-account JSON key with Text-to-Speech enabled.`
      );
    }
  } else if (provider === "saydi") {
    if (!process.env.SAYDI_API_KEY || process.env.SAYDI_API_KEY.trim() === "") {
      throw new Error(
        `Missing SAYDI_API_KEY (required when TTS_PROVIDER=saydi). ` +
        `Get an API key at https://voice.saydi.ai and set it in .env.local.`
      );
    }
  } else if (provider === "revid") {
    const keys = revidKeysFromEnv();
    if (keys.length === 0) {
      throw new Error(
        `Missing REVID_API_KEYS (required when TTS_PROVIDER=revid). ` +
        `Set it to a comma-separated list of keys, e.g. REVID_API_KEYS=sk_aaa,sk_bbb — they are rotated round-robin. ` +
        `A single REVID_API_KEY is also accepted.`
      );
    }
  }

  const videoTheme = (process.env.VIDEO_THEME ?? "dark-neon") as VideoTheme;
  if (videoTheme !== "dark-neon" && videoTheme !== "light-pro" && videoTheme !== "dev-terminal") {
    throw new Error(`VIDEO_THEME must be "dark-neon", "light-pro" or "dev-terminal", got "${videoTheme}"`);
  }

  return {
    ttsProvider: provider,
    edgeTtsVoice: process.env.EDGE_TTS_VOICE ?? "vi-VN-HoaiMyNeural",
    edgeTtsRate: process.env.EDGE_TTS_RATE ?? "+0%",
    edgeTtsPitch: process.env.EDGE_TTS_PITCH ?? "+0Hz",
    edgeTtsVolume: process.env.EDGE_TTS_VOLUME ?? "+0%",
    lucylabApiKey: process.env.VIETNAMESE_API_KEY,
    lucylabVoiceId: process.env.VIETNAMESE_VOICEID,
    lucylabEndpoint: process.env.LUCYLAB_ENDPOINT ?? "https://api.lucylab.io/json-rpc",
    lucylabPollIntervalMs: intDefault("LUCYLAB_POLL_INTERVAL_MS", 2000),
    lucylabPollTimeoutMs: intDefault("LUCYLAB_POLL_TIMEOUT_MS", 120000),
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
    elevenlabsModelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
    elevenlabsEndpoint: process.env.ELEVENLABS_ENDPOINT ?? "https://api.elevenlabs.io/v1",
    vbeeAppId: process.env.VBEE_APP_ID,
    vbeeAccessToken: process.env.VBEE_ACCESS_TOKEN,
    vbeeEndpoint: process.env.VBEE_ENDPOINT ?? "https://vbee.vn/api/v1",
    vbeeVoiceCode: process.env.VBEE_VOICE_CODE ?? "n_hanoi_male_protrainer_education_vc",
    vbeeSpeedRate: floatDefault("VBEE_SPEED_RATE", 1.0),
    vbeePollIntervalMs: intDefault("VBEE_POLL_INTERVAL_MS", 2000),
    vbeePollTimeoutMs: intDefault("VBEE_POLL_TIMEOUT_MS", 60000),
    googleCredentialsPath: process.env.GOOGLE_TTS_CREDENTIALS,
    googleVoice: process.env.GOOGLE_TTS_VOICE ?? "vi-VN-Neural2-D",
    googleSpeakingRate: floatDefault("GOOGLE_TTS_SPEAKING_RATE", 1.0),
    googlePitch: floatDefault("GOOGLE_TTS_PITCH", 0),
    saydiApiKey: process.env.SAYDI_API_KEY,
    saydiVoice: process.env.SAYDI_VOICE ?? "vi-hn-minh-quan",
    saydiModel: process.env.SAYDI_MODEL ?? "tts-1-hd",
    saydiEndpoint: process.env.SAYDI_ENDPOINT ?? "https://voice.saydi.ai/api/v1",
    saydiSpeed: floatDefault("SAYDI_SPEED", 1.0),
    revidApiKeys: revidKeysFromEnv(),
    revidVoiceId: intDefault("REVID_VOICE_ID", 9010),
    revidEndpoint: process.env.REVID_ENDPOINT ?? "https://revidapi.com/v1",
    revidPollIntervalMs: intDefault("REVID_POLL_INTERVAL_MS", 2000),
    revidPollTimeoutMs: intDefault("REVID_POLL_TIMEOUT_MS", 120000),
    tiktok: {
      displayName: process.env.TIKTOK_DISPLAY_NAME ?? "Công nghệ 24h",
      handle: process.env.TIKTOK_HANDLE ?? "@congnghe24h",
      followers: process.env.TIKTOK_FOLLOWERS ?? "1.2M followers",
      avatarUrl: process.env.TIKTOK_AVATAR_URL || undefined,
    },
    ttsConcurrency: intDefault("TTS_CONCURRENCY", 1),
    videoTheme,
  };
}
