import { getDeepgram } from "./client";

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export class DeepgramLiveWrapper {
  private live: any | null = null;
  private onTranscript: TranscriptCallback | null = null;

  constructor(onTranscript?: TranscriptCallback) {
    if (onTranscript) {
      this.onTranscript = onTranscript;
    }
  }

  public async connect(): Promise<void> {
    const deepgram = getDeepgram();
    
    // Create the Deepgram Live client using the v5 API
    this.live = await deepgram.listen.v1.connect({
      model: "nova-2",
      language: "en",
      smart_format: "true",
      encoding: "linear16",
      sample_rate: 16000,
      channels: 1,
      interim_results: "true",
      utterance_end_ms: "1000",
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
    });

    console.log("[Deepgram Live] Connected.");

    this.live.on("message", (data: any) => {
      this.handleTranscript(data);
    });

    this.live.on("error", (err: Error) => {
      console.error("[Deepgram Live] Error:", err);
    });

    this.live.on("close", () => {
      console.log("[Deepgram Live] Connection closed.");
    });
  }

  public sendAudio(buffer: Uint8Array | Buffer): void {
    if (this.live && this.live.readyState === 1 /* OPEN */) {
      this.live.sendMedia(buffer);
    }
  }

  public close(): void {
    if (this.live) {
      this.live.close();
      this.live = null;
    }
  }

  private handleTranscript(data: any) {
    // Basic duck-typing for a transcript response vs metadata
    if (data && data.channel && data.channel.alternatives) {
      const isFinal = data.is_final || false;
      const alternatives = data.channel.alternatives;
      
      if (alternatives && alternatives.length > 0) {
        const text = alternatives[0].transcript;
        if (text && text.trim().length > 0) {
          if (this.onTranscript) {
            this.onTranscript(text, isFinal);
          }
        }
      }
    }
  }
}
