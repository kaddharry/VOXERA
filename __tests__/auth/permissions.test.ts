import { describe, expect, it } from "vitest";
import { ALL_ROLES, can, canAccessAdminPath, homeForRole, permissionForAdminPath, ROLE_PERMISSIONS } from "../../lib/auth/permissions";
import { navItemsFor } from "../../components/admin/nav";

describe("role permissions", () => {
  it("hospital admins can do everything an admin-side role can", () => {
    for (const p of ["patients.write", "team.manage", "approvals.review", "agents.manage", "settings.manage"] as const) {
      expect(can("hospital_admin", p)).toBe(true);
    }
  });

  it("care coordinators run patients, appointments and alerts but not team, agents, settings or approvals", () => {
    expect(can("care_coordinator", "patients.write")).toBe(true);
    expect(can("care_coordinator", "appointments.cancel")).toBe(true);
    expect(can("care_coordinator", "alerts.resolve")).toBe(true);
    for (const p of ["team.manage", "agents.manage", "settings.manage", "approvals.review", "staff.manage"] as const) {
      expect(can("care_coordinator", p)).toBe(false);
    }
  });

  it("auditors are read-only everywhere", () => {
    const writes = ROLE_PERMISSIONS.auditor.filter((p) => /\.(write|cancel|resolve|manage|review)$/.test(p));
    expect(writes).toEqual([]);
    expect(can("auditor", "patients.read")).toBe(true);
    expect(can("auditor", "patients.write")).toBe(false);
  });

  it("doctors have the doctor portal and nothing on the admin side", () => {
    expect(ROLE_PERMISSIONS.clinician).toEqual(["doctor.portal"]);
    expect(can("clinician", "patients.read")).toBe(false);
    expect(can(null, "patients.read")).toBe(false);
    expect(can(undefined, "doctor.portal")).toBe(false);
  });

  it("sends each role to the right home", () => {
    expect(homeForRole("clinician")).toBe("/doctor");
    expect(homeForRole("hospital_admin")).toBe("/admin");
    expect(homeForRole("auditor")).toBe("/admin");
    expect(homeForRole(null)).toBe("/admin");
  });
});

describe("admin page access", () => {
  it("lets a doctor into no admin page", () => {
    expect(canAccessAdminPath("clinician", "/admin")).toBe(false);
    expect(canAccessAdminPath("clinician", "/admin/patients")).toBe(false);
  });

  it("matches pages to permissions, longest prefix first", () => {
    expect(permissionForAdminPath("/admin/patients/abc")).toBe("patients.read");
    expect(permissionForAdminPath("/admin/approvals")).toBe("approvals.review");
    expect(canAccessAdminPath("care_coordinator", "/admin/patients/abc")).toBe(true);
    expect(canAccessAdminPath("care_coordinator", "/admin/team")).toBe(false);
    expect(canAccessAdminPath("auditor", "/admin/settings")).toBe(false);
  });

  it("fails closed: an admin page with no rule is admin-only", () => {
    expect(permissionForAdminPath("/admin/brand-new-page")).toBe("admin-only");
    expect(canAccessAdminPath("hospital_admin", "/admin/brand-new-page")).toBe(true);
    expect(canAccessAdminPath("care_coordinator", "/admin/brand-new-page")).toBe(false);
    expect(canAccessAdminPath("auditor", "/admin/brand-new-page")).toBe(false);
  });

  it("builds a menu that only lists pages the role can open", () => {
    const labels = (role: (typeof ALL_ROLES)[number]) => navItemsFor(role, false).map((i) => i.label);
    expect(labels("hospital_admin")).toContain("Team & Logins");
    expect(labels("hospital_admin")).toContain("Doctor Requests");
    expect(labels("care_coordinator")).toEqual(expect.arrayContaining(["Patients", "Appointments"]));
    expect(labels("care_coordinator")).not.toContain("Team & Logins");
    expect(labels("auditor")).not.toContain("Agent Builder");
    expect(labels("clinician")).toEqual([]);
    expect(navItemsFor("hospital_admin", true).map((i) => i.label)).toContain("Tenants");
  });
});
