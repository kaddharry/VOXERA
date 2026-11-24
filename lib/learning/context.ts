import type { Learning } from "./types";

const DAY = 86_400_000;

function ago(ts: number, now: number): string {
  const d = Math.floor((now - ts) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

const PATIENT_ORDER = ["open_item", "health_status", "medication", "concern", "contact_preference", "language_preference", "communication_style", "personal_context"];

/** Renders what the agents have learned into one prompt block (or undefined when there is nothing). */
export function buildLearningContext(args: {
  patient: Learning[];
  agent: Learning[];
  global: Learning[];
  now?: number;
  maxPatient?: number;
  maxLessons?: number;
}): string | undefined {
  const now = args.now ?? Date.now();
  const maxPatient = args.maxPatient ?? 14;
  const maxLessons = args.maxLessons ?? 6;
  const parts: string[] = [];

  const patient = [...args.patient]
    .filter((l) => l.status === "active")
    .sort((a, b) => PATIENT_ORDER.indexOf(a.category) - PATIENT_ORDER.indexOf(b.category) || b.updatedAt - a.updatedAt)
    .slice(0, maxPatient);
  if (patient.length) {
    parts.push(
      "=== WHAT WE ALREADY KNOW ABOUT THIS PATIENT (learned from earlier calls) ===\n" +
        patient.map((l) => `- ${l.text} (${l.category.replace(/_/g, " ")}, said ${ago(l.updatedAt, now)})`).join("\n") +
        "\nUse this naturally so the patient does not repeat themselves — never recite it as a list. Health details can change: " +
        "for anything older than a week, check how it is now instead of assuming. Respect stated preferences exactly (a time, a language, who to speak to). Never mention this to anyone but the patient.",
    );
  }

  const lessons = (list: Learning[]) =>
    [...list]
      .filter((l) => l.status === "active")
      .sort((a, b) => b.supportCount * b.confidence - a.supportCount * a.confidence)
      .slice(0, maxLessons)
      .map((l) => `- ${l.text}`);
  const agentLines = lessons(args.agent);
  const globalLines = lessons(args.global).filter((g) => !agentLines.includes(g));
  if (agentLines.length) parts.push("=== LESSONS LEARNED FOR YOU (from your earlier calls) ===\n" + agentLines.join("\n"));
  if (globalLines.length) parts.push("=== LESSONS FROM ALL THE HOSPITAL'S AGENTS ===\n" + globalLines.join("\n"));

  return parts.length ? parts.join("\n\n") : undefined;
}
