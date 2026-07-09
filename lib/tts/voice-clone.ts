export async function cloneVoiceElevenLabs(args: {
  name: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn("[VoiceClone] ELEVENLABS_API_KEY is not set. Simulating voice cloning...");
    return `mock-elevenlabs-${Math.random().toString(36).substring(2, 11)}`;
  }

  const formData = new FormData();
  const uint8 = new Uint8Array(args.fileBuffer);
  const blob = new Blob([uint8], { type: args.mimeType });
  formData.append("name", args.name);
  formData.append("files", blob, args.fileName);

  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${errText}`);
  }

  const data: any = await response.json();
  const voiceId = data?.voice_id;
  if (!voiceId) {
    throw new Error("ElevenLabs did not return a voice_id");
  }
  return voiceId;
}

export async function synthesizeElevenLabs(text: string, voiceId: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn("[ElevenLabsTTS] ELEVENLABS_API_KEY is not set. Simulating speech synthesis (returning empty PCM buffer)...");
    // Return a dummy 8kHz linear16 PCM buffer (e.g. 1 second of silence = 8000 samples * 2 bytes/sample = 16000 bytes)
    return Buffer.alloc(16000);
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_8000`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs TTS API error: ${response.status} - ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
