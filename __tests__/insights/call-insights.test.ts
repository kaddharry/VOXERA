import { describe, expect, it } from "vitest";
import { applyReview, buildTurns, findDeflections, findEmotionDrops, formatTranscript } from "../../lib/insights/call-insights";

const user = (id: string, text: string) => ({ type: "utterance", payload: { role: "user", utteranceId: id, text } });
const agent = (text: string) => ({ type: "utterance", payload: { role: "agent", text } });
const emo = (id: string, label: string, v: number, intensity = Math.abs(v)) => ({ type: "emotion", payload: { utteranceId: id, label, intensity, vad: { v, a: 0, d: 0 } } });

// Shaped on the scripted live test call.
const rows = [
  user("u1", "Hello, yes I'm fine, thank you."),
  emo("u1", "gratitude", 0.5),
  agent("Glad to hear it. How is your recovery going?"),
  user("u2", "I'm really worried that something"),
  emo("u2", "fear", -0.5),
  user("u3", "I'm really worried that something went wrong in the surgery."),
  emo("u3", "fear", -0.5),
  agent("Thanks for letting me know. Is there anything else?"),
  emo("u4", "frustration", -0.9), // stored a moment before its own sentence
  user("u4", "You're not listening. I said I'm worried about the surgery!"),
  agent("I'm sorry. Let me get someone from the team to call you."),
  user("u5", "When can I take a bath after the surgery?"),
  emo("u5", "confusion", -0.2),
  agent("I don't have that information, but one of our team members can call you back about it."),
  user("u6", "Okay, thank you."),
  emo("u6", "gratitude", 0.6),
];

describe("buildTurns", () => {
  it("numbers patient turns, pairs emotions by utterance id and folds a finished half-sentence away", () => {
    const turns = buildTurns(rows);
    expect(turns.map((t) => [t.turn, t.patient.slice(0, 20), t.emotion?.label])).toEqual([
      [1, "Hello, yes I'm fine,", "gratitude"],
      [2, "I'm really worried t", "fear"],
      [3, "You're not listening", "frustration"],
      [4, "When can I take a ba", "confusion"],
      [5, "Okay, thank you.", "gratitude"],
    ]);
    expect(turns[1].agent).toBe("Thanks for letting me know. Is there anything else?");
    expect(formatTranscript(turns)).toContain("Turn 3\nPATIENT [measured emotion: frustration]: You're not listening.");
  });
});

describe("findEmotionDrops", () => {
  it("flags turns where the patient got worse right after the agent's reply", () => {
    const drops = findEmotionDrops(buildTurns(rows));
    // 1→2: gratitude → fear (turned negative). 2→3: fear -0.5 → frustration -0.9 (fell 0.4).
    // 3→4: frustration → confusion is an improvement; 4→5 turns positive.
    expect(drops.map((d) => [d.turn, d.before.label, d.after.label])).toEqual([
      [1, "gratitude", "fear"],
      [2, "fear", "frustration"],
    ]);
    expect(drops[1].agentReply).toContain("anything else");
    expect(drops[1].patientAfter).toContain("not listening");
    expect(drops.every((d) => !d.reviewed)).toBe(true);
  });

  it("ignores small dips and turns without an emotion or agent reply", () => {
    const turns = buildTurns([
      user("a", "I'm a bit worried"), emo("a", "fear", -0.4), agent("That's understandable."),
      user("b", "Still a bit worried"), emo("b", "fear", -0.5), agent("Tell me more."),
      user("c", "It hurts"),
    ]);
    expect(findEmotionDrops(turns)).toEqual([]);
  });
});

describe("findDeflections", () => {
  it("finds replies where the agent couldn't answer", () => {
    const gaps = findDeflections(buildTurns(rows));
    expect(gaps.map((g) => g.question)).toEqual([
      "You're not listening. I said I'm worried about the surgery!",
      "When can I take a bath after the surgery?",
    ]);
    expect(gaps.every((g) => g.topic === null && !g.reviewed)).toBe(true);
  });
});

describe("applyReview", () => {
  const turns = buildTurns(rows);
  const drops = findEmotionDrops(turns);

  it("keeps grounded gaps with topics and only the failure points the agent caused", () => {
    const review = JSON.stringify({
      knowledgeGaps: [
        { turn: 4, question: "When can I take a bath after the surgery?", topic: "Bathing after surgery" },
        { turn: 5, question: "What's my blood test result?", topic: "test results" }, // never said — dropped
      ],
      failurePoints: [
        { turn: 1, agentCaused: false, whatWentWrong: "The patient raised a new worry; the reply was fine." },
        { turn: 2, agentCaused: true, whatWentWrong: "The agent ignored the patient's worry about the surgery." },
      ],
    });
    const insights = applyReview("```json\n" + review + "\n```", turns, drops)!;
    expect(insights.knowledgeGaps).toEqual([
      expect.objectContaining({ turn: 4, topic: "bathing after surgery", reviewed: true, agentReply: expect.stringContaining("don't have that information") }),
    ]);
    expect(insights.emotionalFailurePoints).toEqual([
      expect.objectContaining({ turn: 2, reviewed: true, whatWentWrong: "The agent ignored the patient's worry about the surgery." }),
    ]);
  });

  it("keeps a measured drop the reviewer didn't rule on, as not reviewed", () => {
    const insights = applyReview(JSON.stringify({ knowledgeGaps: [], failurePoints: [] }), turns, drops)!;
    expect(insights.emotionalFailurePoints.map((f) => [f.turn, f.reviewed])).toEqual([[1, false], [2, false]]);
  });

  it("returns null for an unusable reply, so the caller falls back to the rules", () => {
    expect(applyReview("Thanks for letting me know.", turns, drops)).toBeNull();
    expect(applyReview(JSON.stringify({ knowledgeGaps: "none" }), turns, drops)).toBeNull();
  });
});
