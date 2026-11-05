const GNANI_TTS_URL = "https://api.vachana.ai/api/v1/tts/inference";

export type GnaniLanguage =
  | "auto"
  | "hi-IN"
  | "en-IN"
  | "hi-en"
  | "ta-IN"
  | "te-IN"
  | "kn-IN"
  | "ml-IN"
  | "mr-IN"
  | "pa-IN"
  | "bn-IN"
  | "gu-IN";

async function callGnaniTTS(args: {
  text: string;
  voice: string;
  language: GnaniLanguage;
  model?: string;
  speed?: number;
  audioConfig: {
    sample_rate: number;
    num_channels?: number;
    sample_width?: number;
    encoding: string;
    container: string;
    bitrate?: string;
  };
}): Promise<Buffer> {
  const apiKey = process.env.GNANI_API_KEY;
  if (!apiKey) {
    throw new Error("GNANI_API_KEY is not set");
  }

  const response = await fetch(GNANI_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key-ID": apiKey,
    },
    body: JSON.stringify({
      text: args.text,
      model: args.model ?? "timbre-v2.5",
      voice: args.voice,
      language: args.language,
      speed: args.speed ?? 1.0,
      audio_config: args.audioConfig,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gnani TTS API error: ${response.status} - ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Synthesizes Hinglish/code-mixed speech as a playable WAV file — for demos and listening tests. */
export async function synthesizeGnaniDemo(
  text: string,
  opts?: { voice?: string; model?: string; language?: GnaniLanguage },
): Promise<Buffer> {
  return callGnaniTTS({
    text,
    voice: opts?.voice ?? "Nalini",
    model: opts?.model,
    language: opts?.language ?? "hi-en",
    audioConfig: {
      sample_rate: 24000,
      num_channels: 1,
      sample_width: 2,
      encoding: "linear_pcm",
      container: "wav",
    },
  });
}

/**
 * Synthesizes speech as raw linear16 PCM at 8kHz — telephony-ready, same
 * shape as synthesizeLinear16() in lib/deepgram/tts.ts.
 */
export async function synthesizeGnaniLinear16(
  text: string,
  opts?: { voice?: string; model?: string; language?: GnaniLanguage },
): Promise<Buffer> {
  return callGnaniTTS({
    text,
    voice: opts?.voice ?? "Nalini",
    model: opts?.model,
    language: opts?.language ?? "hi-en",
    audioConfig: {
      sample_rate: 8000,
      num_channels: 1,
      sample_width: 2,
      encoding: "linear_pcm",
      container: "raw",
    },
  });
}
