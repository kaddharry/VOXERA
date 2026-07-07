/**
 * End-to-end conversation pipeline scenarios.
 *
 * These tests exercise the voice conversation boundary without live provider
 * credentials: mock audio enters a fake STT adapter, the real orchestrator
 * handles memory/policy/LLM/guard behavior, and the final reply is passed to a
 * fake TTS adapter. Failures include the stage name to make regressions easier
 * to triage in CI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRecord, MemoryTier } from "../../lib/types";
import { DEMO } from "../../lib/bootstrap";
import { handleTurn } from "../../lib/agent/orchestrator";
import { stm } from "../../lib/memory/stm";
import { transcribeBuffer } from "../../lib/deepgram/stt";
import { synthesize } from "../../lib/deepgram/tts";
import { POST as sttPost } from "../../app/api/stt/route";
import { POST as ttsPost } from "../../app/api/tts/route";

type ConversationScenario = {
  name: string;
  audio: Uint8Array;
  transcript: string;
  sttConfidence: number;
  expected: {
    emotion: string;
    replyPattern: RegExp;
    escalation?: "none" | "tier2" | "human";
  };
};

const memoryRecords: MemoryRecord[] = [];
const synthesizedReplies: string[] = [];

const testState = vi.hoisted(() => {
  process.env.SUPABASE_URL = "https://dummy.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy";
  process.env.SUPABASE_ANON_KEY = "dummy";
  process.env.GROQ_API_KEYS = "";
  process.env.DEEPGRAM_API_KEY = "dummy";
  return {
    sttByAudioLength: new Map<number, { transcript: string; confidence: number; languageDetected: string }>(),
  };
});

vi.mock("../../lib/logging/session-logger", () => ({
  makeEvent: vi.fn((base, type, payload) => ({ ...base, type, payload, ts: Date.now() })),
  logSessionEvent: vi.fn(async () => undefined),
}));

vi.mock("../../lib/deepgram/client", () => ({
  hasDeepgram: () => true,
}));

vi.mock("../../lib/deepgram/stt", () => ({
  transcribeBuffer: vi.fn(async (audio: Uint8Array) => ({
    transcript: testState.sttByAudioLength.get(audio.byteLength)?.transcript ?? `mock transcript from ${audio.byteLength} audio bytes`,
    confidence: testState.sttByAudioLength.get(audio.byteLength)?.confidence ?? 0.93,
    languageDetected: testState.sttByAudioLength.get(audio.byteLength)?.languageDetected ?? "en",
  })),
}));

vi.mock("../../lib/deepgram/tts", () => ({
  synthesize: vi.fn(async (text: string) => {
    synthesizedReplies.push(text);
    return new TextEncoder().encode(`mp3:${text}`);
  }),
}));

vi.mock("../../lib/memory/store", () => ({
  vectorStore: {
    async put(record: MemoryRecord) {
      memoryRecords.push(record);
    },
    async get(id: string) {
      return memoryRecords.find((record) => record.id === id);
    },
    async update(id: string, patch: Partial<MemoryRecord>) {
      const record = memoryRecords.find((candidate) => candidate.id === id);
      if (record) Object.assign(record, patch);
    },
    async byTier(tier: MemoryTier, userId: string | null, clientId: string) {
      return memoryRecords.filter((record) => {
        if (record.tier !== tier || record.clientId !== clientId) return false;
        return !userId || tier === "LTM_client" || record.userId === userId;
      });
    },
    async search(args: {
      tier: MemoryTier;
      userId: string | null;
      clientId: string;
      topK: number;
    }) {
      return memoryRecords
        .filter((record) => {
          if (record.tier !== args.tier || record.clientId !== args.clientId) return false;
          return !args.userId || args.tier === "LTM_client" || record.userId === args.userId;
        })
        .slice(0, args.topK)
        .map((rec, index) => ({ rec, sim: 0.92 - index * 0.03 }));
    },
    async nearest() {
      return null;
    },
    async size() {
      return { STM: 0, MTM: 0, LTM_user: 0, LTM_client: 0 };
    },
  },
}));

const scenarios: ConversationScenario[] = [
  {
    name: "billing clarification",
    audio: new Uint8Array([1, 2, 3, 4]),
    transcript: "I am frustrated by an unexpected charge on my latest bill and need help.",
    sttConfidence: 0.91,
    expected: {
      emotion: "frustration",
      replyPattern: /unexpected charge|billing record/i,
      escalation: "tier2",
    },
  },
  {
    name: "connectivity escalation",
    audio: new Uint8Array([9, 8, 7, 6, 5]),
    transcript: "I am furious that my signal keeps dropping and this outage is still not fixed.",
    sttConfidence: 0.88,
    expected: {
      emotion: "anger",
      replyPattern: /senior specialist|signal/i,
    },
  },
  {
    name: "positive close",
    audio: new Uint8Array([4, 4, 2]),
    transcript: "Thank you so much, that was great and really helped.",
    sttConfidence: 0.97,
    expected: {
      emotion: "gratitude",
      replyPattern: /glad that helped|anything else/i,
      escalation: "none",
    },
  },
];

async function runVoiceConversation(scenario: ConversationScenario) {
  const sessionId = `e2e-${scenario.name.replace(/\W+/g, "-")}-${Date.now()}`;
  testState.sttByAudioLength.set(scenario.audio.byteLength, {
    transcript: scenario.transcript,
    confidence: scenario.sttConfidence,
    languageDetected: "en",
  });
  const stt = await transcribeBuffer(scenario.audio, { mimetype: "audio/webm" });

  const turn = await handleTurn({
    sessionId,
    userId: DEMO.userId,
    clientId: DEMO.clientId,
    transcript: stt.transcript,
    sttConfidence: stt.confidence,
  });

  const audio = await synthesize(turn.reply, { policy: turn.trace.policy });
  return { stt, turn, audio, sessionId };
}

function expectStage<T>(stage: string, assertion: () => T): T {
  try {
    return assertion();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[${stage}] ${message}`);
  }
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEYS", "");
  memoryRecords.length = 0;
  synthesizedReplies.length = 0;
  testState.sttByAudioLength.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("E2E voice conversation scenarios", () => {
  for (const scenario of scenarios) {
    it(`runs ${scenario.name} through STT -> Orchestrator -> Memory -> LLM -> TTS`, async () => {
      const { stt, turn, audio, sessionId } = await runVoiceConversation(scenario);

      expectStage("STT", () => {
        expect(stt.transcript).toBe(scenario.transcript);
        expect(stt.confidence).toBe(scenario.sttConfidence);
      });

      expectStage("Orchestrator", () => {
        expect(turn.reply).toMatch(scenario.expected.replyPattern);
        expect(turn.trace.utterance.text).toBe(scenario.transcript);
        expect(turn.trace.llmModel).toBe("offline-fallback");
        expect(turn.trace.usedLiveLlm).toBe(false);
      });

      expectStage("Memory", () => {
        expect(turn.trace.memoryWrite.tier).toMatch(/STM|MTM|LTM_user|discarded/);
        expect(Array.isArray(turn.trace.retrieved.scores)).toBe(true);
        expect(stm.get(sessionId).map((item) => item.role)).toEqual(["user", "agent"]);
      });

      expectStage("Policy", () => {
        expect(turn.trace.emotion.current.label).toBe(scenario.expected.emotion);
        expect(["none", "tier2", "human"]).toContain(turn.trace.policy.escalate);
        if (scenario.expected.escalation) {
          expect(turn.trace.policy.escalate).toBe(scenario.expected.escalation);
        }
      });

      expectStage("TTS", () => {
        expect(audio.byteLength).toBeGreaterThan(0);
        expect(synthesizedReplies).toContain(turn.reply);
      });
    });
  }

  it("keeps short-term memory continuity across multiple turns in one session", async () => {
    const sessionId = `e2e-multiturn-${Date.now()}`;

    await handleTurn({
      sessionId,
      userId: DEMO.userId,
      clientId: DEMO.clientId,
      transcript: "My internet has been down for two days.",
      sttConfidence: 0.9,
    });

    const second = await handleTurn({
      sessionId,
      userId: DEMO.userId,
      clientId: DEMO.clientId,
      transcript: "This is the third time I have called about the same signal issue.",
      sttConfidence: 0.9,
    });

    expectStage("Memory", () => {
      const history = stm.get(sessionId);
      expect(history).toHaveLength(4);
      expect(history.map((turn) => turn.role)).toEqual(["user", "agent", "user", "agent"]);
      expect(second.trace.retrieved.scores.length).toBeGreaterThan(0);
    });
  });
});

describe("Voice route boundaries", () => {
  it("accepts mock audio and returns a normalized STT result", async () => {
    const response = await sttPost(
      new Request("http://localhost/api/stt", {
        method: "POST",
        headers: { "content-type": "audio/webm" },
        body: new Uint8Array([1, 2, 3]),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      transcript: "mock transcript from 3 audio bytes",
      confidence: 0.93,
      languageDetected: "en",
    });
  });

  it("returns synthesized audio bytes for a reply", async () => {
    const response = await ttsPost(
      new Request("http://localhost/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Thanks for calling VOXERA." }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
