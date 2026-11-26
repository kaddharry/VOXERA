/**
 * Does the conversation concern booking? Scanned over the whole user block (recent turns included), so
 * "ten o'clock works" mid-booking still counts. Over-matching only costs the bigger model for one turn. */
export const BOOKING_HINT = /appointment|\bbook|\bslot|availab|schedul|reschedul|\bcancel|\bdoctor|\bdr\b|clinic|tomorrow|o'clock|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|अपॉइंटमेंट|बुक|स्लॉट|डॉक्टर|कल|बजे|ਮੁਲਾਕਾਤ|ਡਾਕਟਰ|ਕੱਲ੍ਹ/i;

/** Medicine talk (the agent is asked about prescribed medicines and records the answers with a tool). Tools are sent
 * on these turns too, but only the care-plan tool — see llm.ts. English, Roman-letter Hindi, Devanagari. */
export const MEDICATION_HINT = /medic|tablet|\bpills?\b|\bdose\b|\bdoses\b|capsule|syrup|injection|\bdawai\b|\bdawa\b|\bdava\b|\bgoli\b|\bgoliyan\b|\bkhaayi\b|\bkhai\b|दवा|दवाई|गोली|गोलियां|टैबलेट|खुराक|इंजेक्शन/i;

/** Is this turn about the patient's medicines? Either generic medicine words (above) or the name of one of the medicines
 * listed in the CARE PLAN ("- Metformin 500 mg, twice a day … [id=med_x]"), so "I took my Metformin" counts too. */
export function isMedicationTurn(conversation: string, system: string): boolean {
  if (MEDICATION_HINT.test(conversation)) return true;
  if (!system.includes("record_medication_adherence")) return false;
  const lower = conversation.toLowerCase();
  for (const m of system.matchAll(/^- ([^\s,]{3,})[^\n]*\[id=/gm)) {
    if (lower.includes(m[1].toLowerCase())) return true;
  }
  return false;
}
