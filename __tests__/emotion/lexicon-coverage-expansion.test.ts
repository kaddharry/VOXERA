import { describe, it, expect } from "vitest";
import { detectTextEmotionLexicon } from "../../lib/emotion/detect";

/**
 * Lexicon coverage expansion (post-audit). A post-op check-in call's whole
 * purpose is catching a declining patient and clearing up medication
 * confusion — these phrase categories were completely unhandled before.
 * Every addition is a multi-word phrase, not a bare high-risk word, after
 * BUG-E6 ("sick") showed what a single ambiguous word can do — "worse" and
 * "better" alone are exactly that kind of landmine ("could be worse",
 * "I'd better go"), so only qualified phrases are added.
 */
describe("Clinical trend — declining (new coverage)", () => {
  it.each([
    "the pain is getting worse",
    "it's gotten worse since yesterday",
    "it feels worse today",
    "the pain is worse than before",
    "it's much worse now",
    "it hasn't improved at all",
    "it isn't improving",
    "it's still not healing",
  ])("flags %j as distress", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("distress");
  });

  it("does not misfire on an unrelated, harmless use of 'worse'", () => {
    expect(detectTextEmotionLexicon("well, it could be worse I suppose").label).not.toBe("distress");
  });
});

describe("Clinical trend — improving (new coverage)", () => {
  it.each([
    "I'm feeling much better",
    "I'm doing a lot better today",
    "it's healing nicely",
    "I'm recovering well",
    "I'm on the mend",
    "things are getting better",
  ])("flags %j as joy/relief", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("joy");
    expect(detectTextEmotionLexicon(text).vad.v).toBeGreaterThan(0);
  });

  it("does not misfire on an unrelated, harmless use of 'better'", () => {
    expect(detectTextEmotionLexicon("I'd better get going soon").label).not.toBe("joy");
  });

  it("negation still flips it the right way (BUG-E5's fix applies here too)", () => {
    expect(detectTextEmotionLexicon("I don't think I'm feeling any better").vad.v).toBeLessThan(0);
  });
});

describe("Post-op physical symptoms (new coverage)", () => {
  it.each([
    "I've been feeling really nauseous",
    "I have a lot of nausea",
    "my hand feels numb",
    "there's some tingling in my fingers",
    "I think the wound is infected",
    "there's some pus around the stitches",
    "I've had chills all night",
    "I feel really light-headed",
    "I nearly fainted this morning",
    "I feel so weak",
    "I'm completely exhausted",
    "I can't move my arm properly",
  ])("flags %j as distress", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("distress");
  });
});

describe("Medication/dosage confusion (new coverage)", () => {
  it.each([
    "I'm not sure which medicine to take",
    "how much medication should I take",
    "when should I take the next dose",
    "what's the dosage supposed to be",
  ])("flags %j as confusion", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("confusion");
  });
});

describe("Healthcare-system frustration, distinct from generic waiting (new coverage)", () => {
  it.each([
    "nobody called me back",
    "no one answers when I call",
    "I left several messages and nobody responded",
    "I was put on hold for ages",
    "they keep transferring me around",
    "no one tells me anything",
  ])("flags %j as frustration", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("frustration");
  });
});
