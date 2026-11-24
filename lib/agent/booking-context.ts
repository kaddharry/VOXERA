import type { SupabaseClient } from "@supabase/supabase-js";
import { listProvidersForTenant } from "../db/providers";

const APPOINTMENT_TOOL_NAMES = ["check_appointment_availability", "book_appointment", "reschedule_appointment", "cancel_appointment", "confirm_appointment"];

export function hasAppointmentTools(enabledTools: string[] | undefined | null): boolean {
  return !!enabledTools?.some((t) => APPOINTMENT_TOOL_NAMES.includes(t));
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; text: string }>();

/** Prompt block that gives the model what it needs to actually call the
 * appointment tools: the real provider ids (it can't invent them) and the
 * rules for using the tools. Without this the model has no providerId, so
 * check/book calls never happen and it just talks about booking. */
export async function buildBookingContext(db: SupabaseClient, tenantId: string, enabledTools: string[]): Promise<string | undefined> {
  if (!hasAppointmentTools(enabledTools)) return undefined;
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

  const providers = await listProvidersForTenant(db, tenantId, { status: "active" }).catch(() => []);
  const lines = providers.length
    ? providers.map((p) => `- ${p.name}${p.specialty ? ` (${p.specialty})` : ""} — providerId=${p.id}, ${p.default_slot_minutes}-minute slots`)
    : ["- (no doctors are set up yet — tell the caller the team will call back to book)"];
  const text = [
    "BOOKING (live tools — you can really check and book):",
    "Doctors:",
    ...lines,
    "Rules: 1) Never say a time is free or booked from memory — call check_appointment_availability for the date first, then offer 2-3 of the returned slots.",
    "2) Once the caller picks a slot — or names a doctor, day and time themselves — call book_appointment RIGHT AWAY with that slot's exact start value; if the slot they named is open, that IS their choice: book it in the same turn, and never offer other slots or ask them to choose again. Say it's booked ONLY after the tool returns success, then read back doctor, day and time in one short sentence (e.g. \"You're booked with Dr. Desai on Friday 27 November at 3 pm.\"). After a successful booking never claim the slot is unavailable: it is theirs. Confirm in ONE short sentence and then only ask if there is anything else — never ask when they want to come, for how long, or from when to when: the booking is already made.",
    "3) If a tool returns an error or availableSlots, say that time isn't available and offer the alternatives. Never claim a booking you did not make.",
    "4) Ask for the day/time yourself when the caller mentions pain or a follow-up — don't wait for them to bring it up.",
  ].join("\n");
  cache.set(tenantId, { at: Date.now(), text });
  return text;
}
