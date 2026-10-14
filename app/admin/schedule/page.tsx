import { redirect } from "next/navigation";

/**
 * Follow-up Schedule was merged into Overview (cross-patient analytics,
 * patient search, and the alerts banner) plus the new Alerts page (the old
 * "Needs Attention" list, now sectioned by pickup status and priority) —
 * see app/admin/page.tsx and app/admin/alerts/page.tsx. This route stays
 * as a redirect so any existing bookmark/link to /admin/schedule still
 * lands somewhere useful instead of 404ing.
 */
export default function ScheduleRedirect() {
  redirect("/admin/alerts");
}
