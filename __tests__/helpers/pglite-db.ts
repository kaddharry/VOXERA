/**
 * A real Postgres (PGlite, Postgres compiled to WASM) with
 * sql/migration_v33.sql applied, plus a tiny `rpc()` that calls its
 * functions the way supabase-js does (named arguments). Used to test the
 * call-coordination, queue, jobs and rate-limit SQL for real, not mocked.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SETOF = new Set(["claim_jobs", "claim_job_by_key"]);
const COMPOSITE = new Set(["enqueue_job", "complete_job"]);

export async function createMigratedDb() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(fs.readFileSync(path.resolve(__dirname, "../../sql/migration_v33.sql"), "utf8"));

  const argTypes = new Map<string, Map<string, string>>();
  async function typesOf(fn: string) {
    if (!argTypes.has(fn)) {
      const { rows } = await db.query<{ name: string; type: string }>(
        `SELECT unnest(p.proargnames) AS name, format_type(unnest(p.proargtypes::oid[]), NULL) AS type
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1`,
        [fn],
      );
      argTypes.set(fn, new Map(rows.map((r) => [r.name, r.type])));
    }
    return argTypes.get(fn)!;
  }

  async function rpc(fn: string, args: Record<string, unknown> = {}) {
    const types = await typesOf(fn);
    const names = Object.keys(args);
    const values = names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
    });
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}::${types.get(n) ?? "text"}`).join(", ")})`;
    try {
      if (SETOF.has(fn)) return { data: (await db.query(`SELECT * FROM ${call}`, values)).rows, error: null };
      if (COMPOSITE.has(fn)) return { data: (await db.query(`SELECT * FROM ${call}`, values)).rows[0] ?? null, error: null };
      const { rows } = await db.query<Record<string, unknown>>(`SELECT ${call} AS result`, values);
      const result = rows[0]?.result;
      return { data: result ?? null, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  return { db, rpc };
}
