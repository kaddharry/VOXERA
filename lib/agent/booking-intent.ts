/**
 * Does the conversation concern booking? Scanned over the whole user block (recent turns included), so
 * "ten o'clock works" mid-booking still counts. Over-matching only costs the bigger model for one turn. */
export const BOOKING_HINT = /appointment|\bbook|\bslot|availab|schedul|reschedul|\bcancel|\bdoctor|\bdr\b|clinic|tomorrow|o'clock|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|अपॉइंटमेंट|बुक|स्लॉट|डॉक्टर|कल|बजे|ਮੁਲਾਕਾਤ|ਡਾਕਟਰ|ਕੱਲ੍ਹ/i;
