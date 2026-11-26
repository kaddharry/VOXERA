import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/** Runs sql/migration_v37.sql against a real Postgres (PGlite) on top of the tables it extends — twice, to prove it is idempotent. */
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid);
    CREATE TABLE public.patients (id text PRIMARY KEY, "clientId" text NOT NULL, name text NOT NULL, phone text NOT NULL);
    CREATE TABLE public.providers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, name text NOT NULL);
    CREATE TABLE public.appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, status text);
  `);
  const sql = fs.readFileSync(path.resolve(__dirname, "../../sql/migration_v37.sql"), "utf8");
  await db.exec(sql);
  await db.exec(sql); // idempotent
  await db.exec(`
    INSERT INTO public.tenants (id, auth_user_id) VALUES ('00000000-0000-4000-8000-0000000000a1', NULL);
    INSERT INTO public.providers (id, tenant_id, name) VALUES
      ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'Dr. A'),
      ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'Dr. B');
    INSERT INTO public.patients (id, "clientId", name, phone) VALUES ('p1', 'c', 'Asha', '+91');
    INSERT INTO public.appointments (id, client_id, status) VALUES ('00000000-0000-4000-8000-0000000000c1', 'c', 'scheduled');
  `);
});

const T = "00000000-0000-4000-8000-0000000000a1";
const A = "00000000-0000-4000-8000-0000000000b1";
const B = "00000000-0000-4000-8000-0000000000b2";
const rejects = async (sql: string) => { await expect(db.exec(sql)).rejects.toThrow(); };

describe("migration_v37", () => {
  it("adds the doctor link and severity columns with safe defaults", async () => {
    const appt = (await db.query<{ severity: string; priority_score: number }>(`SELECT severity, priority_score FROM public.appointments`)).rows[0];
    expect(appt).toEqual({ severity: "routine", priority_score: 20 });
    expect((await db.query(`SELECT "primaryProviderId" FROM public.patients`)).rows[0]).toEqual({ primaryProviderId: null });
  });

  it("only allows the four severities", async () => {
    await db.exec(`UPDATE public.appointments SET severity = 'serious'`);
    await rejects(`UPDATE public.appointments SET severity = 'catastrophic'`);
  });

  it("medicines belong to a patient, default to active, and vanish with the patient", async () => {
    await db.exec(`INSERT INTO public.medications (id, "clientId", "patientId", name, "startDate", "createdAt", "updatedAt") VALUES ('m1','c','p1','Metformin',1,1,1)`);
    expect((await db.query<{ status: string; frequency: string }>(`SELECT status, frequency FROM public.medications`)).rows[0]).toEqual({ status: "active", frequency: "once daily" });
    await rejects(`INSERT INTO public.medications (id, "clientId", "patientId", name, "startDate", "createdAt", "updatedAt") VALUES ('m2','c','nobody','X',1,1,1)`);
    await rejects(`UPDATE public.medications SET status = 'paused'`);
  });

  it("adherence only takes the four statuses and needs a real medicine", async () => {
    await db.exec(`INSERT INTO public.medication_adherence (id, "clientId", "patientId", "medicationId", status, "reportedAt") VALUES ('a1','c','p1','m1','missed',1)`);
    await rejects(`INSERT INTO public.medication_adherence (id, "clientId", "patientId", "medicationId", status, "reportedAt") VALUES ('a2','c','p1','m1','sort of',1)`);
    await rejects(`INSERT INTO public.medication_adherence (id, "clientId", "patientId", "medicationId", status, "reportedAt") VALUES ('a3','c','p1','nope','taken',1)`);
  });

  it("referrals: pending by default, never to oneself, only known urgencies/statuses", async () => {
    await db.exec(`INSERT INTO public.referrals (id, "clientId", tenant_id, "patientId", from_provider_id, to_provider_id, reason) VALUES ('r1','c','${T}','p1','${A}','${B}','Needs cardiology')`);
    expect((await db.query<{ status: string; urgency: string }>(`SELECT status, urgency FROM public.referrals`)).rows[0]).toEqual({ status: "pending", urgency: "routine" });
    await rejects(`INSERT INTO public.referrals (id, "clientId", tenant_id, "patientId", from_provider_id, to_provider_id, reason) VALUES ('r2','c','${T}','p1','${A}','${A}','self')`);
    await rejects(`UPDATE public.referrals SET urgency = 'whenever'`);
    await rejects(`UPDATE public.referrals SET status = 'maybe'`);
  });

  it("instruction requests: pending by default; only known statuses; a patient delete removes patient-specific ones", async () => {
    await db.exec(`INSERT INTO public.agent_instruction_requests (id, "clientId", tenant_id, provider_id, "patientId", title, doctor_message, proposed_instruction) VALUES ('i1','c','${T}','${A}','p1','t','m','Ask about swelling')`);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.agent_instruction_requests`)).rows[0].status).toBe("pending");
    await rejects(`UPDATE public.agent_instruction_requests SET status = 'live'`);
    await db.exec(`DELETE FROM public.patients WHERE id = 'p1'`);
    expect((await db.query(`SELECT 1 FROM public.agent_instruction_requests`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM public.medications`)).rows).toHaveLength(0);
  });

  it("turns row-level security on for every new table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('medications','medication_adherence','referrals','agent_instruction_requests')`,
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});
