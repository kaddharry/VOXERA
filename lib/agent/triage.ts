import type { SupabaseClient } from "@supabase/supabase-js";
import { EMERGENCY_RE, MILD_RE } from "./alert-priority";

/**
 * "Book an appointment only if it was genuinely serious."
 *
 * The voice agent used to book whatever the caller asked for. Now every booking the agent makes must
 * carry a severity, and the server — not the model — decides whether the evidence supports it:
 *
 *   evidence  = what the caller actually said this call, the emotion engine's pain/distress reads,
 *               the patient's risk level, open high-priority alerts and what the LAST call flagged.
 *   decision  = serious/emergency → book.  moderate → book only with supporting context (high-risk
 *               patient, or the last call already flagged a problem).  routine → don't book; raise a
 *               low-priority callback request so a human can arrange it.
 *
 * The model may claim "serious", but a claim with no support in the evidence is capped at "moderate".
 */

export type Severity = "routine" | "moderate" | "serious" | "emergency";
export const SEVERITIES: readonly Severity[] = ["routine", "moderate", "serious", "emergency"];
export const SEVERITY_RANK: Record<Severity, number> = { routine: 0, moderate: 1, serious: 2, emergency: 3 };

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}
export function minSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

// Symptoms that, said plainly, justify a clinic visit. English, Roman-letter Hindi, Devanagari.
const SEVERE_SYMPTOM_RE =
  /(severe|unbearable|excruciating|worst pain|can'?t (sleep|walk|move|eat|stand|bear)|not able to (sleep|walk|move|eat|bear)|swell(ing|ed|en)|\bpus\b|infect(ed|ion)|fever|high temperature|bleed(ing)?|\bblood\b|vomit|dizz(y|iness)|faint|short(ness)? of breath|difficulty breathing|chest|numb(ness)?|getting worse|gotten worse|worse than|worsen(ing|ed)|not (getting )?better|not improving|stitch(es)? (open|came|burst)|wound (open|red|hot|smell)|bahut (zyada |jyada )?(dard|dukh|tez)|asahniya|dard (badh|bad)h?\w*|sujan|bukhar|khoon|ulti|chakkar|aaram nahi|बहुत (ज़्यादा |ज्यादा )?(दर्द|तेज़|तेज)|असहनीय|सूजन|बुखार|खून|उल्टी|चक्कर|आराम नहीं|दर्द (बढ़|बढ)\S*)/i;

const SYMPTOM_RE =
  /(pain|ache|aching|hurts?|sore|tender|dard|दर्द|pareshan|परेशान|uncomfortable|cough|khansi|खांसी|nausea|weak(ness)?|kamzor|कमज़ोर|कमजोर|rash|itch|stiff|tight|burning|jalan|जलन)/i;

export interface BookingEvidence {
  /** What the caller said this call (their own turns only). */
  utterances: string[];
  /** Strongest pain/distress/fear read from the emotion engine this call. */
  emotionPeak: { label: string; intensity: number } | null;
  riskLevel: "low" | "medium" | "high" | "critical";
  hasOpenHighAlert: boolean;
  /** Concerns the previous call's summary flagged (verbatim-grounded). */
  lastCallConcerns: string[];
  /** 0-10 pain the patient reported last call, when they gave a number. */
  lastCallPainScore: number | null;
}

export const EMPTY_EVIDENCE: BookingEvidence = {
  utterances: [],
  emotionPeak: null,
  riskLevel: "low",
  hasOpenHighAlert: false,
  lastCallConcerns: [],
  lastCallPainScore: null,
};

export interface SeverityAssessment {
  level: Severity;
  reasons: string[];
  /** The caller themselves, on THIS call, mentioned a symptom or sounded in pain/distress. History alone never counts. */
  callSignal: boolean;
}

/** What the evidence alone supports, ignoring whatever the model claimed. */
export function assessSeverity(evidence: BookingEvidence): SeverityAssessment {
  const said = evidence.utterances.join(" \n ");
  const reasons: string[] = [];

  if (EMERGENCY_RE.test(said)) return { level: "emergency", reasons: ["Caller described an emergency symptom."], callSignal: true };

  const symptomHit = SYMPTOM_RE.test(said);
  const severeHit = SEVERE_SYMPTOM_RE.test(said);
  const mildHit = MILD_RE.test(said);
  const peak = evidence.emotionPeak;
  const strongEmotion = !!peak && ["pain", "distress", "fear"].includes(peak.label) && peak.intensity >= 0.75;
  const someEmotion = !!peak && ["pain", "distress", "fear"].includes(peak.label) && peak.intensity >= 0.45;

  const callSignal = symptomHit || severeHit || someEmotion;
  let level: Severity = "routine";

  if (severeHit && !mildHit) {
    level = "serious";
    reasons.push("Caller described a serious symptom.");
  }
  if (strongEmotion) {
    level = maxSeverity(level, "serious");
    reasons.push(`Strong ${peak!.label} detected in the caller's voice.`);
  }
  if (evidence.hasOpenHighAlert) {
    level = maxSeverity(level, "serious");
    reasons.push("A high-priority alert is open for this call.");
  }
  if (evidence.lastCallPainScore != null && evidence.lastCallPainScore >= 7 && symptomHit) {
    level = maxSeverity(level, "serious");
    reasons.push(`Last call's pain was ${evidence.lastCallPainScore}/10 and it is still mentioned.`);
  }
  if (evidence.riskLevel === "critical" && (symptomHit || severeHit)) {
    level = maxSeverity(level, "serious");
    reasons.push("Critical-risk patient reporting symptoms.");
  }

  if (level === "routine") {
    if (symptomHit || severeHit) {
      level = "moderate";
      reasons.push("Caller mentioned a symptom.");
    }
    if (someEmotion) {
      level = maxSeverity(level, "moderate");
      reasons.push(`Some ${peak!.label} detected in the caller's voice.`);
    }
    if (evidence.lastCallConcerns.length > 0) {
      level = maxSeverity(level, "moderate");
      reasons.push("The previous call flagged a concern.");
    }
    if (evidence.riskLevel === "high" || evidence.riskLevel === "critical") {
      level = maxSeverity(level, "moderate");
      reasons.push("High-risk patient.");
    }
  }

  if (reasons.length === 0) reasons.push("Nothing in the call suggests a clinical need.");
  return { level, reasons, callSignal };
}

export interface BookingDecision {
  allow: boolean;
  /** What the server will record on the appointment. */
  severity: Severity;
  claimed: Severity | null;
  /** 0-100, higher = more important to keep. */
  priorityScore: number;
  reasons: string[];
  /** Shown to the model when declined, so it tells the caller the truth. */
  refusal?: string;
}

const BASE_SCORE: Record<Severity, number> = { routine: 20, moderate: 50, serious: 80, emergency: 95 };

export function priorityScoreFor(severity: Severity, riskLevel: BookingEvidence["riskLevel"], painScore: number | null): number {
  const riskBonus = { low: 0, medium: 3, high: 6, critical: 10 }[riskLevel] ?? 0;
  const painBonus = painScore != null ? Math.min(5, Math.max(0, Math.round(painScore / 2))) : 0;
  return Math.min(100, BASE_SCORE[severity] + riskBonus + painBonus);
}

/** Appointments below this are flagged "low priority — consider cancelling" in the doctor's view. */
export const LOW_PRIORITY_THRESHOLD = 40;

export function decideBooking(input: { claimed: Severity | null; evidence: BookingEvidence }): BookingDecision {
  const { claimed, evidence } = input;
  const assessed = assessSeverity(evidence);
  // The model can lift a booking to "moderate" on its own say-so, never to "serious": that needs evidence.
  const effective = maxSeverity(assessed.level, minSeverity(claimed ?? "routine", "moderate"));

  const supportingContext =
    evidence.riskLevel === "high" ||
    evidence.riskLevel === "critical" ||
    evidence.lastCallConcerns.length > 0 ||
    (evidence.lastCallPainScore ?? 0) >= 5;

  // A moderate case needs BOTH: the caller raising a symptom on this call, and history that backs it up. Old concerns on
  // file never justify a booking by themselves — otherwise anyone who once reported pain could book anything.
  const allow = SEVERITY_RANK[effective] >= SEVERITY_RANK.serious || (effective === "moderate" && assessed.callSignal && supportingContext);
  const reasons = [...assessed.reasons];
  if (claimed && SEVERITY_RANK[claimed] > SEVERITY_RANK[assessed.level] && SEVERITY_RANK[claimed] >= SEVERITY_RANK.serious) {
    reasons.push(`The assistant rated this "${claimed}" but the call doesn't support that, so it was treated as "${effective}".`);
  }

  return {
    allow,
    severity: effective,
    claimed,
    priorityScore: priorityScoreFor(effective, evidence.riskLevel, evidence.lastCallPainScore),
    reasons,
    ...(allow
      ? {}
      : {
          refusal:
            "Do NOT book. This does not look serious enough for the assistant to book on its own. Tell the patient kindly that you've " +
            "noted the request and the care team will contact them to arrange a visit, and ask whether anything has changed or " +
            "worsened. If they describe worsening or severe symptoms, you may then try booking again with a higher severity.",
        }),
  };
}

// ── Evidence gathering (I/O) ─────────────────────────────────────────────────

const RISK_VALUES = ["low", "medium", "high", "critical"] as const;

/** Reads everything decideBooking needs. Any failed read degrades to "no evidence", i.e. toward NOT booking. */
export async function gatherBookingEvidence(
  db: SupabaseClient,
  input: { clientId: string; patientId: string; sessionId?: string },
): Promise<BookingEvidence> {
  const evidence: BookingEvidence = { ...EMPTY_EVIDENCE, utterances: [], lastCallConcerns: [] };

  const patientP = Promise.resolve(db.from("patients").select('"riskLevel"').eq("id", input.patientId).maybeSingle())
    .then((r) => r.data as { riskLevel?: string } | null)
    .catch(() => null);

  const sessionP = input.sessionId
    ? Promise.all([
        Promise.resolve(db.from("session_logs").select("payload").eq("sessionId", input.sessionId).eq("type", "utterance").order("ts", { ascending: true })).catch(() => ({ data: null })),
        Promise.resolve(db.from("session_logs").select("payload").eq("sessionId", input.sessionId).eq("type", "emotion")).catch(() => ({ data: null })),
        Promise.resolve(db.from("alerts").select("priority, status").eq("sessionId", input.sessionId).eq("status", "open")).catch(() => ({ data: null })),
      ])
    : Promise.resolve(null);

  const lastCallP = Promise.resolve(
    db.from("call_logs").select("summary").eq("clientId", input.clientId).eq("patientId", input.patientId).not("summary", "is", null).order("startedAt", { ascending: false }).limit(1),
  ).catch(() => ({ data: null }));

  const [patient, session, lastCall] = await Promise.all([patientP, sessionP, lastCallP]);

  if (patient?.riskLevel && (RISK_VALUES as readonly string[]).includes(patient.riskLevel)) evidence.riskLevel = patient.riskLevel as BookingEvidence["riskLevel"];

  if (session) {
    const [utter, emo, alerts] = session;
    evidence.utterances = ((utter.data ?? []) as { payload: { role?: string; text?: string } }[])
      .map((r) => r.payload)
      .filter((p) => p?.role === "user" && typeof p.text === "string")
      .map((p) => p.text as string);
    for (const row of (emo.data ?? []) as { payload: { label?: string; intensity?: number } }[]) {
      const { label, intensity } = row.payload ?? {};
      if (typeof label === "string" && typeof intensity === "number" && (!evidence.emotionPeak || intensity > evidence.emotionPeak.intensity)) {
        if (["pain", "distress", "fear"].includes(label)) evidence.emotionPeak = { label, intensity };
      }
    }
    evidence.hasOpenHighAlert = ((alerts.data ?? []) as { priority: string }[]).some((a) => a.priority === "high");
  }

  const summary = (lastCall.data?.[0] as { summary?: { flaggedConcerns?: unknown; painReported?: { present?: boolean; score?: number | null } } } | undefined)?.summary;
  if (summary) {
    if (Array.isArray(summary.flaggedConcerns)) evidence.lastCallConcerns = summary.flaggedConcerns.filter((c): c is string => typeof c === "string");
    const score = summary.painReported?.present ? summary.painReported.score : null;
    evidence.lastCallPainScore = typeof score === "number" ? score : null;
  }
  return evidence;
}
