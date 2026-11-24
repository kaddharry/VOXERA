/**
 * Per-turn latency marks for a live call, in server milliseconds. The number that matters to a caller is
 * `firstWordMs`: from the moment they stopped talking to the moment the first audio leaves for them.
 *   listenMs   caller stopped talking -> final transcript (speech recognition + its end-of-speech wait)
 *   thinkMs    transcript -> first sentence from the model
 *   voiceMs    first sentence sent to speech synthesis -> first audio
 *   firstWordMs listenMs + thinkMs + voiceMs, end to end
 */
export interface TurnLatency {
  listenMs: number;
  thinkMs?: number;
  voiceMs?: number;
  firstWordMs?: number;
  replyMs: number;
}

export class CallerSoundClock {
  private lastSoundAt = 0;
  /** Call for every chunk of caller audio with its RMS energy; remembers when the caller last made real sound. */
  note(rms: number, threshold = 400): void {
    if (rms > threshold) this.lastSoundAt = Date.now();
  }
  get at(): number {
    return this.lastSoundAt;
  }
}

export class TurnMarks {
  private firstClauseAt?: number;
  private ttsSendAt?: number;
  private firstAudioAt?: number;
  private readonly stoppedAt: number;

  constructor(private readonly transcriptAt: number, lastCallerSoundAt: number) {
    this.stoppedAt = lastCallerSoundAt && lastCallerSoundAt <= transcriptAt ? lastCallerSoundAt : transcriptAt;
  }

  firstClause(): void {
    this.firstClauseAt ??= Date.now();
  }
  ttsSend(): void {
    this.ttsSendAt ??= Date.now();
  }
  /** Returns the final numbers exactly once — when the first audio of the reply goes out; undefined afterwards. */
  firstAudio(): TurnLatency | undefined {
    if (this.firstAudioAt) return undefined;
    this.firstAudioAt = Date.now();
    return this.snapshot();
  }
  snapshot(): TurnLatency {
    return {
      listenMs: this.transcriptAt - this.stoppedAt,
      thinkMs: this.firstClauseAt ? this.firstClauseAt - this.transcriptAt : undefined,
      voiceMs: this.firstAudioAt && this.ttsSendAt ? this.firstAudioAt - this.ttsSendAt : undefined,
      firstWordMs: this.firstAudioAt ? this.firstAudioAt - this.stoppedAt : undefined,
      replyMs: Date.now() - this.transcriptAt,
    };
  }
}
