/**
 * Role → permission matrix. Pure data + pure functions so the rules can be unit-tested and shared
 * by the server routes (enforcement), the admin shell (menu filtering) and the proxy (redirects).
 *
 * The UI only hides things; every API route still calls requireAccess(permission) — that is the
 * real boundary.
 */

export type HospitalRole = "hospital_admin" | "care_coordinator" | "clinician" | "auditor";

export const ALL_ROLES: readonly HospitalRole[] = ["hospital_admin", "care_coordinator", "clinician", "auditor"];

export const ROLE_LABELS: Record<HospitalRole, string> = {
  hospital_admin: "Hospital admin",
  care_coordinator: "Care coordinator",
  clinician: "Doctor",
  auditor: "Auditor (read-only)",
};

export type Permission =
  | "patients.read"
  | "patients.write"
  | "appointments.read"
  | "appointments.write"
  | "appointments.cancel"
  | "alerts.read"
  | "alerts.resolve"
  | "staff.read"
  | "staff.manage"
  | "team.manage"
  | "approvals.review"
  | "calls.read"
  | "insights.read"
  | "agents.manage"
  | "settings.manage"
  | "doctor.portal";

const ALL_ADMIN_PERMISSIONS: Permission[] = [
  "patients.read",
  "patients.write",
  "appointments.read",
  "appointments.write",
  "appointments.cancel",
  "alerts.read",
  "alerts.resolve",
  "staff.read",
  "staff.manage",
  "team.manage",
  "approvals.review",
  "calls.read",
  "insights.read",
  "agents.manage",
  "settings.manage",
];

export const ROLE_PERMISSIONS: Record<HospitalRole, readonly Permission[]> = {
  hospital_admin: ALL_ADMIN_PERMISSIONS,
  care_coordinator: [
    "patients.read",
    "patients.write",
    "appointments.read",
    "appointments.write",
    "appointments.cancel",
    "alerts.read",
    "alerts.resolve",
    "staff.read",
    "calls.read",
    "insights.read",
  ],
  auditor: ["patients.read", "appointments.read", "alerts.read", "staff.read", "calls.read", "insights.read"],
  // Doctors work only in /doctor; their data access is scoped to their own patients by the
  // /api/doctor/* routes, not by these admin-wide permissions.
  clinician: ["doctor.portal"],
};

export function isHospitalRole(value: unknown): value is HospitalRole {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

export function can(role: HospitalRole | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

/** Where a role lands after signing in. */
export function homeForRole(role: HospitalRole | null | undefined): string {
  return role === "clinician" ? "/doctor" : "/admin";
}

/**
 * Which permission an /admin page needs. Longest matching prefix wins; a page with no rule is
 * admin-only (fail closed), so a newly added admin page is never accidentally open to every role.
 */
const ADMIN_PAGE_RULES: Array<{ prefix: string; permission: Permission }> = [
  { prefix: "/admin/patients", permission: "patients.read" },
  { prefix: "/admin/calendar", permission: "appointments.read" },
  { prefix: "/admin/schedule", permission: "appointments.read" },
  { prefix: "/admin/alerts", permission: "alerts.read" },
  { prefix: "/admin/staff", permission: "staff.read" },
  { prefix: "/admin/live_dashboard", permission: "calls.read" },
  { prefix: "/admin/sessions", permission: "calls.read" },
  { prefix: "/admin/learning", permission: "agents.manage" },
  { prefix: "/admin/approvals", permission: "approvals.review" },
  { prefix: "/admin/team", permission: "team.manage" },
  { prefix: "/admin/agents", permission: "agents.manage" },
  { prefix: "/admin/settings", permission: "settings.manage" },
  { prefix: "/admin/tools", permission: "agents.manage" },
  { prefix: "/admin/knowledge", permission: "agents.manage" },
  { prefix: "/admin/try-call", permission: "agents.manage" },
  { prefix: "/admin/campaigns", permission: "settings.manage" },
];

export function permissionForAdminPath(pathname: string): Permission | "admin-only" {
  if (pathname === "/admin") return "patients.read"; // overview is visible to every admin-side role
  const rule = [...ADMIN_PAGE_RULES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return rule ? rule.permission : "admin-only";
}

export function canAccessAdminPath(role: HospitalRole | null | undefined, pathname: string): boolean {
  if (!role) return false;
  if (role === "clinician") return false;
  const needed = permissionForAdminPath(pathname);
  if (needed === "admin-only") return role === "hospital_admin";
  return can(role, needed);
}

export function canAccessDoctorPortal(role: HospitalRole | null | undefined): boolean {
  // Hospital admins may open the doctor portal read-through only if they are also linked to a
  // provider; that is decided by requireAccess (providerId), not here.
  return role === "clinician";
}
