export type AppointmentVisitType = "consultation" | "follow_up" | "procedure" | "telehealth" | "other";
export type AppointmentStatus = "scheduled" | "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled";

export interface Provider {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  specialty: string | null;
  photo_url: string | null;
  color: string;
  status: "active" | "inactive";
  default_slot_minutes: number;
  working_hours: Record<string, [string, string][]> | null;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  tenant_id: string;
  client_id: string;
  provider_id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string;
  visit_type: AppointmentVisitType;
  status: AppointmentStatus;
  notes: string | null;
  booked_via: "staff" | "ai_call";
  booked_by_session_id: string | null;
  created_by_user_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientLite {
  id: string;
  name: string;
  phone: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
}

// Deliberately the --chart-* tokens (app/globals.css) for procedure/
// telehealth, not the --risk-* ramp — visit-type color and status color are
// two independent channels on the same card (see AppointmentCard's doc
// comment), so they draw from two different stored palettes rather than
// colliding on meaning (e.g. a "procedure" visit and a "cancelled" status
// would otherwise both render the same orange).
export const VISIT_TYPE_META: Record<AppointmentVisitType, { label: string; color: string }> = {
  consultation: { label: "Consultation", color: "var(--color-accent-violet)" },
  follow_up: { label: "Follow-up", color: "var(--color-accent-cyan)" },
  procedure: { label: "Procedure", color: "var(--chart-1)" },
  telehealth: { label: "Telehealth", color: "var(--chart-2)" },
  other: { label: "Other", color: "var(--color-text-muted)" },
};

export const STATUS_META: Record<AppointmentStatus, { label: string; color: string }> = {
  scheduled: { label: "Scheduled", color: "var(--color-text-muted)" },
  confirmed: { label: "Confirmed", color: "var(--risk-low)" },
  checked_in: { label: "Checked in", color: "var(--color-accent-cyan)" },
  completed: { label: "Completed", color: "var(--color-text-secondary)" },
  no_show: { label: "No-show", color: "var(--risk-critical)" },
  cancelled: { label: "Cancelled", color: "var(--risk-high)" },
};
