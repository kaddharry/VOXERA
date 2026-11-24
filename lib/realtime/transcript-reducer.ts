import type { TurnLatency } from "./turn-latency";

export interface TranscriptTurn {
  role: "user" | "agent";
  text: string;
  /** True while this bubble is still being filled in word-by-word from "transcript_delta" events. */
  streaming?: boolean;
  /** Server time (epoch ms) of the event that created this bubble, for the "+m:ss.mmm" stamp. */
  ts?: number;
  /** Measured on the server when this reply's first audio went out. */
  latency?: TurnLatency;
}

export interface TranscriptState {
  transcript: TranscriptTurn[];
  /** Server time of the first event seen for the call: the zero of every "+m:ss.mmm" stamp. */
  startTs?: number;
  /** Latency that arrived before its reply bubble existed. */
  pendingLatency?: TurnLatency;
}

/** Folds one live event into the transcript. Pure, so it can be tested. Returns the same object for events it ignores. */
export function reduceTranscript<S extends TranscriptState>(prev: S, event: { type: string; data: any; timestamp?: number }): S {
  const at = typeof event.timestamp === "number" ? event.timestamp : undefined;
  const next: S = { ...prev };
  if (next.startTs === undefined && at !== undefined) next.startTs = at;

  if (event.type === "latency") {
    // First audio of a reply just left the server: attach to the newest agent bubble, or hold for the next one.
    let idx = -1;
    for (let i = next.transcript.length - 1; i >= 0; i--) if (next.transcript[i].role === "agent") { idx = i; break; }
    if (idx >= 0 && !next.transcript[idx].latency) {
      next.transcript = next.transcript.map((t, i) => (i === idx ? { ...t, latency: event.data as TurnLatency } : t));
    } else {
      next.pendingLatency = event.data as TurnLatency;
    }
    return next;
  }

  if (event.type === "transcript_delta") {
    const last = next.transcript[next.transcript.length - 1];
    if (last?.role === "agent" && last.streaming) {
      next.transcript = [...next.transcript.slice(0, -1), { ...last, text: event.data.text, streaming: true }];
    } else {
      next.transcript = [...next.transcript, { role: "agent", text: event.data.text, streaming: true, ts: at, latency: next.pendingLatency }];
      next.pendingLatency = undefined;
    }
    return next;
  }

  if (event.type === "transcript") {
    const last = next.transcript[next.transcript.length - 1];
    const isAgent = event.data.role === "agent";
    if (last?.role === event.data.role && last.streaming) {
      next.transcript = [...next.transcript.slice(0, -1), { role: event.data.role, text: event.data.text, ts: last.ts ?? at, latency: last.latency ?? (isAgent ? next.pendingLatency : undefined) }];
    } else {
      next.transcript = [...next.transcript, { role: event.data.role, text: event.data.text, ts: at, latency: isAgent ? next.pendingLatency : undefined }];
    }
    if (isAgent) next.pendingLatency = undefined;
    return next;
  }

  return next;
}
