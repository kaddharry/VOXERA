/**
 * Tests: OCR quality gate (lib/knowledge/pdf.ts)
 *
 * Added after a real tenant upload (a decorative restaurant menu image)
 * sailed through OCR with no quality check at all — Tesseract returned a
 * mix of garbled item names ("Black Paper ... $27") and near-total noise
 * ("ANS oN 'e S atl TA | ARS") for the SAME document, both silently stored
 * and cited as trusted evidence, producing a different wrong answer to
 * "what's on the menu" on every regeneration. hasPlausibleTextComposition()
 * is the independent backup signal alongside Tesseract's own confidence
 * score (see CONFIG.knowledge.minOcrConfidence's doc comment) — these
 * samples are the actual text pulled from that tenant's stored records.
 */
import { describe, it, expect } from "vitest";
import { hasPlausibleTextComposition } from "../../lib/knowledge/pdf";

const REAL_GARBAGE_SAMPLE = `, "a Yo ya \\
ANS oN 'e S atl TA | ARS
\\ ARNIS ~. (maton %
: hy < PJ ' N) & ph * A {py- : SK: X - XN.
es §Y ola 7 UR ETE
IF EP fe
oe - Fa 3 w_3 CSN \\ . ": ng? es i Bs =y`;

const REAL_READABLE_SAMPLE = `Nolke Zahida Restaurant
MAIN COURSE APPETIZER
Black Paper ........... $27 French Fries ........... $12
Roasted Beef .......... $27 Humburger ........... $14
Spaghetti eee S28 Mini Burger ........... $12
Wagyu Steak .......... $28 Hotdog ensrsaraee S14
Chicken Rise ........... $22 Mini Hotdog ........... $12
Tender Rice ........... $22 Pop Corn ceereeeea. $12`;

describe("hasPlausibleTextComposition", () => {
  it("rejects real OCR noise pulled from an actual bad ingestion", () => {
    expect(hasPlausibleTextComposition(REAL_GARBAGE_SAMPLE)).toBe(false);
  });

  it("accepts the readable portion of the same real document, OCR misreads and all", () => {
    // Deliberately still accepts imperfect OCR ("Humburger", "Chicken Rise")
    // — this gate targets "mostly noise," not "has a few misreads". Fixing
    // individual word-level OCR accuracy is a different problem (better
    // preprocessing/model), not what this gate is for.
    expect(hasPlausibleTextComposition(REAL_READABLE_SAMPLE)).toBe(true);
  });

  it("rejects empty text", () => {
    expect(hasPlausibleTextComposition("")).toBe(false);
    expect(hasPlausibleTextComposition("   \n  ")).toBe(false);
  });

  it("accepts clean, ordinary text", () => {
    expect(hasPlausibleTextComposition("We are open Monday through Friday, 9am to 5pm. Call us at (555) 123-4567.")).toBe(true);
  });
});
