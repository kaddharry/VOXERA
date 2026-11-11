"use client";

import Link from "next/link";
import { TeamLanyardRail } from "../../../components/ui/team-lanyard-rail";
import type { LanyardMember } from "../../../components/ui/team-lanyard-rail";

/**
 * Illustrative call scenarios, not real patients — stock portraits standing
 * in for caller personas, same convention as the Unsplash photos used
 * elsewhere on this page. `tone` follows an ESI-style triage ramp (1 = most
 * critical, 5 = routine/self-serve), matching the --color-chart-* palette
 * defined in globals.css.
 */
const TRIAGE_CASES: LanyardMember[] = [
  {
    id: "chest-pain",
    name: "Robert K.",
    role: "Reported severe chest pain",
    team: "Cardiology · Emergency",
    tone: 1,
    image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "VOXERA caught the emergency keywords, confirmed the symptoms, and bridged the caller straight to the on-call ER physician.",
    tags: ["Critical", "Live escalation", "<20s"],
  },
  {
    id: "pediatric-fever",
    name: "Priya N.",
    role: "Child with a high fever",
    team: "Pediatrics · Urgent",
    tone: 2,
    image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "Flagged the fever as above threshold, gathered vitals, and booked a same-day slot with the on-call pediatrician.",
    tags: ["Urgent", "Same-day"],
  },
  {
    id: "post-op",
    name: "David O.",
    role: "Post-op wound check-in",
    team: "Surgery · Follow-up",
    tone: 3,
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "Ran the standard recovery questionnaire, scored the risk level, and scheduled a nurse call-back for the same afternoon.",
    tags: ["Moderate", "Nurse follow-up"],
  },
  {
    id: "refill",
    name: "Grace L.",
    role: "Prescription refill",
    team: "Pharmacy · Routine",
    tone: 4,
    image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "Verified the prescription on file and sent the refill straight to the pharmacy queue — no staff time needed.",
    tags: ["Routine", "Fully automated"],
  },
  {
    id: "crisis",
    name: "Caller, unlisted",
    role: "Mental health crisis",
    team: "Behavioral Health · Crisis",
    tone: 1,
    image: "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "Detected crisis language, stayed on the line, and bridged the caller to the on-call crisis counselor immediately.",
    tags: ["Critical", "Immediate escalation"],
  },
  {
    id: "med-interaction",
    name: "Lena V.",
    role: "Medication side effects",
    team: "Pharmacy · Clinical",
    tone: 3,
    image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "Logged the reported symptoms, flagged a possible interaction, and routed the call to a clinical pharmacist same day.",
    tags: ["Moderate", "Clinician review"],
  },
  {
    id: "checkup",
    name: "Omar F.",
    role: "Annual check-up",
    team: "Primary Care · Scheduling",
    tone: 5,
    image: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "Matched the caller's insurance and availability, then booked a routine physical with their usual provider.",
    tags: ["Routine", "Self-serve"],
  },
  {
    id: "billing",
    name: "Thomas A.",
    role: "Billing question",
    team: "Patient Accounts",
    tone: 4,
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&h=400&q=80",
    bio: "Looked up the account, explained the charge, and emailed an itemized statement — resolved without a transfer.",
    tags: ["Routine", "Resolved on call"],
  },
];

export default function Overview() {
  return (
    <div id="overview" className="vxl-overview-section">
      <div className="mx-auto w-full max-w-[1200px] rounded-2xl border border-white/10">
        <TeamLanyardRail
          items={TRIAGE_CASES}
          eyebrow="Every caller is different"
          heading="One voice agent, every kind of call your front desk gets."
          caption="Pull a badge to meet a caller. Click to see how VOXERA triaged it."
          autoplay
          action={
            <Link
              href="/book-demo"
              className="vxl-hero-input-btn"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              See it triage a real call
            </Link>
          }
        />
      </div>
    </div>
  );
}
